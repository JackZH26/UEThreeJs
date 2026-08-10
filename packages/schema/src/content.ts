import { z } from 'zod';
import { PrefabIdSchema } from './prefab.js';
import { HexColor, Id, PointXYZ, PositiveMeters, Size3, Tags, UserData } from './primitives.js';

/**
 * Prop —— 来自预设库的道具实例。
 * 与 Structure 的区别：Prop 不定义可行走表面，只是摆放物。
 *
 * `prefab` 是**闭合枚举**（见 prefab.ts）：写错的 id 在 schema 层就被拒，
 * 而不是静默渲染出一个空道具。配色也编码在 prefab id 里，所以这里没有颜色字段。
 */
export const Prop = z
  .strictObject({
    id: Id,
    prefab: PrefabIdSchema,
    at: PointXYZ.describe('房间局部位置；含义随 prefab 的 anchor 而定（底面 / 吊点）'),
    rotationY: z.number().finite().default(0).describe('绕 Y 轴旋转，单位度'),
    scale: PositiveMeters.default(1).describe('等比缩放；非等比缩放不在 v0.1 范围内'),
    snap: z
      .enum(['floor', 'wall', 'ceiling', 'none'])
      .default('floor')
      .describe('放置吸附方式，编辑器用于辅助定位'),
    tags: Tags,
    userData: UserData,
    note: z.string().max(200).optional(),
  })
  .describe('道具实例');
export type Prop = z.infer<typeof Prop>;

/** 灯光类型 —— 与 UE 光源类型一一对应，便于 Phase 5 无损映射 */
export const LightType = z.enum(['point', 'spot', 'area', 'ambient']);
export type LightType = z.infer<typeof LightType>;

/**
 * Light —— 预设驱动的光源。
 *
 * 优先使用 `preset`（保证双端一致）；`intensity` / `color` 仅作微调覆盖。
 * 强度单位遵循物理光照单位（point/spot = candela，area = nit，directional = lux），
 * 与 UE 的换算表由 Phase 5 的光照标定场实测确定，见 docs/UE_PIPELINE.md。
 */
export const Light = z
  .strictObject({
    id: Id,
    type: LightType,
    preset: Id.optional().describe('引用 @tjre/presets 中的灯光预设 id'),
    at: PointXYZ.describe('房间局部位置；ambient 类型忽略此字段'),
    rotationY: z.number().finite().default(0).describe('绕 Y 轴旋转，度；spot / area 使用'),
    tiltX: z.number().finite().default(0).describe('绕 X 轴俯仰，度；spot / area 使用'),
    intensity: z.number().finite().positive().optional().describe('覆盖预设强度'),
    color: HexColor.optional().describe('覆盖预设颜色'),
    range: PositiveMeters.optional().describe('衰减半径；point / spot 使用'),
    coneAngle: z.number().finite().positive().max(90).optional().describe('spot 半锥角，度'),
    size: z
      .strictObject({ w: PositiveMeters, h: PositiveMeters })
      .optional()
      .describe('area 光源尺寸'),
    castShadow: z.boolean().default(true),
    note: z.string().max(200).optional(),
  })
  .describe('光源实例');
export type Light = z.infer<typeof Light>;

/** Marker 种类 —— 纯 gameplay 语义，无几何 */
export const MarkerKind = z.enum([
  'spawn', // 玩家 / 敌人出生点
  'trigger', // 触发体积
  'objective', // 目标点
  'nav_hint', // 导航提示（引导 AI 寻路）
  'cover', // 掩体点
  'item', // 拾取物生成点
]);
export type MarkerKind = z.infer<typeof MarkerKind>;

export const Marker = z
  .strictObject({
    id: Id,
    kind: MarkerKind,
    at: PointXYZ.describe('房间局部位置'),
    rotationY: z.number().finite().default(0).describe('朝向，度'),
    /** 仅 trigger 使用；其余种类忽略 */
    size: Size3.optional().describe('体积尺寸，仅 kind=trigger 使用'),
    radius: PositiveMeters.optional().describe('影响半径，用于 nav_hint / cover'),
    tags: Tags,
    userData: UserData,
    note: z.string().max(200).optional(),
  })
  .describe('gameplay 标记点（无几何）');
export type Marker = z.infer<typeof Marker>;

/** 主题 —— 一组表面材质 + 默认灯光预设的命名集合 */
export const Theme = z
  .strictObject({
    id: Id,
    name: z.string().max(80).optional(),
    surfaces: z
      .strictObject({
        floor: Id,
        ceiling: Id,
        wall: Id,
        /** 内部结构件的默认材质 */
        structure: Id.optional(),
      })
      .describe('各表面使用的材质 id（引用 @tjre/presets 材质库）'),
    lightPreset: Id.optional().describe('房间未显式布光时使用的默认灯光预设'),
    ambientColor: HexColor.optional(),
    note: z.string().max(200).optional(),
  })
  .describe('主题：材质 + 灯光预设集合');
export type Theme = z.infer<typeof Theme>;

/**
 * ── 已移除：`Pin` ────────────────────────────────────────────
 *
 * v0.1 有一个 `Pin`（世界坐标 + 旋转），供布局求解器把房间钉在固定位置。
 * v0.2 起每个房间就是一个独立关卡、永远在原点，房间朝向由游戏侧在拼装时
 * 决定 —— 世界坐标在本项目里不再是一个有意义的概念，求解器与 Pin 一并删除。
 */
