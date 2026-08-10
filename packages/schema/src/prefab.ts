import { z } from 'zod';
import type { Size3 } from './primitives.js';

/**
 * ============================================================
 *  Prefab 目录 —— 道具预设的**受控词表**
 * ============================================================
 *
 *  `Prop.prefab` 引用这里的 id。目录**只存纯数据**（种类 / 配色名 / 锚点 /
 *  尺寸 / 挂载面），几何构造器住在 `packages/scene/src/prefabs/`，
 *  色值住在 `packages/scene/src/palette.ts` —— 那两样都需要 three.js 与渲染知识，
 *  而本包必须保持零 three 依赖以便 headless 校验。
 *
 *  ── 为什么 `prefab` 是闭合枚举而材质 id 是开放的 ────────────
 *  材质写错时会回落成**稳定哈希色**，那是刻意保留的可视诊断（见 materials.ts）。
 *  prefab 写错则没有任何有意义的回落 —— 要么画错的东西，要么什么都不画。
 *  所以把它收成枚举：错误在 **schema 层**就被拒，`pnpm cli schema` 产出的
 *  JSON Schema 还会**列出全部可用 id**，成为 agent 的发现通道。
 *  这样也就不需要为"引用不存在的 prefab"再写一条校验规则。
 *
 *  ── 颜色为什么进 id 而不是 Prop 的字段 ──────────────────────
 *  prefab 的语义就是"预设库里的一个条目"，`bumper_car_pink` 与
 *  `bumper_car_blue` 是两个预设，不是同一个预设的两种参数。这样也不必为了
 *  换个颜色去改 schema。目录本身由颜色表循环生成，加一色只加一行。
 *
 *  ── 与 Phase 4 的关系 ───────────────────────────────────────
 *  这是 `@tjre/presets` 道具库的**第一批**。抽包时把这张表连同 scene 里的
 *  构造器一起搬过去；届时 `prefab` 可能要放开成"目录里存在即可"（用户可扩展），
 *  那是一次有意的破坏性变更，不是现在就该预留的活口。
 */

/** 道具种类 —— 决定用哪个几何构造器 */
export const PrefabKind = z.enum([
  'bumper_car',
  'toon_car',
  'minifig',
  'festoon',
  'mirror_ball',
  'bench',
  'vending',
]);
export type PrefabKind = z.infer<typeof PrefabKind>;

/**
 * 配色**名**（不是色值）。
 *
 * 色值由 `packages/scene/src/palette.ts` 按 `car_paint_<名>` / `plastic_<名>` /
 * `neon_<名>` 三个族生成 —— 有测试断言每个用到的名字都有对应材质。
 */
export const PROP_COLORS = [
  'pink',
  'red',
  'orange',
  'yellow',
  'lime',
  'mint',
  'cyan',
  'blue',
  'purple',
  'white',
] as const;
export type PropColor = (typeof PROP_COLORS)[number];

/** 碰碰车的车漆色 */
const CAR_COLORS = ['pink', 'blue', 'red', 'yellow', 'mint', 'purple', 'orange'] as const;
/**
 * 卡通碰碰车的车漆色。
 *
 * 打头的 `cyan` 是设计三视图上的主色，也是 `CAR_COLORS` 里唯一空着的颜色 ——
 * 于是两款车摆在同一个场地里不会出现"同色不同款"的迷惑对照。
 */
const TOON_CAR_COLORS = ['cyan', 'red', 'yellow', 'lime', 'purple'] as const;
/** 乐高人的衣裤色（头手恒为经典乐高黄，见 minifig 构造器） */
const FIG_COLORS = ['cyan', 'red', 'yellow', 'lime', 'white', 'purple'] as const;
/** 彩灯串的配色方案 */
const FESTOON_TINTS = ['party', 'warm', 'cool'] as const;
export type FestoonTint = (typeof FESTOON_TINTS)[number];

/** 乐高人的姿态 */
export type FigurePose = 'seated' | 'standing';

/**
 * 放置锚点 —— 决定 `Prop.at.y` 的含义：
 *   · `base` = 原点在**底面**（落地道具：车、人、长椅）
 *   · `top`  = 原点在**悬挂点**（吊顶道具：彩灯串、镜面球），几何全部在 y ≤ 0
 */
export type PrefabAnchor = 'base' | 'top';

export interface PrefabDef {
  kind: PrefabKind;
  /** 主体配色名；无配色的道具（镜面球 / 长椅）留空 */
  color?: PropColor;
  /** 仅 festoon */
  tint?: FestoonTint;
  /** 仅 minifig */
  pose?: FigurePose;
  anchor: PrefabAnchor;
  /**
   * 包围尺寸（m）。**声明值，由测试钉住等于实际几何的 bbox**
   * （`packages/scene/test/props.test.ts`）。构造器不读它 —— 内部比例是构造器
   * 自己的事，size 是那些比例的**结果**。它存在是为了让作者与编辑器能判断
   * 间距，不必先把几何建出来。
   */
  size: Size3;
  /**
   * 复合道具的**挂载平面**高度（局部坐标 y）。
   *
   * 碰碰车 = 脚坑地板高度。于是"人坐进车里"在 YAML 里就是：同一个 (x,z)、
   * 同一个 rotationY、`at.y` 写这个数 —— 作者不需要算任何三角函数。
   * 构造器**必须**读它来定位脚坑地板，这样契约不会漂移。
   */
  mount?: { y: number };
  note: string;
}

/** 碰碰车：原点在座位中轴上（车头朝 -Z），脚坑地板 0.26m */
function bumperCar(color: PropColor): PrefabDef {
  return {
    kind: 'bumper_car',
    color,
    anchor: 'base',
    size: { w: 1.5, d: 2.4, h: 1.51 },
    mount: { y: 0.26 },
    note: `${color} 碰碰车：橡胶围裙 + 车漆壳体 + 霓虹轮眉，驾驶员放同一 (x,z)、y=0.26`,
  };
}

/**
 * 卡通碰碰车 —— 皮克斯《赛车总动员》的造型语言嫁接到碰碰车底盘上。
 *
 * 与 `bumper_car` 的分工：那是写实款（玻璃钢车壳 + 霓虹轮眉），这是拟人款
 * （挡风玻璃上一对大眼睛、前脸一张笑嘴、圆润的糖果漆体量）。两款共用同一圈
 * 橡胶围裙，所以摆在一起时"贴地、看不见轮子"的识别特征是一致的。
 *
 * **不写 `mount`：假人是车的一部分，已经内建。** 再往上叠一个 `minifig_seated_*`
 * 会两个身体互穿。这是与 `bumper_car` 唯一的契约差别，所以写进 note 里。
 */
function toonCar(color: PropColor): PrefabDef {
  return {
    kind: 'toon_car',
    color,
    anchor: 'base',
    // d 含飘在车尾的彩旗（车体本身 2.4m，旗尖再伸 0.32m）；
    // h 含旗杆（车体连假人的头只到 1.54m）
    size: { w: 1.6, d: 2.72, h: 2.1 },
    note: `${color} 卡通碰碰车：大眼睛 + 笑嘴 + 橡胶围裙，**假人与尾旗已内建**（别再叠 minifig）。车体 1.6×2.4m；size 的 d/h 含尾旗与旗杆`,
  };
}

function minifig(pose: FigurePose, color: PropColor): PrefabDef {
  return {
    kind: 'minifig',
    color,
    pose,
    anchor: 'base',
    // 宽度由斜伸的手臂决定（肩点在躯干轮廓之外），不是躯干宽
    size: pose === 'seated' ? { w: 0.79, d: 0.72, h: 1.53 } : { w: 0.76, d: 0.4, h: 1.79 },
    note:
      pose === 'seated'
        ? `${color} 乐高人（坐姿）：手扶方向盘，脚踩脚坑地板`
        : `${color} 乐高人（站姿）：观众，放在夹层上`,
  };
}

function festoon(tint: FestoonTint): PrefabDef {
  return {
    kind: 'festoon',
    tint,
    anchor: 'top',
    size: { w: 12.21, d: 0.21, h: 0.99 },
    note: `彩灯串（${tint}）：12m 跨度、13 只灯泡，中央下垂 0.7m；at 写吊点`,
  };
}

type CarId = `bumper_car_${(typeof CAR_COLORS)[number]}`;
type ToonCarId = `toon_car_${(typeof TOON_CAR_COLORS)[number]}`;
type SeatedId = `minifig_seated_${(typeof FIG_COLORS)[number]}`;
type StandingId = `minifig_standing_${(typeof FIG_COLORS)[number]}`;
type FestoonId = `festoon_${FestoonTint}`;

/** 全部 prefab id */
export type PrefabId =
  | CarId
  | ToonCarId
  | SeatedId
  | StandingId
  | FestoonId
  | 'mirror_ball'
  | 'bench_arena'
  | 'vending_machine';

function buildCatalog(): Record<PrefabId, PrefabDef> {
  const out: Partial<Record<PrefabId, PrefabDef>> = {};

  for (const color of CAR_COLORS) out[`bumper_car_${color}`] = bumperCar(color);
  for (const color of TOON_CAR_COLORS) out[`toon_car_${color}`] = toonCar(color);
  for (const color of FIG_COLORS) {
    out[`minifig_seated_${color}`] = minifig('seated', color);
    out[`minifig_standing_${color}`] = minifig('standing', color);
  }
  for (const tint of FESTOON_TINTS) out[`festoon_${tint}`] = festoon(tint);

  out.mirror_ball = {
    kind: 'mirror_ball',
    anchor: 'top',
    size: { w: 1.1, d: 1.07, h: 1.6 },
    note: '镜面球：低多边形 + 平面着色，金属度 1 —— SSR 的最佳反射体；at 写吊点',
  };
  out.bench_arena = {
    kind: 'bench',
    anchor: 'base',
    size: { w: 2.4, d: 0.48, h: 0.84 },
    note: '观众长椅：2.4m 三人座，靠背在 +Z（坐者朝 -Z）',
  };
  out.vending_machine = {
    kind: 'vending',
    anchor: 'base',
    // d 含向前凸出的玻璃与操作柱（机身本体 0.82m 深，背面在局部 z = +0.41）
    size: { w: 1.05, d: 0.89, h: 1.95 },
    note: '自动贩卖机：货窗朝 -Z（rotationY 0 = 面朝北），背面在局部 z=+0.41，贴墙放时 at 离墙 0.43m。1.95m 高，站直挡得住人 —— 配 kind=cover 的 marker 当掩体用',
  };

  // 每个条目单独冻结：整表冻结只挡替换，不挡改字段
  for (const def of Object.values(out)) Object.freeze(def);
  return Object.freeze(out) as Record<PrefabId, PrefabDef>;
}

/** prefab 目录（冻结）。键即 `Prop.prefab` 的合法取值。 */
export const PREFABS: Readonly<Record<PrefabId, PrefabDef>> = buildCatalog();

/** 全部 prefab id —— `PrefabIdSchema` 与 JSON Schema 的枚举值来源 */
export const PREFAB_IDS = Object.keys(PREFABS) as [PrefabId, ...PrefabId[]];

/**
 * `Prop.prefab` 的取值域。
 *
 * 用枚举而不是自由字符串：见文件头「为什么 `prefab` 是闭合枚举」。
 */
export const PrefabIdSchema = z
  .enum(PREFAB_IDS)
  .describe('引用 prefab 目录（packages/schema/src/prefab.ts）中的条目 id');

/** 查目录。id 已被 schema 收窄，所以必然命中。 */
export function prefabDef(id: PrefabId): PrefabDef {
  return PREFABS[id];
}

/** 某个种类的全部 prefab id —— 供编辑器分组与文档生成 */
export function prefabsOfKind(kind: PrefabKind): PrefabId[] {
  return PREFAB_IDS.filter((id) => PREFABS[id].kind === kind);
}
