import { z } from 'zod';
import { Id, PositiveMeters } from './primitives.js';
import { Theme } from './content.js';
import { Connection, Room } from './room.js';

/** 当前 schema 版本。破坏性变更必须递增 minor/major 并提供 migrations/。 */
export const SCHEMA_VERSION = '0.1.0';

/** 允许被本版本代码直接加载的 schema 版本（其余需先跑迁移） */
export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = [SCHEMA_VERSION];

export const DocumentMeta = z
  .strictObject({
    name: z.string().min(1).max(120).describe('关卡显示名'),
    units: z
      .literal('meters')
      .default('meters')
      .describe('长度单位。v0.1 固定为米；导出 UE 时按 ×100 转 cm'),
    grid: PositiveMeters.default(0.5).describe('编辑吸附网格；校验器会对未对齐的尺寸给出 warning'),
    wallThickness:
      PositiveMeters.default(0.2).describe('默认外壳墙厚；相邻房间之间共享一道该厚度的墙'),
    entryRoom: Id.optional().describe('关卡入口房间 id；可达性检查（R012）的起点'),
    description: z.string().max(2000).optional().describe('给人/AI 看的关卡说明'),
  })
  .describe('关卡级元数据');
export type DocumentMeta = z.infer<typeof DocumentMeta>;

/**
 * RoomGraphDocument —— 关卡的**唯一真相**。
 *
 * 设计目标（docs/SCOPE.md P1）：一个 30 房间的关卡序列化后 < 1500 行、< 20k tokens，
 * 可以整份放进 LLM 上下文。因此这里只存**意图**（拓扑关系、参数），
 * 不存任何推导结果（房间世界坐标由 solver 计算，绝不写入文档）。
 */
export const RoomGraphDocument = z
  .strictObject({
    schemaVersion: z
      .string()
      .describe(`文档遵循的 schema 版本。当前代码支持：${SUPPORTED_SCHEMA_VERSIONS.join(', ')}`),
    meta: DocumentMeta,
    themes: z.array(Theme).min(1).describe('主题库；每个房间必须引用其中之一'),
    rooms: z.array(Room).default([]),
    connections: z.array(Connection).default([]).describe('房间之间的串联关系'),
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
    connections: [],
  } satisfies RoomGraphDocumentInput);
}
