import { z } from 'zod';
import { PositiveMeters } from './primitives.js';
import { Theme } from './content.js';
import { Room } from './room.js';

/**
 * 当前 schema 版本。破坏性变更必须递增 minor/major 并提供 migrations/。
 *
 * 0.2.0 的破坏性内容：
 *   · Room 的 `size` / `doorCount` / `pin` / `wallThickness` 全部移除，改由 `spec` 派生
 *   · 传送门由 `spec` 派生，不再手写
 *   · 文档级 `connections` 移除（房间之间靠传送门在运行时连接，不在文档里描述）
 *   · `meta.entryRoom` / `meta.wallThickness` 移除
 */
export const SCHEMA_VERSION = '0.2.0';

/** 允许被本版本代码直接加载的 schema 版本（其余需先跑迁移） */
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = [SCHEMA_VERSION];

export const DocumentMeta = z
  .strictObject({
    name: z.string().min(1).max(120).describe('关卡显示名'),
    units: z
      .literal('meters')
      .default('meters')
      .describe('长度单位。v0.2 固定为米；导出 UE 时按 ×100 转 cm'),
    grid: PositiveMeters.default(0.5).describe('编辑吸附网格；校验器会对未对齐的尺寸给出 warning'),
    description: z.string().max(2000).optional().describe('给人/AI 看的关卡说明'),
  })
  .describe('关卡级元数据');
export type DocumentMeta = z.infer<typeof DocumentMeta>;

/**
 * RoomGraphDocument —— 关卡的**唯一真相**。
 *
 * ⚠️ 名字里的 "Graph" 是历史遗留。当前模型**没有图**：
 * 每个房间就是一个独立关卡，房间之间由传送门在**运行时**按 seed 拼装，
 * 文档里不描述任何房间间关系。`rooms` 是一个数组只是为了允许把同一批
 * 房间放在一个文件里当**房间库**用；一房一文件是推荐用法。
 *
 * 设计目标（docs/SCOPE.md P1）：文档只存**意图**（规格、内部结构参数），
 * 不存任何推导结果 —— 尺寸、传送门、世界坐标一律不写入。
 */
export const RoomGraphDocument = z
  .strictObject({
    schemaVersion: z
      .string()
      .describe(`文档遵循的 schema 版本。当前代码支持：${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`),
    meta: DocumentMeta,
    themes: z.array(Theme).min(1).describe('主题库；每个房间必须引用其中之一'),
    rooms: z.array(Room).default([]).describe('房间列表。每个房间是一个独立关卡。'),
  })
  .describe('RoomGraph 关卡文档 —— 关卡的唯一真相');
export type RoomGraphDocument = z.infer<typeof RoomGraphDocument>;

/** 未应用默认值的输入形态（用于解析用户/AI 手写的 YAML） */
export type RoomGraphDocumentInput = z.input<typeof RoomGraphDocument>;

/** 创建一个最小可用的空文档 */
export function createEmptyDocument(name: string): RoomGraphDocument {
  return RoomGraphDocument.parse({
    schemaVersion: SCHEMA_VERSION,
    meta: { name },
    themes: [
      {
        id: 'default',
        name: 'Default',
        surfaces: { floor: 'concrete_floor', ceiling: 'concrete_ceiling', wall: 'concrete_wall' },
      },
    ],
    rooms: [],
  } satisfies RoomGraphDocumentInput);
}
