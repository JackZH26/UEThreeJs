/**
 * @tjre/scene —— RoomGraph + Layout → three.js 场景
 *
 * 这是**唯一**允许 import three 的库包（`@tjre/core` 与 `@tjre/schema` 必须
 * 保持零 three.js 依赖，以便 headless 运行）。
 *
 * three 的解析由 `three.alias.ts` 统一定义，运行时指向 submodule 的预构建产物，
 * 类型来自 `@types/three`（版本须与 submodule 的 r185 对应）。
 *
 * ⚠️ **这里刻意使用具名再导出，不用 `export *`。**
 *
 * 原因是踩过的一个真实故障：本包通过 Vite alias 以**源码**形式被编辑器消费，
 * HMR 会给链条中被改动的模块打上 `?t=<时间戳>` 失效标记。星号再导出的绑定名
 * 浏览器无法静态确定，当内外层模块的版本标记不一致时绑定解析会失败并抛
 * `SyntaxError: ... does not provide an export named 'buildScene'`。
 * 更糟的是浏览器会缓存这个坏掉的模块实例，普通刷新救不回来 ——
 * 表现为"整页只剩背景色，且没有任何错误提示"。
 * 具名再导出让绑定可被静态解析，不受此影响。
 */

export { MaterialLibrary } from './materials.js';
export type { MaterialLibraryOptions } from './materials.js';

export { buildCeilingGeometry, buildFloorGeometry, buildWallGeometry } from './shell.js';
export type { WallGeometryResult } from './shell.js';

export { buildScene } from './buildScene.js';
export type { BuildSceneOptions, BuildSceneResult } from './buildScene.js';

export { buildStructureGeometry, rampLength, stairMetrics } from './structures.js';
export type { StructureGeometryResult } from './structures.js';

export { PORTAL_FRAME_MATERIAL, PORTAL_SURFACE_MATERIAL, buildPortalGeometry } from './portal.js';
export type { PortalGeometryResult } from './portal.js';
