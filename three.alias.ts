import { fileURLToPath } from 'node:url';

/**
 * three.js 的模块解析映射 —— **唯一来源**。
 *
 * 被 `vitest.config.ts` 与 `apps/editor/vite.config.ts` 共同引用，
 * 避免两处配置漂移（漂移的后果是 three.core.js 被加载两次，
 * 即经典的 "multiple instances of three.js"，`pnpm verify:three` 守着这一点）。
 *
 * 为什么指向**预构建产物**而不是 `src/`：
 *   · `build/` 随 three.js 仓库提交，且在 release tag 上与 `src/` 同步
 *   · `three.module.js` 与 `three.webgpu.js` 内部都 `import './three.core.js'`，
 *     相对路径解析到同一文件 → 天然单实例
 *   · 免去处理 three.js 源码里的 GLSL 模板字符串等构建期变换
 *
 * 类型来自 `@types/three`（**版本必须与 submodule 的 r185 对应**，
 * 见 docs/CONVENTIONS.md §2）。运行时走 submodule，类型走 npm 是有意的分工：
 * three.js 官方不发布 .d.ts。
 */
const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export const threeAlias: Record<string, string> = {
  // 顺序有意义：更具体的子路径必须排在 'three' 之前，
  // 否则 'three' 会先命中并把 'three/webgpu' 截断。
  'three/webgpu': r('./three.js/build/three.webgpu.js'),
  'three/tsl': r('./three.js/build/three.tsl.js'),
  'three/addons/': r('./three.js/examples/jsm/'),
  three: r('./three.js/build/three.module.js'),
};

/** Vite 需要数组形式才能保证匹配顺序（对象形式的键序不保证） */
export const threeAliasEntries: { find: string | RegExp; replacement: string }[] = [
  { find: /^three\/webgpu$/, replacement: threeAlias['three/webgpu'] as string },
  { find: /^three\/tsl$/, replacement: threeAlias['three/tsl'] as string },
  { find: /^three\/addons\//, replacement: threeAlias['three/addons/'] as string },
  { find: /^three$/, replacement: threeAlias.three as string },
];
