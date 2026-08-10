/**
 * @tjre/core —— 文档 IO、校验器、命令层
 *
 * 本包必须保持**零 three.js 依赖**（由 eslint no-restricted-imports 强制），
 * 以便在 CLI / CI / 外部 AI agent 中 headless 运行。
 */

export * from './diagnostics.js';
export * from './lookup.js';
export * from './validate.js';
export * from './io.js';
export * from './command.js';
export * from './solver/index.js';
export { ALL_RULES } from './rules/index.js';
