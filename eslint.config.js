import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    // three.js 是 submodule（只读参考），生成物与产物不参与 lint。
    // `.probe/` 是运行期探针的临时目录（dev server 日志、截图、一次性脚本），
    // `out/` 是导出产物 —— 两者都在 .gitignore 里，不是仓库资产。
    ignores: [
      'three.js/**',
      '**/dist/**',
      'docs/generated/**',
      'coverage/**',
      '.probe/**',
      'out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      /* docs/CONVENTIONS.md §4.1：禁 any */
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'no-console': 'off',
    },
  },
  {
    // packages/core 不得依赖 three.js —— 保证可 headless 运行（CLI / CI / AI agent）
    files: ['packages/core/**/*.ts', 'packages/schema/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['three', 'three/*', '**/three.js/**'],
              message:
                'packages/core 与 packages/schema 必须保持零 three.js 依赖（见 docs/CONVENTIONS.md §4.1 依赖方向）。',
            },
          ],
        },
      ],
    },
  },
);
