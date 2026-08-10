import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { z } from 'zod';
import { RoomGraphDocument, SUPPORTED_SCHEMA_VERSIONS } from '@tjre/schema';
import type { Diagnostic } from './diagnostics.js';

export interface LoadSuccess {
  ok: true;
  doc: RoomGraphDocument;
}

export interface LoadFailure {
  ok: false;
  /** schema / 解析阶段的错误，形态与语义校验的诊断保持一致 */
  errors: Diagnostic[];
}

export type LoadResult = LoadSuccess | LoadFailure;

/** 把 Zod 的 issue 转成本项目统一的 Diagnostic 形态 */
function zodIssuesToDiagnostics(error: z.ZodError): Diagnostic[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    const hint =
      issue.code === 'unrecognized_keys'
        ? '文档 schema 是 strict 的：出现未知字段通常是拼写错误。请对照 docs/generated/roomgraph.document.schema.json 核对字段名。'
        : undefined;
    return {
      rule: 'SCHEMA',
      severity: 'error' as const,
      path,
      message: issue.message,
      ...(hint === undefined ? {} : { hint }),
    };
  });
}

/** 解析文本（YAML 或 JSON 均可，YAML 是 JSON 的超集） */
export function parseDocument(text: string, sourceLabel = '<input>'): LoadResult {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          rule: 'PARSE',
          severity: 'error',
          path: sourceLabel,
          message: `YAML 解析失败：${cause instanceof Error ? cause.message : String(cause)}`,
          hint: '检查缩进与引号。YAML 对缩进敏感，列表项需以 "- " 开头。',
        },
      ],
    };
  }

  if (raw === null || typeof raw !== 'object') {
    return {
      ok: false,
      errors: [
        {
          rule: 'PARSE',
          severity: 'error',
          path: sourceLabel,
          message: '文档顶层必须是一个对象（含 schemaVersion / meta / themes / rooms 等字段）。',
        },
      ],
    };
  }

  // 版本检查先行 —— 版本不符时字段形状可能完全不同，先给出可操作的提示
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'string' && !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    return {
      ok: false,
      errors: [
        {
          rule: 'VERSION',
          severity: 'error',
          path: 'schemaVersion',
          message: `文档 schemaVersion 是 "${version}"，当前代码支持 ${SUPPORTED_SCHEMA_VERSIONS.join(', ')}。`,
          hint: '运行迁移脚本升级文档（见 packages/schema/src/migrations/），不要手改版本号。',
        },
      ],
    };
  }

  const parsed = RoomGraphDocument.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: zodIssuesToDiagnostics(parsed.error) };
  }
  return { ok: true, doc: parsed.data };
}

/**
 * 序列化为 YAML。
 *
 * 关键约束（docs/CONVENTIONS.md §4.2）：**输出必须确定性** ——
 * 同一份文档序列化两次必须逐字节相同，否则 write-through 会产生
 * 虚假的文件变更、触发无意义的热重载，并让 git diff 充满噪声。
 */
export function serializeDocument(doc: RoomGraphDocument): string {
  return stringifyYaml(doc, {
    indent: 2,
    lineWidth: 100,
    // 保持插入顺序，不做字母排序 —— 顺序本身携带作者意图
    sortMapEntries: false,
    nullStr: 'null',
  });
}
