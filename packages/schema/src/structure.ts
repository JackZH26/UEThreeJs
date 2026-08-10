import { z } from 'zod';
import { Id, Meters, PointXZ, PositiveMeters, RectXZ, WallSide } from './primitives.js';

/**
 * ============================================================
 *  Structure —— 房间的**内部结构件**
 * ============================================================
 *
 *  与 Prop（道具）的本质区别：Structure 带**碰撞与导航语义**
 *  （可站立、可攀爬、可阻挡），Prop 只是装饰或 gameplay 物件。
 *
 *  目标形态：很高的仓库 / loft —— 外壳是一个全封闭高盒，
 *  内部靠夹层平台 + 室内楼梯 + 廊桥组织出可行走空间。
 *
 *  注意：`mezzanine`（夹层）不是独立类型 —— 它就是贴墙布置的 `platform`。
 */

/** 结构件的护栏配置（用于线性结构：楼梯 / 廊桥） */
export const SideRailing = z
  .enum(['none', 'left', 'right', 'both'])
  .default('both')
  .describe('沿行进方向的哪一侧添加护栏');

const base = {
  id: Id,
  material: Id.optional().describe('覆盖主题的材质；留空则用房间主题'),
  note: z.string().max(200).optional(),
};

/** 抬升的水平平台。贴墙布置时即为"夹层 / mezzanine"。 */
export const PlatformStructure = z
  .strictObject({
    ...base,
    type: z.literal('platform'),
    rect: RectXZ.describe('平台在房间局部的水平轮廓'),
    elevation: PositiveMeters.describe('平台**上表面**距房间地面的高度'),
    thickness: PositiveMeters.default(0.3).describe('楼板厚度（向下延伸）'),
    railing: z.array(WallSide).default([]).describe('平台哪几条边加护栏，例如 ["north","east"]'),
  })
  .describe('抬升的水平平台 / 夹层');

/** 室内楼梯，从某高度上行至一个平台。 */
export const StairStructure = z
  .strictObject({
    ...base,
    type: z.literal('stair'),
    from: PointXZ.describe('楼梯底端中心（房间局部平面坐标）'),
    fromElevation: Meters.min(0).default(0).describe('楼梯底端所处高度；0 = 房间地面'),
    to: Id.describe('目标 platform 的 id —— v0.1 楼梯必须落在一个 platform 上'),
    width: PositiveMeters.default(1.2),
    facing: WallSide.describe('上行时的前进方向'),
    stepHeight: PositiveMeters.default(0.18).describe('单级踏步高度，用于生成几何'),
    railing: SideRailing,
  })
  .describe('室内楼梯');

/** 直梯 / 爬梯，竖直攀爬至平台。 */
export const LadderStructure = z
  .strictObject({
    ...base,
    type: z.literal('ladder'),
    at: PointXZ.describe('梯脚位置'),
    fromElevation: Meters.min(0).default(0),
    to: Id.describe('目标 platform 的 id'),
    width: PositiveMeters.default(0.6),
    facing: WallSide.describe('攀爬时面朝的方向'),
  })
  .describe('竖直爬梯');

/** 斜坡，上行至一个平台。 */
export const RampStructure = z
  .strictObject({
    ...base,
    type: z.literal('ramp'),
    from: PointXZ.describe('斜坡底端中心'),
    fromElevation: Meters.min(0).default(0),
    to: Id.describe('目标 platform 的 id'),
    width: PositiveMeters.default(1.6),
    facing: WallSide.describe('上行方向'),
    railing: SideRailing,
  })
  .describe('斜坡（车辆 / 无障碍通行）');

/** 廊桥 / 检修道：沿折线延展的窄条通道。 */
export const CatwalkStructure = z
  .strictObject({
    ...base,
    type: z.literal('catwalk'),
    path: z.array(PointXZ).min(2).describe('折线路径，至少 2 个点'),
    elevation: PositiveMeters.describe('走道上表面高度'),
    width: PositiveMeters.default(1.0),
    thickness: PositiveMeters.default(0.15),
    railing: SideRailing,
  })
  .describe('架空廊桥 / 检修走道');

/** 独立护栏（不依附平台时使用）。 */
export const RailingStructure = z
  .strictObject({
    ...base,
    type: z.literal('railing'),
    path: z.array(PointXZ).min(2).describe('护栏折线路径'),
    elevation: Meters.min(0).default(0).describe('护栏底部高度'),
    height: PositiveMeters.default(1.1),
  })
  .describe('独立护栏');

/** 立柱。 */
export const PillarStructure = z
  .strictObject({
    ...base,
    type: z.literal('pillar'),
    at: PointXZ,
    profile: z.enum(['square', 'round']).default('square'),
    size: PositiveMeters.default(0.4).describe('边长（square）或直径（round）'),
    fromElevation: Meters.min(0).default(0),
    height: PositiveMeters.optional().describe('留空 = 从底部一直顶到房间天花板'),
  })
  .describe('立柱');

/** 横梁。 */
export const BeamStructure = z
  .strictObject({
    ...base,
    type: z.literal('beam'),
    from: PointXZ,
    to: PointXZ,
    elevation: PositiveMeters.describe('梁底高度'),
    width: PositiveMeters.default(0.3),
    height: PositiveMeters.default(0.4),
  })
  .describe('横梁');

/** 内部隔墙 —— 分隔空间但**不参与房间封闭性**，因此不能承载 Connection。 */
export const PartitionStructure = z
  .strictObject({
    ...base,
    type: z.literal('partition'),
    from: PointXZ,
    to: PointXZ,
    fromElevation: Meters.min(0).default(0),
    height: PositiveMeters.describe('隔墙高度'),
    thickness: PositiveMeters.default(0.15),
  })
  .describe('内部隔墙（不影响房间封闭性，不能开设 Connection 用的门）');

export const Structure = z.discriminatedUnion('type', [
  PlatformStructure,
  StairStructure,
  LadderStructure,
  RampStructure,
  CatwalkStructure,
  RailingStructure,
  PillarStructure,
  BeamStructure,
  PartitionStructure,
]);
export type Structure = z.infer<typeof Structure>;

export type StructureType = Structure['type'];

/** 可作为楼梯 / 爬梯 / 斜坡落点的结构件类型 */
export const CLIMB_TARGET_TYPES: ReadonlySet<StructureType> = new Set<StructureType>(['platform']);

/** 落点类型的类型谓词 —— 让集合保持唯一来源，同时给调用方提供类型收窄 */
export type ClimbTarget = Extract<Structure, { type: 'platform' }>;
export function isClimbTarget(structure: Structure): structure is ClimbTarget {
  return CLIMB_TARGET_TYPES.has(structure.type);
}

/** 提供可行走表面且带明确 elevation 的结构件（platform / catwalk） */
export type ElevatedSurface = Extract<Structure, { type: 'platform' | 'catwalk' }>;
export function isElevatedSurface(structure: Structure): structure is ElevatedSurface {
  return structure.type === 'platform' || structure.type === 'catwalk';
}

/** 提供可行走表面的结构件类型 —— 导出时需要生成导航网格 */
export const WALKABLE_TYPES: ReadonlySet<StructureType> = new Set<StructureType>([
  'platform',
  'catwalk',
  'stair',
  'ramp',
]);
