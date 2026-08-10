import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@tjre/schema': r('./packages/schema/src/index.ts'),
      '@tjre/core': r('./packages/core/src/index.ts'),
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
