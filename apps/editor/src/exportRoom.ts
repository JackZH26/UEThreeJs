import { buildRoom, exportGLB, roomExportExtras } from '@tjre/scene';
import type { ExportGLBResult } from '@tjre/scene';
import type { Room, RoomGraphDocument } from '@tjre/schema';
import { EXPORT_ROUTE, REVEAL_ROUTE } from '../exportRoutes.js';

/**
 * ============================================================
 *  浏览器侧的 GLB 导出
 * ============================================================
 *
 *  ── 为什么重新构建房间，而不是直接导视口里那棵树 ──────────────
 *  视口里的树是**按当前显示开关**构建的：天花可能关着、结构件可能关着、
 *  线框可能开着。拿它去导出，产物就取决于一堆看不见的 UI 状态 ——
 *  同一个房间点两次会得到不同的文件，而人根本不知道为什么。
 *
 *  所以这里**重新构建一份完整外壳**（天花 / 结构件 / 灯光全开），
 *  与 `tjre export` 的默认行为逐项一致，导完立刻 `dispose()`。
 *  代价是多构建一次几何（最大的房间 7.4k 三角形，可忽略），
 *  换来的是「按钮的产物 = CLI 的产物」这个可预期性。
 */

/** CLI 的默认命名规则：`<关卡文件名去后缀>.<房间 id>.glb` —— 两边保持一致 */
export function glbFileName(levelStem: string, roomId: string): string {
  return `${levelStem}.${roomId}.glb`;
}

export interface ExportOutcome {
  fileName: string;
  bytes: number;
  /** 被跳过的面光源 id（glTF 的 KHR_lights_punctual 不支持 area light） */
  skippedAreaLights: string[];
  /**
   * 字节最终去了哪里：
   * · `'out'` —— 经 dev server 写进仓库的 `out/`（`path` 是绝对路径）
   * · `'download'` —— 桥不可用，回落成浏览器下载（落在下载目录，`path` 为 null）
   */
  target: 'out' | 'download';
  path: string | null;
}

interface BridgeResponse {
  ok?: unknown;
  path?: unknown;
  dir?: unknown;
  error?: unknown;
}

/**
 * 试着经 dev server 把字节写进 `out/`。
 *
 * 返回绝对路径，或 `null` 表示桥不可用（`vite preview`、静态托管、
 * 或者干脆没跑 dev server）。**不抛异常** —— 桥缺失是预期情形，
 * 调用方应当回落到浏览器下载而不是报错。
 */
async function writeToOutDir(fileName: string, glb: Uint8Array): Promise<string | null> {
  try {
    const response = await fetch(`${EXPORT_ROUTE}?name=${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers: { 'content-type': 'model/gltf-binary' },
      body: new Blob([glb as BlobPart], { type: 'model/gltf-binary' }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as BridgeResponse;
    return typeof payload.path === 'string' ? payload.path : null;
  } catch {
    // 端点不存在 / 网络层失败 —— 都当成"桥不可用"
    return null;
  }
}

/** 回落路径：交给浏览器下载。 */
function downloadInBrowser(fileName: string, glb: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([glb as BlobPart], { type: 'model/gltf-binary' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  // 立刻 revoke 会让部分浏览器把下载取消掉（点击是异步开始的），
  // 所以推到下一轮宏任务之后再释放
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 导出一个房间。
 *
 * `levelStem` 是关卡文件名去掉 `.roomgraph.yaml` 的部分，只用来拼默认文件名。
 */
export async function exportRoomGLB(
  doc: RoomGraphDocument,
  room: Room,
  levelStem: string,
): Promise<ExportOutcome> {
  const built = buildRoom(
    room,
    doc.themes.find((t) => t.id === room.theme),
    // ⚠️ 与 `apps/cli/src/commands/export.ts` 的默认值保持一致
    { showCeiling: true, showStructures: true, showProps: true, showLights: true },
  );

  let result: ExportGLBResult;
  try {
    result = await exportGLB(built.root, {
      includeLights: true,
      // 与 CLI 调**同一个** extras 构造器 —— 否则两条路径会静默漂移，
      // 而"按钮的产物 = CLI 的产物"这个性质会悄悄失效
      extras: roomExportExtras({
        schemaVersion: doc.schemaVersion,
        sourceFile: `${levelStem}.roomgraph.yaml`,
        room,
      }),
    });
  } finally {
    built.dispose();
  }

  const fileName = glbFileName(levelStem, room.id);
  const path = await writeToOutDir(fileName, result.glb);
  if (path === null) downloadInBrowser(fileName, result.glb);

  return {
    fileName,
    bytes: result.glb.byteLength,
    skippedAreaLights: result.skippedAreaLights,
    target: path === null ? 'download' : 'out',
    path,
  };
}

/**
 * 让 dev server 在系统文件管理器里打开 `out/`。
 *
 * 返回目录的绝对路径。桥不可用或命令失败时抛错 —— 与导出不同，
 * 这个动作**没有**有意义的回落（浏览器打不开本机目录），所以必须让用户看到失败。
 */
export async function revealOutDir(): Promise<string> {
  const response = await fetch(REVEAL_ROUTE, { method: 'POST' });
  // 桥没挂载时 vite 对 POST 返回 **404 + 空 body**（实测：SPA fallback 只对
  // `GET` + `Accept: text/html` 生效，POST 一律 404），所以 `json()` 会抛。
  // 把"解析不出 JSON"单独报成"桥没挂载"，比让用户看到一个裸的状态码有用 ——
  // 这也是这个按钮最可能的失败方式（跑的不是 pnpm dev）。
  const payload = (await response.json().catch(() => null)) as BridgeResponse | null;
  if (payload === null) {
    throw new Error(`${REVEAL_ROUTE} 没有响应 JSON —— dev server 的导出桥没有挂载`);
  }
  if (!response.ok || payload.ok !== true) {
    const detail = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return typeof payload.dir === 'string' ? payload.dir : 'out/';
}
