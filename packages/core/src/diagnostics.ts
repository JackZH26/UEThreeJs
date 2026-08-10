/**
 * 诊断信息 —— 校验器的输出。
 *
 * 设计要求（docs/CONVENTIONS.md §4.4）：每条诊断必须**可操作**。
 * `message` 说清哪里错了，`hint` 说清怎么改。这两个字段会被外部 AI agent
 * 直接读取用于自我修正，措辞含糊等于让 agent 瞎猜。
 */

import type { RoomGraphDocument } from '@tjre/schema';

export type Severity = 'error' | 'warning';

export interface Diagnostic {
  /** 规则编号，见 docs/generated/RULES.md */
  rule: string;
  severity: Severity;
  /** 问题描述：哪里、什么错了 */
  message: string;
  /** 定位路径，例如 `rooms[2].openings[0].offset` */
  path: string;
  /** 修复建议 —— 专门写给 AI agent 看 */
  hint?: string;
}

export type Reporter = (d: Omit<Diagnostic, 'rule'>) => void;

export interface Rule {
  id: string;
  title: string;
  check(doc: RoomGraphDocument, report: Reporter): void;
}

export interface ValidationResult {
  ok: boolean;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  all: Diagnostic[];
}

export function summarize(diagnostics: Diagnostic[]): ValidationResult {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings, all: diagnostics };
}

/** 把诊断格式化为人类/AI 都好读的文本 */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) return '  （无）';
  return diagnostics
    .map((d) => {
      const icon = d.severity === 'error' ? '✗' : '!';
      const head = `  ${icon} [${d.rule}] ${d.path}`;
      const body = `      ${d.message}`;
      const hint = d.hint ? `\n      → ${d.hint}` : '';
      return `${head}\n${body}${hint}`;
    })
    .join('\n');
}
