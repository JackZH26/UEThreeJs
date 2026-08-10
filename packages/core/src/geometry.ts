import type { PointXZ, WallSide } from '@tjre/schema';

/**
 * ============================================================
 *  结构件的纯几何推导
 * ============================================================
 *
 *  这些函数**必须**住在 core 而不是 scene：校验器需要它们来判断"楼梯顶端是否
 *  真的落在目标平台上"（R046），而 core 不允许依赖 three.js。
 *  scene 从这里 re-export，保证生成几何与校验用的是**同一套算法** ——
 *  两边各算一遍必然会漂移，届时校验通过但几何错位，最难查。
 */

/** 各朝向在房间局部平面上的单位向量 */
export const DIRECTION: Readonly<Record<WallSide, PointXZ>> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/** 斜坡坡度 1:8（12.5%）。schema 未指定坡度，按车辆通行常见值取。 */
export const RAMP_SLOPE = 1 / 8;

/** 踏面深度的合理区间（m） */
const TREAD_MIN = 0.22;
const TREAD_MAX = 0.34;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * 由踢面高度导出踏面深度 —— **Blondel 公式** `2R + G = 630mm`。
 *
 * schema 只给了 `stepHeight`（踢面），没有踏面深度。与其拍一个魔法数字，
 * 不如用建筑学上通行的舒适度公式导出，并夹到合理区间。
 * `stepHeight = 0.18` → 踏面 `0.27`，是真实舒适的楼梯比例。
 */
export function treadDepth(stepHeight: number): number {
  return clamp(0.63 - 2 * stepHeight, TREAD_MIN, TREAD_MAX);
}

export interface StairMetrics {
  stepCount: number;
  tread: number;
  /** 沿行进方向的总进深 */
  runLength: number;
}

/** 楼梯的级数与总进深。级数向上取整，保证一定爬到目标高度。 */
export function stairMetrics(rise: number, stepHeight: number): StairMetrics {
  const tread = treadDepth(stepHeight);
  const stepCount = Math.max(1, Math.ceil(rise / stepHeight));
  return { stepCount, tread, runLength: stepCount * tread };
}

/** 斜坡按固定坡度求总进深 */
export function rampLength(rise: number): number {
  return rise / RAMP_SLOPE;
}

/** 从起点沿某朝向前进一段距离后的位置 */
export function advance(from: PointXZ, facing: WallSide, distance: number): PointXZ {
  const dir = DIRECTION[facing];
  return { x: from.x + dir.x * distance, z: from.z + dir.z * distance };
}

/** 点是否落在矩形内（可给一个外扩容差） */
export function pointInRect(
  point: PointXZ,
  rect: { x: number; z: number; w: number; d: number },
  tolerance = 0,
): boolean {
  return (
    Math.abs(point.x - rect.x) <= rect.w / 2 + tolerance &&
    Math.abs(point.z - rect.z) <= rect.d / 2 + tolerance
  );
}
