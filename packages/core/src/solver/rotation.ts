import type { PointXZ, Size3, WallSide } from '@tjre/schema';

/**
 * ============================================================
 *  旋转与墙面映射
 * ============================================================
 *
 *  v0.1 只允许 90° 的整数倍旋转（见 docs/SCOPE.md 的 out-of-scope）。
 *
 *  **刻意不使用 `Math.cos` / `Math.sin`**：`Math.cos(Math.PI/2)` 返回
 *  6.123e-17 而不是 0，会让房间坐标带上浮点噪声，进而破坏
 *  golden 测试的稳定性与序列化的确定性。这里用整数查表，结果是精确值。
 *
 *  世界坐标约定（与 @tjre/schema 一致）：
 *    north = -Z   south = +Z   east = +X   west = -X   up = +Y
 *
 *  three.js 绕 Y 轴旋转 θ 的变换：
 *    x' =  cosθ · x + sinθ · z
 *    z' = -sinθ · x + cosθ · z
 */

export const ROTATIONS = [0, 90, 180, 270] as const;
export type Rotation = (typeof ROTATIONS)[number];

/** 精确的 cos/sin 查表 —— 只有 0 与 ±1，无浮点误差 */
const TRIG: Readonly<Record<Rotation, { c: -1 | 0 | 1; s: -1 | 0 | 1 }>> = {
  0: { c: 1, s: 0 },
  90: { c: 0, s: 1 },
  180: { c: -1, s: 0 },
  270: { c: 0, s: -1 },
};

export function isRotation(value: number): value is Rotation {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

/** 绕 Y 轴旋转一个水平向量（房间局部 → 世界方向） */
export function rotateXZ(point: PointXZ, rotation: Rotation): PointXZ {
  const { c, s } = TRIG[rotation];
  return { x: c * point.x + s * point.z, z: -s * point.x + c * point.z };
}

/** 各墙面在**房间局部**坐标下的朝外单位法向 */
const LOCAL_NORMAL: Readonly<Record<WallSide, PointXZ>> = {
  north: { x: 0, z: -1 },
  south: { x: 0, z: 1 },
  east: { x: 1, z: 0 },
  west: { x: -1, z: 0 },
};

/** 世界朝外法向 → 对应的世界方向名 */
function normalToSide(normal: PointXZ): WallSide {
  if (normal.z === -1) return 'north';
  if (normal.z === 1) return 'south';
  if (normal.x === 1) return 'east';
  return 'west';
}

/** 某面局部墙在旋转后**朝向的世界方向** */
export function worldFacing(wall: WallSide, rotation: Rotation): WallSide {
  return normalToSide(rotateXZ(LOCAL_NORMAL[wall], rotation));
}

/** 世界朝外法向（单位向量） */
export function worldNormal(wall: WallSide, rotation: Rotation): PointXZ {
  return rotateXZ(LOCAL_NORMAL[wall], rotation);
}

export const OPPOSITE: Readonly<Record<WallSide, WallSide>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/**
 * 求解旋转角：使局部墙面 `wall` 旋转后正好朝向世界方向 `target`。
 *
 * 由于四个方向与四个旋转角一一对应，解**唯一存在**。
 */
export function rotationForFacing(wall: WallSide, target: WallSide): Rotation {
  for (const rotation of ROTATIONS) {
    if (worldFacing(wall, rotation) === target) return rotation;
  }
  // 四个旋转必然覆盖四个方向，走不到这里
  throw new Error(`无法让 ${wall} 墙朝向 ${target}`);
}

/**
 * 开口中心在**房间局部**坐标下的位置。
 *
 * schema 约定：north/south 墙的 offset 沿 X，east/west 墙的 offset 沿 Z。
 * 因此 offset 直接就是该轴上的局部坐标。
 */
export function openingLocalPosition(wall: WallSide, offset: number, size: Size3): PointXZ {
  switch (wall) {
    case 'north':
      return { x: offset, z: -size.d / 2 };
    case 'south':
      return { x: offset, z: size.d / 2 };
    case 'east':
      return { x: size.w / 2, z: offset };
    case 'west':
      return { x: -size.w / 2, z: offset };
  }
}

/** 房间旋转后在世界坐标下的水平半尺寸（90° / 270° 会交换 w 与 d） */
export function worldHalfExtents(size: Size3, rotation: Rotation): { hx: number; hz: number } {
  return rotation === 90 || rotation === 270
    ? { hx: size.d / 2, hz: size.w / 2 }
    : { hx: size.w / 2, hz: size.d / 2 };
}
