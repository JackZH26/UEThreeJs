import type { BufferGeometry } from 'three';
import { ball, bar, blob, box, cyl, ring, strut } from '../parts.js';
import { carPaintMaterial, neonMaterial, plasticMaterial } from '../palette.js';
import { defColor } from '../propPart.js';
import type { PropPart } from '../propPart.js';
import { roundBumperSkirt } from './skirt.js';
import type { PrefabDef, PropColor } from '@tjre/schema';

/**
 * ============================================================
 *  卡通碰碰车（假人驾驶 + 尾旗）
 * ============================================================
 *
 *  造型语言来自皮克斯《赛车总动员》：高饱和糖果漆、圆润饱满的大面块、
 *  **挡风玻璃上一对大眼睛**、前脸格栅上一张上扬的笑嘴。底盘则是碰碰车的：
 *  一圈贴地的厚橡胶围裙，**一个轮子都看不见**。
 *
 *  ── 局部坐标 ────────────────────────────────────────────────
 *  车头朝 **-Z**（`rotationY = 0` 时朝北），y = 0 在地面，
 *  原点在**车体平面中心**（车体 z ∈ [-1.2, +1.2]，x ∈ [-0.8, +0.8]）。
 *
 *  这里与 `bumperCar.ts` 的原点约定**故意不同**：那辆车把原点放在座位轴线上，
 *  是为了让作者能"同一个 (x,z) 再放一个司机"。这辆车的假人是内建的，
 *  没有那个契约要伺候，于是原点回到最直觉的位置 —— 车摆在哪，`at` 就写哪。
 *  代价是 `size.d` 比车体长：尾旗飘出去 0.31m（在 y≈2.0 的高度，撞不到别的车，
 *  但两车前后相邻时旗子会插进另一辆的车身，所以这个数该算进间距）。
 *
 *  ── 为什么车壳全是椭球 ──────────────────────────────────────
 *  没有布尔运算，车壳只能靠体量叠加。椭球没有平面，任意两块互穿都是圆滑过渡；
 *  半球或方块一旦露出平底/平面就是一道刀切边。**开篷座舱也是这么来的**：
 *  不是从实心车身里挖洞（挖不了），而是前罩 + 尾臀 + 两侧船帮围出来的空档。
 */

/** 围裙（= 全车最外轮廓，俯视图上的黑胶圈） */
const HALF_W = 0.8;
const NOSE_Z = -1.2;
const TAIL_Z = 1.2;
/** 围裙是**圆管**截面：管半径的两倍就是它的高 */
const SKIRT_TUBE_R = 0.14;
/** 圆角比写实款大得多 —— 卡通造型不能有硬角 */
const CORNER_R = 0.42;

/** 脚坑地板上表面（假人的脚踩这里） */
const FLOOR_Y = 0.32;
/** 座垫上表面 */
const SEAT_Y = 0.62;
/** 方向盘中心 */
const WHEEL = { x: 0, y: 0.95, z: -0.42 };
/** 旗杆所在的 z（车尾） */
const MAST_Z = 0.95;
/** 旗杆顶 */
const MAST_TOP = 2.04;

/** 两侧对称件的镜像因子 */
const SIDES = [1, -1] as const;
/** 前后两组轮眉的 z */
const FENDER_Z = [-0.62, 0.58] as const;

/**
 * 彩旗的对比色。
 *
 * 逐色写死而不是"取色环上的下一个"：同色系撞在一起会糊成一块，
 * 而色环的邻色恰恰最容易撞。青蓝车配黄旗是设计三视图上的方案，其余按同样的
 * 冷暖对冲原则给。整表是 `Record`（不是 `Partial`），少写一色 TS 就报错。
 */
const FLAG_ACCENT: Readonly<Record<PropColor, PropColor>> = Object.freeze({
  cyan: 'yellow',
  red: 'yellow',
  yellow: 'cyan',
  lime: 'pink',
  purple: 'yellow',
  pink: 'cyan',
  blue: 'orange',
  orange: 'cyan',
  mint: 'pink',
  white: 'pink',
});

/** 车壳：前罩 + 引擎盖隆起 + 尾臀 + 两侧船帮 + 四个轮眉鼓包 + 两片上眼皮 */
function shell(): BufferGeometry[] {
  const parts: BufferGeometry[] = [
    // 前罩（车头主体量）与它上面的一道隆起 —— 两块错开就出了前低后高的楔形侧影
    blob({ w: 1.06, h: 0.48, d: 0.86 }, { x: 0, y: 0.4, z: -0.75 }),
    blob({ w: 0.8, h: 0.3, d: 0.66 }, { x: 0, y: 0.52, z: -0.62 }),
    // 脸盘：把尖鼻子削钝，笑嘴与车头灯都贴在它上面
    blob({ w: 1.0, h: 0.5, d: 0.4 }, { x: 0, y: 0.46, z: -0.95 }),
    // 尾臀（最高的一块车漆，旗杆坐在它顶上）
    blob({ w: 1.2, h: 0.66, d: 0.98 }, { x: 0, y: 0.52, z: 0.66 }),
  ];
  for (const sx of SIDES) {
    // 船帮：一根 2.2m 的长椭球，既是座舱侧壁也是腰线
    parts.push(blob({ w: 0.42, h: 0.62, d: 2.2 }, { x: sx * 0.55, y: 0.34, z: -0.05 }));
    for (const z of FENDER_Z) {
      // 轮眉鼓包（车轮看不见，但鼓包是《赛车总动员》的体型特征，不能省）
      parts.push(blob({ w: 0.36, h: 0.42, d: 0.78 }, { x: sx * 0.61, y: 0.36, z }));
    }
    // 上眼皮：压在眼球顶上的一道车漆眉毛（扁而宽，不是一个圆包）——
    // 有没有它，决定像不像在看人
    parts.push(blob({ w: 0.36, h: 0.16, d: 0.28 }, { x: sx * 0.28, y: 0.93, z: -0.62 }));
  }
  return parts;
}

interface Face {
  /** 眼白 */
  sclera: BufferGeometry[];
  iris: BufferGeometry[];
  /** 瞳孔 + 笑嘴 + 深色挡风板（同为哑光黑） */
  dark: BufferGeometry[];
  headlights: BufferGeometry[];
  taillights: BufferGeometry[];
}

/**
 * 脸。
 *
 * 眼球坐在引擎盖隆起上、深色挡风板之前，所以从正面看是"玻璃里的一对眼睛"。
 * 笑嘴是一段**圆弧**（`ring` 的 `arc`），弧段居中于 -Y 就是嘴角上扬。
 * 弧所在的平面是常量 z，而钝鼻子是曲面 —— 半径与 z 取到让整条弧
 * 恰好半埋半露：嘴角只露一点点，中央露得多，正是漆面上一道嘴缝的样子。
 */
function face(): Face {
  const out: Face = { sclera: [], iris: [], dark: [], headlights: [], taillights: [] };

  // 深色挡风板：眼球背后那块暗面，让眼白有东西衬着。
  // 顶面压在眼球顶（0.99）之下，否则正面看会在两眼之间冒出一截黑块
  out.dark.push(blob({ w: 0.94, h: 0.44, d: 0.28 }, { x: 0, y: 0.66, z: -0.48 }));
  // 笑嘴：0.7π 的弧，跨到车宽的 35%（窄了会变成一张小圆嘴，读不出"笑"）。
  // 半径与 z 取到让整条弧半埋半露 —— 弧在常量 z 的平面里，而钝鼻子是曲面，
  // 只有这一组数能让嘴角与中央同时露出来
  out.dark.push(ring(0.3, 0.032, { x: 0, y: 0.62, z: -1.115 }, 'z', 0, Math.PI * 0.7));

  for (const sx of SIDES) {
    // 眼球坐在引擎盖隆起的前沿（底 0.61 略微埋进车漆里）—— 高了就变成戴护目镜的青蛙。
    // 左右分到 ±0.28：两眼之间留出 0.24 的空档，深色挡风板从那里透出来 = 挡风玻璃
    out.sclera.push(blob({ w: 0.32, h: 0.38, d: 0.28 }, { x: sx * 0.28, y: 0.8, z: -0.62 }, 14));
    // 虹膜略微内聚（x 比眼球中心小），两只眼于是像在看同一处，而不是各看一边
    out.iris.push(blob({ w: 0.17, h: 0.19, d: 0.12 }, { x: sx * 0.25, y: 0.79, z: -0.758 }, 10));
    out.dark.push(blob({ w: 0.08, h: 0.09, d: 0.06 }, { x: sx * 0.245, y: 0.785, z: -0.8 }, 8));
    // 车头灯移到鼻子外侧、与嘴角齐平 —— 原先挤在嘴角上方，看着像两颗獠牙
    out.headlights.push(
      cyl(0.095, 0.07, { x: sx * 0.4, y: 0.5, z: -1.085 }, { axis: 'z', segments: 14 }),
    );
    out.taillights.push(
      cyl(0.08, 0.06, { x: sx * 0.34, y: 0.56, z: 1.06 }, { axis: 'z', segments: 12 }),
    );
  }
  return out;
}

/**
 * 霓虹描边：每侧两道轮眉弧 + 一道腰线光带。
 *
 * 都压在 x = ±0.77~0.80（= 围裙外缘）上：再往里就被轮眉鼓包整根吞掉看不见了，
 * 再往外就超出全车宽度。半埋半露是这里唯一能亮起来的位置。
 */
function neonTrim(): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (const sx of SIDES) {
    for (const z of FENDER_Z) {
      parts.push(ring(0.14, 0.03, { x: sx * 0.77, y: 0.3, z }, 'x', Math.PI, Math.PI * 0.95));
    }
    parts.push(cyl(0.028, 0.66, { x: sx * 0.77, y: 0.34, z: -0.02 }, { axis: 'z', segments: 8 }));
  }
  return parts;
}

/** 座舱内饰（哑光黑）：脚坑地板 + 座垫 + 圆头靠背 + 方向盘 */
function cockpit(): BufferGeometry[] {
  return [
    box({ w: 0.8, h: 0.06, d: 0.9 }, { x: 0, y: FLOOR_Y - 0.03, z: -0.48 }),
    box({ w: 0.74, h: 0.1, d: 0.5 }, { x: 0, y: SEAT_Y - 0.05, z: 0.14 }),
    blob({ w: 0.78, h: 0.52, d: 0.24 }, { x: 0, y: 0.8, z: 0.42 }),
    ring(0.17, 0.032, WHEEL, 'z', -0.45),
  ];
}

interface Mannequin {
  shell: BufferGeometry[];
  /** 肩关节球（哑光黑）—— 碰撞测试假人的标志 */
  joints: BufferGeometry[];
}

/**
 * 假人。
 *
 * 刻意做成商场模特 / 碰撞测试假人那一路：光头、无五官、哑光米灰。
 * 它不能是个角色 —— 车才是角色（脸长在车上）。给假人五官就会有两张脸在抢戏。
 *
 * 坐姿由三个高度锁定：脚踩 `FLOOR_Y`、坐在 `SEAT_Y`、手落在 `WHEEL`，
 * 手臂用 `strut` 连肩点与手点，长度和倾角自己算 —— 比拼两次旋转可靠。
 */
function mannequin(): Mannequin {
  const shell: BufferGeometry[] = [
    blob({ w: 0.44, h: 0.26, d: 0.36 }, { x: 0, y: 0.7, z: 0.1 }),
    blob({ w: 0.46, h: 0.52, d: 0.32 }, { x: 0, y: 1.0, z: 0.14 }),
    cyl(0.055, 0.12, { x: 0, y: 1.26, z: 0.15 }, { segments: 10 }),
    blob({ w: 0.25, h: 0.31, d: 0.27 }, { x: 0, y: 1.38, z: 0.16 }, 14),
  ];
  const joints: BufferGeometry[] = [];

  for (const sx of SIDES) {
    // 大腿前伸 + 小腿垂下，脚底正好落在脚坑地板上
    shell.push(blob({ w: 0.17, h: 0.19, d: 0.52 }, { x: sx * 0.11, y: 0.68, z: -0.16 }));
    shell.push(blob({ w: 0.15, h: 0.34, d: 0.18 }, { x: sx * 0.11, y: 0.5, z: -0.4 }));
    // 手落在方向盘**盘沿**上（不是盘后），否则从侧面看方向盘整个被手臂挡掉
    const hand = { x: sx * 0.16, y: WHEEL.y, z: WHEEL.z - 0.02 };
    const arm = strut({ x: sx * 0.2, y: 1.13, z: 0.1 }, hand, 0.085);
    if (arm !== null) shell.push(arm);
    shell.push(ball(0.07, hand, 8));
    joints.push(ball(0.07, { x: sx * 0.2, y: 1.14, z: 0.1 }, 8));
  }
  return { shell, joints };
}

/** 旗面：分段数、总长、根部高度、旗尖高度、摆动幅度与波数 */
const FLAG_SEGMENTS = 7;
const FLAG_LENGTH = 0.56;
const FLAG_TOP_Y = 2.0;
const FLAG_ROOT_H = 0.3;
const FLAG_TIP_H = 0.1;
const FLAG_SWAY = 0.09;
const FLAG_WAVES = 1.15;

/**
 * 彩旗：把"飘"烘进几何里。
 *
 * 几何是静态的，所以飘动只能靠形状表达：旗面沿 +Z 拉出去，中轴按正弦左右摆
 * （`FLAG_WAVES` 个波），每段旗面是一根薄薄的方棒（`bar` 自己算朝向），
 * 高度从根部到旗尖递减 —— 于是侧影是一面被风吹开的三角小旗，而不是一块板。
 *
 * 分段交替上色就是"彩旗"：一段本色一段对比色，读起来是条纹。
 */
function flagBands(color: PropColor): { materialId: string; geometry: BufferGeometry }[] {
  const accent = FLAG_ACCENT[color];
  const bands: { materialId: string; geometry: BufferGeometry }[] = [];

  const nodeAt = (t: number): { x: number; z: number } => ({
    x: FLAG_SWAY * Math.sin(t * FLAG_WAVES * Math.PI * 2),
    z: MAST_Z + t * FLAG_LENGTH,
  });

  for (let i = 0; i < FLAG_SEGMENTS; i++) {
    const t0 = i / FLAG_SEGMENTS;
    const t1 = (i + 1) / FLAG_SEGMENTS;
    const mid = (t0 + t1) / 2;
    const height = FLAG_ROOT_H + (FLAG_TIP_H - FLAG_ROOT_H) * mid;
    const geometry = bar(nodeAt(t0), nodeAt(t1), FLAG_TOP_Y - height / 2, 0.022, height);
    if (geometry === null) continue;
    bands.push({ geometry, materialId: plasticMaterial(i % 2 === 0 ? accent : 'white') });
  }
  return bands;
}

export function buildToonCar(def: PrefabDef): PropPart[] {
  const color = defColor(def);
  const { sclera, iris, dark, headlights, taillights } = face();
  const { shell: figure, joints } = mannequin();

  const parts: PropPart[] = [];
  const push = (geometries: readonly BufferGeometry[], materialId: string): void => {
    for (const geometry of geometries) parts.push({ geometry, materialId });
  };

  push(
    [
      ...roundBumperSkirt({
        halfWidth: HALF_W,
        noseZ: NOSE_Z,
        tailZ: TAIL_Z,
        tubeRadius: SKIRT_TUBE_R,
        cornerRadius: CORNER_R,
      }),
      ...cockpit(),
      ...dark,
      ...joints,
      // 旗杆顶的小球：黑色配件，跟旗杆的镀铬分开才看得出是两个零件
      ball(0.035, { x: 0, y: MAST_TOP + 0.02, z: MAST_Z }, 8),
    ],
    'rubber_black',
  );
  push(shell(), carPaintMaterial(color));
  push(neonTrim(), neonMaterial(color));
  // 车头灯恒为白、尾灯恒为红 —— 跟着车身色变会像玩具（同 bumperCar）
  push(headlights, neonMaterial('white'));
  push(taillights, neonMaterial('red'));
  push(sclera, plasticMaterial('white'));
  push(iris, 'toon_iris');
  push(figure, 'mannequin_shell');
  push(
    [
      // 旗杆底座 + 细旗杆 + 转向柱
      cyl(0.055, 0.09, { x: 0, y: 0.8, z: MAST_Z }, { segments: 10 }),
      cyl(0.016, MAST_TOP - 0.82, { x: 0, y: (0.82 + MAST_TOP) / 2, z: MAST_Z }, { segments: 8 }),
      cyl(0.05, 0.06, WHEEL, { axis: 'z', segments: 10 }),
    ],
    'chrome',
  );
  const column = strut({ x: 0, y: 0.62, z: -0.52 }, { x: 0, y: 0.93, z: -0.44 }, 0.05);
  if (column !== null) parts.push({ geometry: column, materialId: 'chrome' });

  for (const band of flagBands(color)) {
    parts.push({ geometry: band.geometry, materialId: band.materialId });
  }
  return parts;
}
