import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { threeAliasEntries } from '../../three.alias.js';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // 数组形式：Vite 按顺序匹配，能保证 'three/webgpu' 先于 'three' 命中
    alias: [
      { find: /^@tjre\/schema$/, replacement: r('../../packages/schema/src/index.ts') },
      { find: /^@tjre\/core$/, replacement: r('../../packages/core/src/index.ts') },
      { find: /^@tjre\/scene$/, replacement: r('../../packages/scene/src/index.ts') },
      // three 的别名来自仓库根的 three.alias.ts，与 vitest 共用同一份定义。
      // 注意：这里**没有** @tjre/core/node —— 那个入口依赖 node:fs，
      // 浏览器侧只能用纯逻辑入口。
      ...threeAliasEntries,
    ],
  },
  server: { port: 5173, open: false },
  build: { target: 'esnext', outDir: 'dist', sourcemap: true },
});
