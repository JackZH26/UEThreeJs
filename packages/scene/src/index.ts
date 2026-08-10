/**
 * @tjre/scene —— RoomGraph + Layout → three.js 场景
 *
 * 这是**唯一**允许 import three 的库包（`@tjre/core` 与 `@tjre/schema` 必须
 * 保持零 three.js 依赖，以便 headless 运行）。
 *
 * three 的解析由 `three.alias.ts` 统一定义，运行时指向 submodule 的预构建产物，
 * 类型来自 `@types/three`（版本须与 submodule 的 r185 对应）。
 */
export * from './materials.js';
export * from './shell.js';
export * from './buildScene.js';
