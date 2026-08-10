import type { RoomGraphDocument } from '@tjre/schema';
import type { Diagnostic, Rule, ValidationResult } from './diagnostics.js';
import { summarize } from './diagnostics.js';
import { ALL_RULES } from './rules/index.js';

/**
 * 对一份**已通过 schema 解析**的文档跑语义校验。
 *
 * 分两层是有意的：
 *   1. schema 层（Zod）—— 结构、类型、必填、枚举、strict 拒未知字段
 *   2. 语义层（本函数）—— 跨字段/跨对象的一致性规则
 *
 * 只有第 1 层通过后才会进入第 2 层，否则规则无法假设数据形状。
 */
export function validateDocument(
  doc: RoomGraphDocument,
  rules: readonly Rule[] = ALL_RULES,
): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  for (const rule of rules) {
    rule.check(doc, (d) => {
      diagnostics.push({ rule: rule.id, ...d });
    });
  }

  // 稳定排序：先按 severity（error 在前），再按 rule 编号，再按 path
  diagnostics.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  return summarize(diagnostics);
}
