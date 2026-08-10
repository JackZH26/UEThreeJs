import { z } from 'zod';

/**
 * ============================================================
 *  坐标与朝向约定（全项目唯一定义，改动此处等于破坏性变更）
 * ============================================================
 *
 *  世界坐标系：three.js 右手系，Y 轴朝上（与 three.js 一致，导出到 UE 时再转换）
 *
 *    north = -Z      south = +Z
 *    east  = +X      west  = -X
 *    up    = +Y
 *
 *  房间（Room）：
 *    - 尺寸不手写，由 `spec` 派生（见 spec.ts）。`roomSize(room)` 给出
 *      **内部净尺寸**：w 沿 X，d 沿 Z，h 沿 Y
 *    - 房间原点 = **地面矩形的中心**（y = 0 即地面）
 *    - 每个房间自带完整厚度（`WALL_T`）的四面墙，向外长出，
 *      外廓 AABB 恰好等于占格尺寸。房间之间**不共享墙** ——
 *      每个房间是独立关卡，运行时由传送门连接。
 *
 *  房间局部坐标（structures / props / lights / markers 使用）：
 *    - 原点同房间原点；x → east(+X)，z → south(+Z)，y → up(+Y)
 *
 *  开口（Opening）：
 *    - `offset` = 沿墙面从**墙中心**起算的有符号偏移
 *        · north / south 墙 → 沿 X 轴
 *        · east  / west  墙 → 沿 Z 轴
 *    - `elevation` = 开口**下沿**距房间地面的高度
 */

/** 标识符：小写字母开头，仅含小写字母、数字、下划线。全文档内需保证作用域唯一。 */
export const Id = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'id 必须小写字母开头，仅含小写字母、数字、下划线');
export type Id = z.infer<typeof Id>;

/** 引用另一个房间的开口，格式 `roomId.openingId` */
export const OpeningRef = z
  .string()
  .regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/, 'openingRef 格式必须是 "roomId.openingId"')
  .describe('引用某房间的开口，格式 "roomId.openingId"，例如 "entry.door_north"');
export type OpeningRef = z.infer<typeof OpeningRef>;

/** 解析 `roomId.openingId` */
export function parseOpeningRef(ref: OpeningRef): { roomId: string; openingId: string } {
  const dot = ref.indexOf('.');
  return { roomId: ref.slice(0, dot), openingId: ref.slice(dot + 1) };
}

/** 外壳墙的四个方向 */
export const WallSide = z.enum(['north', 'south', 'east', 'west']);
export type WallSide = z.infer<typeof WallSide>;

/** 房间的六个面 */
export const SurfaceSide = z.enum(['north', 'south', 'east', 'west', 'floor', 'ceiling']);
export type SurfaceSide = z.infer<typeof SurfaceSide>;

export const WALL_SIDES: readonly WallSide[] = ['north', 'south', 'east', 'west'] as const;

/** 与某面墙相对的墙 */
export const OPPOSITE_WALL: Readonly<Record<WallSide, WallSide>> = {
  north: 'south',
  south: 'north',
  east: 'west',
  west: 'east',
};

/** 墙面的延展轴：north/south 墙沿 X 延展，east/west 墙沿 Z 延展 */
export const WALL_SPAN_AXIS: Readonly<Record<WallSide, 'x' | 'z'>> = {
  north: 'x',
  south: 'x',
  east: 'z',
  west: 'z',
};

/** 米为单位的长度，有限实数 */
export const Meters = z.number().finite();
/** 米为单位的正长度 */
export const PositiveMeters = z.number().finite().positive();

/** 房间局部平面坐标（x 向东，z 向南），单位米 */
export const PointXZ = z
  .strictObject({
    x: Meters.describe('沿 X 轴（东正）'),
    z: Meters.describe('沿 Z 轴（南正）'),
  })
  .describe('房间局部平面坐标，单位米');
export type PointXZ = z.infer<typeof PointXZ>;

/** 房间局部三维坐标 */
export const PointXYZ = z
  .strictObject({
    x: Meters.describe('沿 X 轴（东正）'),
    y: Meters.describe('沿 Y 轴（上正），0 = 房间地面'),
    z: Meters.describe('沿 Z 轴（南正）'),
  })
  .describe('房间局部三维坐标，单位米');
export type PointXYZ = z.infer<typeof PointXYZ>;

/** 三维尺寸：w 沿 X，d 沿 Z，h 沿 Y。故意使用命名字段而非数组 —— 消除顺序歧义。 */
export const Size3 = z
  .strictObject({
    w: PositiveMeters.describe('宽度，沿 X 轴'),
    d: PositiveMeters.describe('深度，沿 Z 轴'),
    h: PositiveMeters.describe('高度，沿 Y 轴'),
  })
  .describe('三维尺寸（米）。w=沿X宽, d=沿Z深, h=沿Y高');
export type Size3 = z.infer<typeof Size3>;

/** 二维尺寸（用于开口洞口） */
export const Size2 = z
  .strictObject({
    w: PositiveMeters.describe('宽度'),
    h: PositiveMeters.describe('高度'),
  })
  .describe('二维尺寸（米）');
export type Size2 = z.infer<typeof Size2>;

/** 房间局部的水平矩形（中心 + 尺寸） */
export const RectXZ = z
  .strictObject({
    x: Meters.describe('矩形中心 X'),
    z: Meters.describe('矩形中心 Z'),
    w: PositiveMeters.describe('沿 X 宽度'),
    d: PositiveMeters.describe('沿 Z 深度'),
  })
  .describe('房间局部水平矩形，以中心点 + 尺寸表示');
export type RectXZ = z.infer<typeof RectXZ>;

/** `#RRGGBB` 十六进制颜色 */
export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, '颜色必须是 #RRGGBB 格式')
  .describe('十六进制颜色，例如 "#c8c0b0"');
export type HexColor = z.infer<typeof HexColor>;

/** 自由标签 */
export const Tags = z
  .array(z.string().min(1).max(48))
  .default([])
  .describe('自由标签，导出时映射为 UE Actor Tags');

/** 供游戏逻辑使用的透传数据 —— 管线不解释其内容 */
export const UserData = z
  .record(z.string(), z.unknown())
  .default({})
  .describe('透传给游戏逻辑的自定义数据，管线不解释其内容');
