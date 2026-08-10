/**
 * `@tjre/core/node` —— 依赖 Node 内置模块的文件 IO。
 *
 * 与主入口分开的原因：`packages/scene` 与 `apps/editor` 要在**浏览器**里
 * 使用 `@tjre/core` 的解析与求解逻辑。如果主入口顶层 import 了 `node:fs`，
 * Vite 打包时会报错或塞进一堆 polyfill。
 *
 * 因此：
 *   `@tjre/core`       → 纯逻辑，浏览器与 Node 通用
 *   `@tjre/core/node`  → 文件系统访问，仅 CLI / CI / 脚本可用
 */

import { readFileSync, writeFileSync } from 'node:fs';
import type { RoomGraphDocument } from '@tjre/schema';
import { parseDocument, serializeDocument } from './io.js';
import type { LoadResult } from './io.js';

export function loadDocumentFile(path: string): LoadResult {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    return {
      ok: false,
      errors: [
        {
          rule: 'IO',
          severity: 'error',
          path,
          message: `读取文件失败：${cause instanceof Error ? cause.message : String(cause)}`,
          hint: '检查路径是否正确、文件是否存在。',
        },
      ],
    };
  }
  return parseDocument(text, path);
}

export function saveDocumentFile(path: string, doc: RoomGraphDocument): void {
  writeFileSync(path, serializeDocument(doc), 'utf8');
}
