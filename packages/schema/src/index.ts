/**
 * @tjre/schema —— RoomGraph 文档 schema
 *
 * 单一来源，三种产出：
 *   1. TypeScript 类型（编译期）
 *   2. 运行时校验（Zod）
 *   3. JSON Schema（供 AI agent 做结构化输出 / 校验，见 `pnpm schema:emit`）
 *
 * 本包必须保持**零 three.js 依赖**，以便在 CLI / CI / AI agent 中 headless 运行。
 * 该约束由 eslint 的 no-restricted-imports 规则强制。
 */

export * from './primitives.js';
export * from './spec.js';
export * from './prefab.js';
export * from './opening.js';
export * from './structure.js';
export * from './content.js';
export * from './room.js';
export * from './document.js';
export * from './jsonSchema.js';
