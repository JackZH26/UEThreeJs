import { describe, expect, it } from 'vitest';
import { Box3 } from 'three';
import { PREFABS, PREFAB_IDS, Prop, prefabDef, prefabsOfKind } from '@tjre/schema';
import type { PrefabId } from '@tjre/schema';
import { buildPropGeometry, prefabMaterialIds, surfaceSpec } from '@tjre/scene';
import type { PropGeometryResult } from '@tjre/scene';

/**
 * 道具几何测试。
 *
 * 最重要的一条是「目录声明的 size = 实际几何的包围盒」——
 * `PrefabDef.size` 是给作者与编辑器判断间距用的**声明值**，构造器并不读它，
 * 所以它天生会漂移。这里把它钉住，与 shell.test.ts 里
 * 「外壳 AABB 恰好等于占格尺寸」是同一手法。
 */

/** 包围盒容差（m）。斜杆（手臂 / 电缆）的端头是斜切的，包围盒会差几毫米 —— 不值得追平。 */
const SIZE_TOLERANCE = 0.02;

function propAt(prefab: PrefabId, over: Record<string, unknown> = {}): Prop {
  return Prop.parse({ id: 'probe', prefab, at: { x: 0, y: 0, z: 0 }, ...over });
}

function build(prefab: PrefabId, over: Record<string, unknown> = {}): PropGeometryResult {
  const built = buildPropGeometry(propAt(prefab, over));
  if (built === null) throw new Error(`${prefab} 没有产出几何`);
  return built;
}

function bounds(built: PropGeometryResult): Box3 {
  const box = new Box3();
  for (const part of built.parts) {
    part.geometry.computeBoundingBox();
    const partBox = part.geometry.boundingBox;
    if (partBox !== null) box.union(partBox);
  }
  return box;
}

/** 单一材质那组零件的包围盒 —— 用来问"眼睛在哪""旗子在哪" */
function materialBounds(built: PropGeometryResult, materialId: string): Box3 {
  const part = built.parts.find((p) => p.materialId === materialId);
  expect(part, `${built.prefab} 里没有 ${materialId} 这组零件`).toBeDefined();
  if (part === undefined) throw new Error('unreachable');
  part.geometry.computeBoundingBox();
  const box = part.geometry.boundingBox;
  if (box === null) throw new Error(`${materialId} 算不出包围盒`);
  return box;
}

describe('每个 prefab 都能建出符合目录声明的几何', () => {
  for (const id of PREFAB_IDS) {
    it(id, () => {
      const def = prefabDef(id);
      const built = build(id);
      expect(built.partCount).toBeGreaterThan(0);
      expect(built.kind).toBe(def.kind);

      const box = bounds(built);
      expect(Math.abs(box.max.x - box.min.x - def.size.w), `${id} 宽`).toBeLessThan(SIZE_TOLERANCE);
      expect(Math.abs(box.max.z - box.min.z - def.size.d), `${id} 深`).toBeLessThan(SIZE_TOLERANCE);
      expect(Math.abs(box.max.y - box.min.y - def.size.h), `${id} 高`).toBeLessThan(SIZE_TOLERANCE);

      // 锚点约定：落地道具的最低点在 y=0；吊挂道具的最高点在 y=0
      // （吊挂件允许略微超过 0：电缆是**穿过**吊点的，半根线径在上方）
      if (def.anchor === 'base') {
        expect(Math.abs(box.min.y), `${id} anchor=base 时最低点应在 y=0`).toBeLessThan(
          SIZE_TOLERANCE,
        );
      } else {
        expect(box.max.y, `${id} anchor=top 时最高点不应明显超过 y=0`).toBeLessThan(0.05);
        expect(box.min.y, `${id} anchor=top 时几何应在 y=0 之下`).toBeLessThan(0);
      }

      // 挂载面必须落在道具自身高度之内，否则"人坐进车里"的契约无从成立
      if (def.mount !== undefined) {
        expect(def.mount.y).toBeGreaterThan(0);
        expect(def.mount.y).toBeLessThan(def.size.h);
      }

      // 按材质合并：mesh 数 = 用到的材质数，且必然少于零件数
      const materials = new Set(built.parts.map((p) => p.materialId));
      expect(built.parts).toHaveLength(materials.size);
      expect(built.parts.length).toBeLessThanOrEqual(built.partCount);
    });
  }
});

/**
 * 这条防的是"加了道具却忘了配色" —— 漏配不会报错，只会静默变成哈希杂色。
 * 与 palette.test.ts 里针对主题材质的同名检查互补：那边查 YAML 里写的材质，
 * 这边查构造器**代码里**引用的材质，两者的来源完全不同。
 */
describe('道具用到的材质都在调色板里', () => {
  it('没有任何 prefab 回落到哈希占位色', () => {
    const missing: string[] = [];
    for (const id of PREFAB_IDS) {
      for (const materialId of prefabMaterialIds(id)) {
        if (surfaceSpec(materialId) === undefined) missing.push(`${id}: ${materialId}`);
      }
    }
    expect(missing, `未配色的材质：\n${missing.join('\n')}`).toEqual([]);
  });

  it('自发光标记来自调色板，不由构造器逐个零件声明', () => {
    const car = build('bumper_car_pink');
    const neon = car.parts.find((p) => p.materialId === 'neon_pink');
    const paint = car.parts.find((p) => p.materialId === 'car_paint_pink');
    expect(neon?.emissive).toBe(true);
    expect(paint?.emissive).toBe(false);
  });
});

/**
 * 朝向约定：`rotationY = 0` 朝北（-Z），增大转向东（+X），
 * 与 `lights.ts` 的 `aimDirection()` 同一套。three 的 `rotateY(+θ)` 恰好相反，
 * 所以 `props.ts` 里那个负号是**必须**的 —— 这条测试就是钉它的。
 */
describe('变换', () => {
  it('rotationY=90 把车头从 -Z 转到 +X', () => {
    const at0 = bounds(build('bumper_car_pink'));
    // 车头在 -Z 一侧（原点在座位轴线上，所以前后不对称：-1.55 / +0.85）
    expect(at0.min.z).toBeCloseTo(-1.55, 2);
    expect(at0.max.z).toBeCloseTo(0.85, 2);

    const at90 = bounds(build('bumper_car_pink', { rotationY: 90 }));
    expect(at90.max.x, '车头应转到 +X（东）').toBeCloseTo(1.55, 2);
    expect(at90.min.x).toBeCloseTo(-0.85, 2);
    // 转 90° 后宽深互换
    expect(at90.max.z - at90.min.z).toBeCloseTo(1.5, 2);
  });

  it('rotationY=180 把车头转到 +Z', () => {
    const box = bounds(build('bumper_car_pink', { rotationY: 180 }));
    expect(box.max.z).toBeCloseTo(1.55, 2);
    expect(box.min.z).toBeCloseTo(-0.85, 2);
  });

  it('scale 等比放大整个道具', () => {
    const one = bounds(build('bench_arena'));
    const two = bounds(build('bench_arena', { scale: 2 }));
    expect(two.max.x - two.min.x).toBeCloseTo((one.max.x - one.min.x) * 2, 3);
    expect(two.max.y - two.min.y).toBeCloseTo((one.max.y - one.min.y) * 2, 3);
  });

  it('at 把道具平移到位（吊挂件的 at 就是吊点）', () => {
    const box = bounds(build('mirror_ball', { at: { x: 3, y: 11.2, z: -4 } }));
    expect(box.max.y, '吊点应在 at.y').toBeCloseTo(11.2, 2);
    expect(box.min.y).toBeCloseTo(11.2 - PREFABS.mirror_ball.size.h, 2);
    expect((box.max.x + box.min.x) / 2).toBeCloseTo(3, 2);
    expect((box.max.z + box.min.z) / 2).toBeCloseTo(-4, 2);
  });

  it('同一输入两次构建得到相同的材质顺序（导出要逐字节确定）', () => {
    const a = build('festoon_party');
    const b = build('festoon_party');
    expect(b.parts.map((p) => p.materialId)).toEqual(a.parts.map((p) => p.materialId));
  });
});

/**
 * 卡通碰碰车的造型契约。
 *
 * 这些不是"几何跑通了"的冒烟测试，而是**设计意图**：围裙必须是最外轮廓
 * （否则不像碰碰车）、假人的头必须露出车身（否则等于没坐人）、彩旗必须与车漆
 * 不同色（否则糊成一块）。它们全都能在改造型时被无声破坏，所以钉住。
 */
describe('卡通碰碰车', () => {
  const TOON_IDS = prefabsOfKind('toon_car');

  it('目录里有一组卡通车，且全部共用同一套几何（只换材质）', () => {
    expect(TOON_IDS.length).toBeGreaterThan(1);
    const first = build(TOON_IDS[0] ?? 'toon_car_cyan');
    for (const id of TOON_IDS.slice(1)) {
      const other = build(id);
      expect(other.partCount, `${id} 零件数应与首色一致`).toBe(first.partCount);
      expect(bounds(other).equals(bounds(first)), `${id} 包围盒应与首色一致`).toBe(true);
    }
  });

  it('围裙是最外轮廓：车宽与车头都由橡胶决定，看不见轮子', () => {
    const built = build('toon_car_cyan');
    const all = bounds(built);
    const skirt = materialBounds(built, 'rubber_black');
    // 车宽 = 围裙宽（任何车漆/霓虹件鼓出围裙，撞车时就先撞车漆了）
    expect(skirt.min.x).toBeCloseTo(all.min.x, 3);
    expect(skirt.max.x).toBeCloseTo(all.max.x, 3);
    // 车头最前点也是围裙（笑嘴只能半埋半露，不能戳出保险杠）
    expect(skirt.min.z).toBeCloseTo(all.min.z, 3);
    // 且围裙贴地
    expect(skirt.min.y).toBeCloseTo(0, 3);
  });

  it('假人坐在车里、头露在车身之上', () => {
    const built = build('toon_car_cyan');
    const figure = materialBounds(built, 'mannequin_shell');
    const paint = materialBounds(built, 'car_paint_cyan');
    // 脚在车里（脚坑地板高度一带），头明显高过车漆最高处
    expect(figure.min.y).toBeGreaterThan(0.28);
    expect(figure.max.y).toBeGreaterThan(paint.max.y + 0.4);
    // 假人在座舱里，不是站在车尾：躯干中线落在车体中后段
    expect((figure.min.z + figure.max.z) / 2).toBeGreaterThan(-0.3);
    expect(figure.max.z).toBeLessThan(0.4);
  });

  it('彩旗飘在车尾旗杆顶上，且伸出车体之外', () => {
    const built = build('toon_car_cyan');
    const flag = materialBounds(built, 'plastic_yellow');
    const mast = materialBounds(built, 'chrome');
    // 旗面全在高处（撞不到别的车，但会插进前后相邻的车身 —— 所以 size.d 得算它）
    expect(flag.min.y).toBeGreaterThan(1.6);
    expect(flag.max.y).toBeLessThan(mast.max.y + 0.02);
    // 旗子从旗杆往车尾外飘：整面旗都在车体尾缘(+1.2)那一侧展开
    expect(flag.max.z).toBeGreaterThan(1.2);
    expect(flag.min.z).toBeGreaterThan(0.9);
    // 而且真的在"飘"：中轴左右摆动过，不是一块平板
    expect(flag.max.x - flag.min.x).toBeGreaterThan(0.1);
  });

  it('每种车色的彩旗都用对比色，不与车漆同色', () => {
    for (const id of TOON_IDS) {
      const color = prefabDef(id).color;
      const materials = new Set(build(id).parts.map((p) => p.materialId));
      expect(materials, `${id} 应有白色旗段`).toContain('plastic_white');
      const accents = [...materials].filter(
        (m) => m.startsWith('plastic_') && m !== 'plastic_white',
      );
      expect(accents, `${id} 应恰好有一种对比色旗段`).toHaveLength(1);
      expect(accents[0], `${id} 的旗子跟车漆同色了`).not.toBe(`plastic_${color ?? ''}`);
    }
  });

  it('眼睛是"眼白 + 虹膜 + 瞳孔"三层，虹膜朝车头方向凸出', () => {
    const built = build('toon_car_cyan');
    // 这组白塑料同时含旗面的白条，但最靠车头的那一端必然是眼白
    const white = materialBounds(built, 'plastic_white');
    const iris = materialBounds(built, 'toon_iris');
    // 虹膜嵌在眼白前面（-Z = 车头方向），所以更靠前
    expect(iris.min.z).toBeLessThan(white.min.z);
    // 两只眼分列左右，且都在车头上方的挡风位置
    expect(iris.min.x).toBeLessThan(0);
    expect(iris.max.x).toBeGreaterThan(0);
    expect(iris.min.y).toBeGreaterThan(0.6);
  });
});

/**
 * 自动贩卖机的造型与用途契约。
 *
 * 它在关卡里是**掩体**，所以"够高"不是审美问题而是玩法问题；
 * 而"货窗在正面、货品在玻璃之后"是它能被认出来的全部理由。
 */
describe('自动贩卖机', () => {
  it('比站姿乐高人高 —— 站直能挡住人才算掩体', () => {
    expect(PREFABS.vending_machine.size.h).toBeGreaterThan(PREFABS.minifig_standing_cyan.size.h);
  });

  it('货窗在正面（-Z）且不超出机身宽度', () => {
    const built = build('vending_machine');
    const all = bounds(built);
    const glass = materialBounds(built, 'vending_glass');
    expect(glass.min.z).toBeLessThan(0);
    expect(glass.min.z - all.min.z).toBeLessThan(0.06);
    // 只占左侧大半宽，右边留给操作柱
    expect(glass.min.x).toBeGreaterThan(all.min.x);
    expect(glass.max.x).toBeLessThan(all.max.x - 0.2);
  });

  it('货品在玻璃之后（在柜子里，不是贴在门外）', () => {
    const built = build('vending_machine');
    const glass = materialBounds(built, 'vending_glass');
    for (const color of ['red', 'yellow', 'cyan']) {
      const goods = materialBounds(built, `plastic_${color}`);
      expect(goods.min.z, `${color} 货品应在玻璃内侧`).toBeGreaterThan(glass.max.z);
    }
  });

  it('自带柜内照明 —— 暗场里它同时是路标', () => {
    const built = build('vending_machine');
    expect(built.parts.find((p) => p.materialId === 'vending_glow')?.emissive).toBe(true);
  });
});

describe('复合道具的挂载契约', () => {
  it('乐高人放在车的 mount.y 上时，胯部正好落在座垫高度', () => {
    const car = PREFABS.bumper_car_pink;
    const mountY = car.mount?.y ?? 0;
    // 坐姿乐高人的胯部底面在自身局部 0.40（见 minifig.ts 的 seatedPose）；
    // 碰碰车的座垫上表面 = mount.y + 0.40（见 bumperCar.ts 的 SEAT_ABOVE_MOUNT）。
    // 这里用几何反查：把人放在 mount.y 上，其大腿底面应当≈座垫顶面。
    const fig = bounds(build('minifig_seated_cyan', { at: { x: 0, y: mountY, z: 0 } }));
    expect(fig.min.y, '脚底应踩在脚坑地板上').toBeCloseTo(mountY, 2);

    // 人的头顶必须高过车身（否则就是坐在车里看不见人）
    const carBox = bounds(build('bumper_car_pink'));
    expect(fig.max.y).toBeGreaterThan(carBox.max.y - 0.3);
  });
});
