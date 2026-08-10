import type { ExportOptions } from './commands/export.js';
import type { ExitCode } from './exit.js';

/**
 * 需要懒加载的命令都放在这里。
 *
 * ── 为什么要懒加载 ──────────────────────────────────────────
 * `export` 命令要用 `@tjre/scene`，那会把整个 three.js 拉进来。
 * `validate` / `describe` 是最常用的两个命令（AI agent 每次编辑后都跑），
 * 不该为一个用不到的导出功能付启动代价。
 *
 * ── 为什么单独一个文件而不是直接写在 index.ts 里 ─────────────
 * **tsx 的一个 bug**：当一个文件同时含有 shebang 和动态 `import()` 时，
 * tsx 的 `transformDynamicImport` 会先用一个轻量 ESM 解析器扫全文，
 * 而那个解析器**不剥离 shebang** —— 于是 `#!/usr/bin/env -S node ...`
 * 里的 `/usr/` 被当成正则字面量，接着整个文件被错误切词，最后抛出
 * `Parse error`（报的位置还是错的，指向第 2 行，很误导）。
 *
 * 实测：带 shebang + 动态 import 必挂；去掉任意一个都正常。
 * `index.ts` 需要 shebang（`bin` 入口要能直接执行），所以把动态 import
 * 挪到这个**没有 shebang**的模块里。
 *
 * 静态 import 本模块的代价可以忽略：它只有类型导入和一个函数声明，
 * 真正的 `import('./commands/export.js')` 只在被调用时才执行。
 */
export async function loadExportCommand(): Promise<(options: ExportOptions) => Promise<ExitCode>> {
  const { runExport } = await import('./commands/export.js');
  return runExport;
}
