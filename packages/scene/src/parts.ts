import {
  BoxGeometry,
  CylinderGeometry,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { BufferGeometry } from 'three';
import type { PointXYZ, PointXZ } from '@tjre/schema';

/**
 * ============================================================
 *  零件构造器 —— 结构件与道具共用的基本形体
 * ============================================================
 *
 *  产出的几何体都在**房间局部坐标系**（原点 = 地面矩形中心，y 向上），
 *  并且已经就位（旋转 + 平移都做完了），调用方只需要收集起来 merge。
 *
 *  为什么单独一个模块：`structures.ts` 原来自己藏着 `box` / `bar`，而道具的
 *  构造器需要同样的东西外加圆柱 / 球 / 圆环 / 任意方向的杆。两份实现必然漂移，
 *  所以抽到这里，`structures.ts` 也改成从这里 import。
 */

/** 轴对齐方块 */
export function box(
  size: { w: number; h: number; d: number },
  center: PointXYZ,
  rotationY = 0,
): BufferGeometry {
  const geometry = new BoxGeometry(size.w, size.h, size.d);
  if (rotationY !== 0) geometry.rotateY(rotationY);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/**
 * 沿两点连线放一根**水平**方棒（横梁、隔墙、走道段、扶手）。
 *
 * 只处理水平情形 —— 竖向倾斜的杆用 `strut()`。
 */
export function bar(
  from: PointXZ,
  to: PointXZ,
  y: number,
  width: number,
  height: number,
): BufferGeometry | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  // atan2(dx, dz)：让方棒的局部 +Z 指向 from→to
  const rotationY = Math.atan2(dx, dz);
  return box(
    { w: width, h: height, d: length },
    { x: (from.x + to.x) / 2, y, z: (from.z + to.z) / 2 },
    rotationY,
  );
}

/** 方棒的局部长轴 —— `strut()` 把它旋转到目标方向 */
const LENGTH_AXIS = new Vector3(0, 0, 1);

/**
 * 连接**任意两个三维点**的方杆。
 *
 * 彩灯串的下垂电缆、乐高人斜伸的手臂都需要它 —— 这些方向既不水平也不竖直，
 * 用 `bar()` 表达不了。
 */
export function strut(a: PointXYZ, b: PointXYZ, thickness: number): BufferGeometry | null {
  const dir = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
  const length = dir.length();
  if (length < 1e-6) return null;
  const geometry = new BoxGeometry(thickness, thickness, length);
  geometry.applyQuaternion(
    new Quaternion().setFromUnitVectors(LENGTH_AXIS, dir.divideScalar(length)),
  );
  geometry.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return geometry;
}

export interface CylinderOptions {
  /** 圆周分段数。道具尺度下 12~16 足够，别给到 32 —— 一个房间里有几十个圆柱 */
  segments?: number;
  /** 长轴方向，默认 `y` */
  axis?: 'x' | 'y' | 'z';
  /** 顶部半径；留空 = 与底部相同（正圆柱） */
  radiusTop?: number;
}

/** 圆柱 / 圆台 */
export function cyl(
  radius: number,
  height: number,
  center: PointXYZ,
  options: CylinderOptions = {},
): BufferGeometry {
  const geometry = new CylinderGeometry(
    options.radiusTop ?? radius,
    radius,
    height,
    options.segments ?? 14,
  );
  if (options.axis === 'x') geometry.rotateZ(Math.PI / 2);
  else if (options.axis === 'z') geometry.rotateX(Math.PI / 2);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/** 球 */
export function ball(radius: number, center: PointXYZ, segments = 10): BufferGeometry {
  const geometry = new SphereGeometry(radius, segments, Math.max(4, Math.round(segments * 0.6)));
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/**
 * 椭球 —— 卡通体量的主力形体。
 *
 * `size` 是**包围盒**（不是半径），`center` 是椭球中心。
 *
 * 为什么卡通车身全用椭球而不用 `box` 或半球：椭球**没有平面**，
 * 所以一块体量从另一块里鼓出来时，无论鼓出多少都是圆滑过渡。
 * 半球（穹顶）的平底一旦高过下方曲面就会露出一圈刀切边 —— 试过，很难看。
 * 车壳没有布尔运算，全靠体量叠加，这个性质是决定性的。
 */
export function blob(
  size: { w: number; h: number; d: number },
  center: PointXYZ,
  segments = 12,
): BufferGeometry {
  const geometry = new SphereGeometry(0.5, segments, Math.max(4, Math.round(segments * 0.6)));
  geometry.scale(size.w, size.h, size.d);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/**
 * 圆环 / 圆弧（轮眉 / 方向盘 / 笑嘴）。
 *
 * `facing` 是圆环所在平面的法向：`z` = 环面朝前后（默认），`x` = 朝左右。
 * `tiltX` 供方向盘那种倾斜安装用，单位弧度。
 *
 * `arc` < 2π 时只生成一段圆弧，且**弧段居中于 -Y**（开口朝上 = 笑嘴）。
 * 要朝上鼓的弧（轮眉、眉毛）传 `tiltX = Math.PI` 把它翻过来 ——
 * 与其给一个"弧段朝向"参数，不如复用已有的 tilt：翻转是旋转，本来就是它的活。
 */
export function ring(
  radius: number,
  tube: number,
  center: PointXYZ,
  facing: 'x' | 'z' = 'z',
  tiltX = 0,
  arc = Math.PI * 2,
): BufferGeometry {
  const geometry = new TorusGeometry(radius, tube, 6, 16, arc);
  // TorusGeometry 的弧从 +X 起逆时针扫 arc；转到以 -Y 为中心
  if (arc < Math.PI * 2) geometry.rotateZ(-Math.PI / 2 - arc / 2);
  if (tiltX !== 0) geometry.rotateX(tiltX);
  if (facing === 'x') geometry.rotateY(Math.PI / 2);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/**
 * 上下不等宽的方块（乐高人躯干那种四棱台）。
 *
 * 用 4 边的 `CylinderGeometry` 造：它的横截面是**正方形**，半对角线 = 半径，
 * 所以边长 = r·√2；再沿 Z 压扁到目标厚度。比手搓 8 个顶点的 BufferGeometry 短得多，
 * 而且法线与 UV 都是现成的。
 */
export function taperedBox(
  size: { wTop: number; wBottom: number; h: number; d: number },
  center: PointXYZ,
): BufferGeometry {
  const geometry = new CylinderGeometry(
    size.wTop / Math.SQRT2,
    size.wBottom / Math.SQRT2,
    size.h,
    4,
  );
  // 默认的 4 边柱是"角朝前"，转 45° 让平面朝前后左右
  geometry.rotateY(Math.PI / 4);
  geometry.scale(1, 1, size.d / size.wBottom);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}
