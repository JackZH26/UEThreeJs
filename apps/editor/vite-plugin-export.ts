import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { EXPORT_ROUTE, REVEAL_ROUTE } from './exportRoutes.js';

/**
 * ============================================================
 *  dev server 导出桥
 * ============================================================
 *
 *  浏览器**能**在本地生成 GLB（`GLTFExporter` 在浏览器里是原生支持的），
 *  但它做不到两件事：把字节写进仓库里的某个目录，以及打开系统文件管理器。
 *  这两件事只能由 dev server 进程代做，所以有这个插件。
 *
 *  ── 为什么不直接用浏览器下载 ────────────────────────────────
 *  `<a download>` 只能落到浏览器的下载目录，而 CLI 的 `tjre export --out out/x.glb`
 *  落在仓库的 `out/`。两边落在不同地方的话，「打开 out 目录」这个按钮就没有意义，
 *  而且同一个房间在两条路径下要去两个地方找文件。所以按钮走这个桥，
 *  **桥不可用时**才回落到浏览器下载（见 `src/exportRoom.ts`）。
 *
 *  ── 安全边界（这是个会写文件、会起进程的接口，必须说清）──────
 *  1. `apply: 'serve'` —— 只在 dev server 挂载。`vite build` 的产物里
 *     根本不存在这两个端点，不可能被部署出去。
 *  2. 写入路径**不接受**调用方给的路径，只接受一个文件名，且：
 *     逐字符白名单 → 剥掉开头的点 → 限长 → 最后再断言解析结果确实在 `out/` 里
 *     （三层里任何一层单独就够，叠起来是因为路径逃逸的代价太高）。
 *  3. `reveal` **没有任何参数** —— 它永远只打开固定的 `out/`。
 *     一个"打开我给的路径"的接口等于把本机文件管理器交给页面，不做。
 *  4. 用 `execFile` + 参数数组，不用 `exec` + 拼字符串 —— 后者会过 shell。
 *  5. 请求体有上限，避免一个跑飞的循环把 dev server 的内存吃光。
 */

/** 仓库里的导出目录 —— 与 CLI `--out out/xxx.glb` 是同一个地方 */
export const OUT_DIR = fileURLToPath(new URL('../../out', import.meta.url));

/** 64 MB。最大的示例房间是 548 KB，两个数量级的余量足够了 */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

/** 文件名长度上限：Windows 的单段上限是 255，留出余量 */
const MAX_NAME_LENGTH = 180;

/**
 * 把任意字符串收敛成一个安全的 `.glb` 文件名。
 *
 * 白名单式（而不是黑名单式）：只保留 `A-Za-z0-9._-`，其余一律变下划线。
 * 这样路径分隔符、引号、`$`、换行、NUL 等等**不需要逐个想到**就已经没了。
 * 随后剥掉开头的点，`..` 与 `.git` 之类就都进不来。
 *
 * 导出给测试用 —— 这是本文件里唯一有安全含义的纯函数。
 */
export function safeGlbName(raw: string | null | undefined): string {
  const cleaned = (raw ?? '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, MAX_NAME_LENGTH);
  const base = cleaned.length === 0 ? 'room' : cleaned;
  return /\.glb$/i.test(base) ? base : `${base}.glb`;
}

/**
 * 解析到 `out/` 内的绝对路径；越界返回 `null`。
 *
 * `safeGlbName` 之后理论上已经不可能越界，这里是**兜底断言** ——
 * 万一以后有人改了消毒规则，逃逸会在这里被拦住而不是变成写文件。
 */
export function resolveInOutDir(name: string): string | null {
  const target = resolve(OUT_DIR, name);
  const prefix = OUT_DIR.endsWith(sep) ? OUT_DIR : `${OUT_DIR}${sep}`;
  return target.startsWith(prefix) ? target : null;
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  // dev-only 接口，不缓存
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.byteLength;
    if (total > limit) throw new Error(`请求体超过 ${limit} 字节上限`);
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * 打开文件管理器的命令。
 *
 * ⚠️ Windows 的 `explorer.exe` **成功时也返回退出码 1**（一个众所周知的怪癖），
 * 所以那一侧必须忽略退出码，否则每次都会报"失败"。
 */
function revealCommand(): { file: string; args: string[]; ignoreExitCode: boolean } {
  switch (process.platform) {
    case 'win32':
      return { file: 'explorer.exe', args: [OUT_DIR], ignoreExitCode: true };
    case 'darwin':
      return { file: 'open', args: [OUT_DIR], ignoreExitCode: false };
    default:
      return { file: 'xdg-open', args: [OUT_DIR], ignoreExitCode: false };
  }
}

function handleExport(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '只接受 POST' });
    return;
  }

  // connect 会把匹配到的前缀从 url 里剥掉，所以这里只剩 `/?name=...`
  const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
  const name = safeGlbName(query.get('name'));
  const target = resolveInOutDir(name);
  if (target === null) {
    sendJson(res, 400, { ok: false, error: `文件名解析到了 out/ 之外：${name}` });
    return;
  }

  readBody(req, MAX_UPLOAD_BYTES).then(
    (body) => {
      if (body.byteLength === 0) {
        sendJson(res, 400, { ok: false, error: '请求体是空的' });
        return;
      }
      try {
        mkdirSync(OUT_DIR, { recursive: true });
        writeFileSync(target, body);
      } catch (cause) {
        sendJson(res, 500, {
          ok: false,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return;
      }
      sendJson(res, 200, { ok: true, path: target, dir: OUT_DIR, bytes: body.byteLength });
    },
    (cause: unknown) => {
      sendJson(res, 413, {
        ok: false,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    },
  );
}

function handleReveal(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: '只接受 POST' });
    return;
  }
  // 目录可能还不存在（没导出过任何东西），先建出来 ——
  // 否则文件管理器会弹一个"路径不存在"的框，比什么都不做更让人困惑
  try {
    mkdirSync(OUT_DIR, { recursive: true });
  } catch {
    // 建不出来就交给下面的命令去报错
  }

  const { file, args, ignoreExitCode } = revealCommand();
  execFile(file, args, (error) => {
    if (error !== null && !ignoreExitCode) {
      sendJson(res, 500, { ok: false, error: `${file}: ${error.message}`, dir: OUT_DIR });
      return;
    }
    sendJson(res, 200, { ok: true, dir: OUT_DIR });
  });
}

/**
 * 注册两个 dev-only 端点：
 *
 * · `POST /__tjre/export?name=<文件名>` —— 请求体是 GLB 字节，写进 `out/`
 * · `POST /__tjre/reveal` —— 在系统文件管理器里打开 `out/`（无参数）
 */
export function exportBridge(): Plugin {
  return {
    name: 'tjre:export-bridge',
    // 只在 dev server；构建产物里不存在这两个端点
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(EXPORT_ROUTE, handleExport);
      server.middlewares.use(REVEAL_ROUTE, handleReveal);
    },
  };
}
