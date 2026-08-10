/**
 * 退出码约定 —— CI 与外部 AI agent 依赖这些数值做分支判断，不得随意改动。
 * 见 docs/AI_GUIDE.md。
 */
export const ExitCode = {
  /** 一切正常（可能有 warning） */
  OK: 0,
  /** 文档存在 error 级问题（schema 或语义校验未通过） */
  VALIDATION_FAILED: 1,
  /** 用法错误：未知子命令、缺参数、文件读不到 */
  USAGE: 2,
  /** 内部错误（bug） */
  INTERNAL: 70,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];
