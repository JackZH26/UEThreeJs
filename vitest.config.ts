import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { threeAlias } from './three.alias.js';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@tjre/schema': r('./packages/schema/src/index.ts'),
      // 子路径必须排在裸包名之前，否则 '@tjre/core' 会先命中并把 '/node' 截断
      '@tjre/core/node': r('./packages/core/src/node.ts'),
      '@tjre/core': r('./packages/core/src/index.ts'),
      '@tjre/scene': r('./packages/scene/src/index.ts'),
      // three 的别名与编辑器共用 three.alias.ts 的定义，避免两处漂移
      // 导致 three.core.js 被加载两次（pnpm verify:three 守着这一点）
      ...threeAlias,
    },
  },
  test: {
    include: ['packages/**/test/**/*.test.ts', 'apps/**/test/**/*.test.ts'],
    // `**/node_modules/**` 是必须的：pnpm workspace 会在 apps/*/node_modules/@tjre/*
    // 建立指向 packages/* 的 symlink，只排除顶层会导致同一批测试被跑两遍。
    exclude: ['three.js/**', '**/node_modules/**'],
    environment: 'node',
  },
});
