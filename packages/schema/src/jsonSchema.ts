import { z } from 'zod';
import { RoomGraphDocument } from './document.js';
import { Structure } from './structure.js';
import { Opening } from './opening.js';
import { Room, Connection } from './room.js';

/**
 * 生成 JSON Schema —— 这是喂给外部 AI agent（Cindy / Codex / Claude Code）的**机器契约**。
 *
 * 用 `input` 形态：agent 写文档时不需要提供有默认值的字段。
 */
export function toJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(RoomGraphDocument, { io: 'input', target: 'draft-2020-12' }) as Record<
    string,
    unknown
  >;
}

/** 按片段导出，便于 agent 局部编辑时只加载需要的部分（省 token） */
export function toJsonSchemaFragments(): Record<string, Record<string, unknown>> {
  const opts = { io: 'input', target: 'draft-2020-12' } as const;
  return {
    document: z.toJSONSchema(RoomGraphDocument, opts) as Record<string, unknown>,
    room: z.toJSONSchema(Room, opts) as Record<string, unknown>,
    opening: z.toJSONSchema(Opening, opts) as Record<string, unknown>,
    structure: z.toJSONSchema(Structure, opts) as Record<string, unknown>,
    connection: z.toJSONSchema(Connection, opts) as Record<string, unknown>,
  };
}
