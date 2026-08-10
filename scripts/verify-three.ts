/**
 * 验证 three.js submodule 的接线是否正确。用法：pnpm verify:three
 *
 * 检查三件事：
 *   1. submodule 已初始化，且 build/ 与 src/ 的 REVISION 一致（锁在 release tag 上）
 *   2. `three.module.js`（WebGL 入口）与 `three.webgpu.js`（WebGPU 入口）
 *      **共享同一份 three.core.js** —— 否则会踩经典的
 *      "multiple instances of three.js" 坑：两份 core 各有一套类，
 *      跨入口传对象时行为异常。
 *   3. 两个入口暴露的 REVISION 相同
 *
 * 这项检查放在 CI 里，是因为一旦 submodule 被换成 npm 依赖、
 * 或 alias 写错指向 src/ 与 build/ 混用，问题会非常难查。
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const threeDir = resolve(root, 'three.js');
const buildDir = resolve(threeDir, 'build');

let failed = false;
const pass = (msg: string): void => console.log(`  ✓ ${msg}`);
const fail = (msg: string, hint?: string): void => {
  failed = true;
  console.log(`  ✗ ${msg}`);
  if (hint !== undefined) console.log(`      → ${hint}`);
};

console.log('\nthree.js submodule 接线检查\n');

// ── 1. submodule 是否就位 ──────────────────────────────
if (!existsSync(resolve(threeDir, 'package.json'))) {
  fail(
    'three.js submodule 未初始化',
    '运行 `git submodule update --init --depth 1`（或克隆时加 --recurse-submodules）',
  );
  process.exit(1);
}

const REVISION_RE = /REVISION\s*=\s*['"]([^'"]+)['"]/;

function revisionOf(file: string): string | null {
  if (!existsSync(file)) return null;
  const match = REVISION_RE.exec(readFileSync(file, 'utf8'));
  return match?.[1] ?? null;
}

const srcRevision = revisionOf(resolve(threeDir, 'src/constants.js'));
const coreRevision = revisionOf(resolve(buildDir, 'three.core.js'));

if (srcRevision === null || coreRevision === null) {
  fail(
    '读不到 REVISION',
    '检查 three.js/src/constants.js 与 three.js/build/three.core.js 是否存在',
  );
} else if (srcRevision !== coreRevision) {
  fail(
    `src/ 与 build/ 的 REVISION 不一致：src=${srcRevision}, build=${coreRevision}`,
    'submodule 被指向了一个 dev commit。请把它锁到 release tag（如 r185）—— build/ 只在发版时重新生成。',
  );
} else {
  pass(`REVISION 一致：r${srcRevision}（src/ 与 build/ 同步）`);
}

// ── 2. 预构建入口文件是否齐全 ──────────────────────────
const required = ['three.core.js', 'three.module.js', 'three.webgpu.js', 'three.tsl.js'];
const missing = required.filter((f) => !existsSync(resolve(buildDir, f)));
if (missing.length > 0) {
  fail(
    `build/ 缺少文件：${missing.join(', ')}`,
    'three.js 的 build/ 应随仓库提交。确认 submodule 指向 release tag 而非某个未构建的分支。',
  );
} else {
  pass(`预构建入口齐全：${required.join(', ')}`);
}

// ── 3. 单实例检查（关键项）─────────────────────────────
if (!failed) {
  // Windows 上动态 import 绝对路径必须转成 file:// URL
  const [webgl, webgpu] = await Promise.all([
    import(pathToFileURL(resolve(buildDir, 'three.module.js')).href),
    import(pathToFileURL(resolve(buildDir, 'three.webgpu.js')).href),
  ]);

  // Vector3 由 three.core.js 定义，被两个入口 re-export。
  // 若两处拿到的是同一个类对象，说明 core 只被加载了一次。
  if (webgl.Vector3 === webgpu.Vector3 && webgl.Object3D === webgpu.Object3D) {
    pass('单实例：three.module.js 与 three.webgpu.js 共享同一份 three.core.js');
  } else {
    fail(
      'three.core.js 被加载了两次（multiple instances of three.js）',
      'alias 必须让两个入口的相对 import "./three.core.js" 解析到同一文件；' +
        '不要把一个入口指向 build/ 另一个指向 src/。',
    );
  }

  if (webgl.REVISION === webgpu.REVISION) {
    pass(`两个入口 REVISION 相同：r${String(webgl.REVISION)}`);
  } else {
    fail(`两个入口 REVISION 不同：${String(webgl.REVISION)} vs ${String(webgpu.REVISION)}`);
  }
}

console.log(failed ? '\n✗ three.js 接线检查未通过\n' : '\n✓ three.js 接线检查通过\n');
process.exit(failed ? 1 : 0);
