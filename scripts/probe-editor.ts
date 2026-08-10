/**
 * 编辑器运行期自检 —— 用 CDP 真开一个浏览器把编辑器跑起来，收集控制台错误与
 * 渲染状态，然后打印结论。
 *
 * 存在原因：WebGPU 管线的错误**只在真实 GPU 上才会出现**（MSAA 与深度纹理
 * 拷贝不兼容、SSR 缺环境贴图导致着色器构建失败……），headless 单测抓不到，
 * 而"起服务让人肉眼看"既慢又容易漏掉一屏之外的报错。
 *
 * 用法：
 *   1. 先起 dev server（pnpm dev）
 *   2. pnpm probe:editor [url] [--shots <目录>]
 *
 * 带 `--shots` 时会遍历关卡下拉里的每个关卡各截一张图 —— 影调这种事
 * 只能看图判断，但"有没有报错、有没有在渲染"必须机器判断。
 *
 * 退出码：0 = 干净；1 = 有错误 / 未渲染。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const shotsIndex = args.indexOf('--shots');
const SHOTS_DIR = shotsIndex >= 0 ? args[shotsIndex + 1] : undefined;
const URL_UNDER_TEST = args.find((a) => a.startsWith('http')) ?? 'http://localhost:5173/';
const CDP_PORT = 19222;
/** 给 WebGPU 初始化 + 着色器编译 + 若干帧留出的时间 */
const OBSERVE_MS = 20_000;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

function findChrome(): string {
  const found = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (found === undefined) {
    throw new Error(`找不到 Chrome，试过：\n${CHROME_CANDIDATES.join('\n')}`);
  }
  return found;
}

async function waitForCdp(timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = (await res.json()) as {
        type: string;
        url: string;
        webSocketDebuggerUrl?: string;
      }[];
      const page = targets.find(
        (t) =>
          t.type === 'page' &&
          t.webSocketDebuggerUrl !== undefined &&
          !t.url.startsWith('devtools'),
      );
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl;
    } catch {
      // CDP 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('CDP 未在超时内就绪');
}

interface Finding {
  kind: 'console' | 'exception';
  text: string;
}

/** 从右侧面板读回来的一个关卡的实测状态 */
interface LevelState {
  level: string;
  canvas: { w: number; h: number } | null;
  frames: string | null;
  backend: string | null;
  meshes: string | null;
  lights: string | null;
}

async function main(): Promise<number> {
  const chrome = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'tjre-probe-'));

  const child = spawn(
    chrome,
    [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      // 后台标签会被节流，动画循环就不跑了 —— 必须关掉这些节流
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  const findings: Finding[] = [];
  let socket: WebSocket | undefined;

  try {
    const wsUrl = await waitForCdp();
    socket = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      socket?.addEventListener('open', () => {
        resolve();
      });
      socket?.addEventListener('error', () => {
        reject(new Error('CDP WebSocket 连接失败'));
      });
    });

    let nextId = 1;
    const pending = new Map<number, (value: unknown) => void>();

    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        result?: unknown;
        params?: Record<string, unknown>;
      };
      if (msg.id !== undefined) {
        pending.get(msg.id)?.(msg.result);
        pending.delete(msg.id);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled') {
        const p = msg.params as {
          type: string;
          args?: { value?: unknown; description?: string }[];
        };
        if (p.type !== 'error' && p.type !== 'warning') return;
        const text = (p.args ?? [])
          .map((a) => String(a.value ?? a.description ?? ''))
          .join(' ')
          .trim();
        findings.push({ kind: 'console', text });
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const p = msg.params as {
          exceptionDetails?: { exception?: { description?: string }; text?: string };
        };
        findings.push({
          kind: 'exception',
          text:
            p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text ?? '未知异常',
        });
      }
    });

    const send = (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        socket?.send(JSON.stringify({ id, method, params }));
      });
    };

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: URL_UNDER_TEST });

    process.stdout.write(`观察 ${OBSERVE_MS / 1000}s …\n`);
    await new Promise((r) => setTimeout(r, OBSERVE_MS));

    /** 读页面面板上的实测状态 */
    const readState = async (): Promise<LevelState> => {
      const probe = (await send('Runtime.evaluate', {
        expression: `(() => {
          const c = document.querySelector('canvas');
          const rows = [...document.querySelectorAll('aside span')].map(s => s.textContent ?? '');
          const grab = (label) => {
            const i = rows.findIndex(r => r.startsWith(label));
            return i >= 0 ? rows[i + 1] : null;
          };
          const sel = [...document.querySelectorAll('aside select')][0];
          return JSON.stringify({
            level: sel ? (sel.options[sel.selectedIndex]?.textContent ?? '?') : '?',
            canvas: c === null ? null : { w: c.clientWidth, h: c.clientHeight },
            frames: grab('已渲染帧') ?? grab('Frames'),
            backend: grab('渲染后端') ?? grab('Render backend'),
            meshes: grab('Mesh 数') ?? grab('Meshes'),
            lights: grab('光源') ?? grab('Lights'),
          });
        })()`,
        returnByValue: true,
      })) as { result?: { value?: string } };
      return JSON.parse(probe.result?.value ?? '{}') as LevelState;
    };

    const states: LevelState[] = [];

    // ── 逐关卡：切换 → 等待 → 读状态 → 截图 ─────────────
    const levels = (await send('Runtime.evaluate', {
      expression: `(() => { const s = [...document.querySelectorAll('aside select')][0];
        return String(s ? s.options.length : 0); })()`,
      returnByValue: true,
    })) as { result?: { value?: string } };
    const count = Math.max(1, Number.parseInt(levels.result?.value ?? '1', 10));

    if (SHOTS_DIR !== undefined) mkdirSync(SHOTS_DIR, { recursive: true });

    for (let i = 0; i < count; i++) {
      if (i > 0) {
        await send('Runtime.evaluate', {
          expression: `(() => {
            const sel = [...document.querySelectorAll('aside select')][0];
            sel.selectedIndex = ${i};
            sel.dispatchEvent(new Event('change', { bubbles: true }));
          })()`,
          returnByValue: true,
        });
        // 换关卡会重建整条管线（新渲染器 + 重新编译着色器），要给足时间；
        // TRAA / 时域降噪还需要累积若干帧才收敛
        await new Promise((r) => setTimeout(r, 9000));
      }

      const state = await readState();
      states.push(state);

      if (SHOTS_DIR !== undefined) {
        const label = state.level.replace(/[^\w.-]+/g, '_');
        const shot = (await send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
        if (shot.data !== undefined) {
          writeFileSync(
            join(SHOTS_DIR, `${String(i)}-${label}.png`),
            Buffer.from(shot.data, 'base64'),
          );
        }
      }
    }

    // ── 报告 ──────────────────────────────────────────
    // ⚠️ 控制台必须在**遍历完所有关卡之后**才汇总。
    // 踩过：第一版在切关卡前就把控制台打印了，结果 L 规格（唯一用面光源的）
    // 抛的 RectAreaLight LTC 错误压根没被打出来 —— 只看到一张黑图却"控制台干净"。
    process.stdout.write('\n── 各关卡状态 ────────────────────────\n');
    for (const s of states) {
      process.stdout.write(
        `${s.level.padEnd(22)} canvas ${s.canvas === null ? '—' : `${s.canvas.w}×${s.canvas.h}`} · ` +
          `${s.backend ?? '?'} · 帧 ${s.frames ?? '?'} · mesh ${s.meshes ?? '?'} · 光源 ${s.lights ?? '?'}\n`,
      );
    }
    if (SHOTS_DIR !== undefined) process.stdout.write(`\n截图目录：${SHOTS_DIR}\n`);

    const unique = [...new Set(findings.map((f) => `[${f.kind}] ${f.text}`))];
    process.stdout.write(`\n── 控制台（全程）─────────────────────\n`);
    if (unique.length === 0) {
      process.stdout.write('无 error / warning ✓\n');
    } else {
      for (const line of unique.slice(0, 15)) {
        process.stdout.write(`${line.slice(0, 400)}\n`);
      }
      if (unique.length > 15) process.stdout.write(`…还有 ${unique.length - 15} 条\n`);
      process.stdout.write(`\n（去重后 ${unique.length} 条 / 原始 ${findings.length} 条）\n`);
    }

    const stalled = states.filter(
      (s) => s.canvas === null || Number.parseInt(s.frames ?? '0', 10) <= 0,
    );
    const ok = stalled.length === 0 && unique.length === 0;
    process.stdout.write(
      `\n结论：${stalled.length === 0 ? '✓ 每个关卡都在渲染' : `✗ 未渲染：${stalled.map((s) => s.level).join(', ')}`}` +
        `${unique.length === 0 ? '，控制台干净' : `，有 ${unique.length} 条控制台消息`}\n`,
    );

    return ok ? 0 : 1;
  } finally {
    socket?.close();
    child.kill();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (cause: unknown) => {
    process.stderr.write(`探测失败：${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exitCode = 1;
  },
);
