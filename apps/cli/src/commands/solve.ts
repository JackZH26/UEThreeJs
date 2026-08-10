import { loadDocumentFile, solveLayout, validateDocument, formatDiagnostics } from '@tjre/core';
import type { LayoutBounds, RoomPlacement } from '@tjre/core';
import { ExitCode } from '../exit.js';

export interface SolveOptions {
  file: string;
  json: boolean;
  /** 输出 ASCII 俯视图 —— 让人和 AI 无需 3D 视口即可核对布局 */
  map: boolean;
}

export function runSolve(options: SolveOptions): ExitCode {
  const loaded = loadDocumentFile(options.file);
  if (!loaded.ok) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, diagnostics: loaded.errors }, null, 2)}\n`,
      );
    } else {
      process.stderr.write(`✗ 无法加载 ${options.file}\n`);
      process.stderr.write(`${formatDiagnostics(loaded.errors)}\n`);
    }
    return ExitCode.VALIDATION_FAILED;
  }

  // 求解器假定引用完整性成立（R011 / R012），所以先跑语义校验
  const semantic = validateDocument(loaded.doc);
  if (!semantic.ok) {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, stage: 'semantic', diagnostics: semantic.errors }, null, 2)}\n`,
      );
    } else {
      process.stderr.write('✗ 语义校验未通过，无法求解布局：\n');
      process.stderr.write(`${formatDiagnostics(semantic.errors)}\n`);
      process.stderr.write('\n  先跑 `tjre validate` 修完 error 再求解。\n');
    }
    return ExitCode.VALIDATION_FAILED;
  }

  const layout = solveLayout(loaded.doc);
  const placements = [...layout.placements.values()].sort((a, b) => (a.roomId < b.roomId ? -1 : 1));

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        { ok: layout.ok, bounds: layout.bounds, placements, diagnostics: layout.diagnostics },
        null,
        2,
      )}\n`,
    );
    return layout.ok ? ExitCode.OK : ExitCode.VALIDATION_FAILED;
  }

  console.log(`\n布局求解：${options.file}\n`);
  console.log('  房间              世界坐标 (x, z)        旋转    尺寸 (X×Z)     来源');
  console.log('  ' + '─'.repeat(72));
  for (const p of placements) {
    const coord = `(${fmt(p.x)}, ${fmt(p.z)})`;
    const size = `${fmt(p.hx * 2)}×${fmt(p.hz * 2)}`;
    console.log(
      `  ${p.roomId.padEnd(16)}${coord.padEnd(22)}${`${p.rotationY}°`.padEnd(8)}${size.padEnd(15)}${p.origin}`,
    );
  }

  const b = layout.bounds;
  console.log(
    `\n  整体范围：X [${fmt(b.minX)}, ${fmt(b.maxX)}]  Z [${fmt(b.minZ)}, ${fmt(b.maxZ)}]  ` +
      `= ${fmt(b.maxX - b.minX)}×${fmt(b.maxZ - b.minZ)}m`,
  );

  if (options.map) console.log(renderMap(placements, layout.bounds));

  if (layout.diagnostics.length > 0) {
    console.log('\n布局诊断');
    console.log(formatDiagnostics(layout.diagnostics));
  }

  console.log(layout.ok ? '\n✓ 布局求解成功\n' : '\n✗ 布局存在冲突\n');
  return layout.ok ? ExitCode.OK : ExitCode.VALIDATION_FAILED;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * ASCII 俯视图。
 *
 * 屏幕坐标与世界坐标的映射：列 → +X（东），行 → +Z（南）。
 * 因为 north = -Z，所以**图的上方是北**，与常规地图直觉一致。
 */
function renderMap(placements: readonly RoomPlacement[], bounds: LayoutBounds): string {
  if (placements.length === 0) return '';

  const COLS = 64;
  const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-6);
  // 字符宽高比约 1:2，行数按比例减半，避免图形被纵向拉伸
  const rows = Math.max(3, Math.min(40, Math.round((COLS * spanZ) / spanX / 2)));

  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: COLS }, () => ' '),
  );

  const toCol = (x: number): number =>
    Math.min(COLS - 1, Math.max(0, Math.round(((x - bounds.minX) / spanX) * (COLS - 1))));
  const toRow = (z: number): number =>
    Math.min(rows - 1, Math.max(0, Math.round(((z - bounds.minZ) / spanZ) * (rows - 1))));

  const marks = '#*+=@%~oxAB';
  const legend: string[] = [];

  placements.forEach((p, i) => {
    const mark = marks[i % marks.length] ?? '#';
    legend.push(`${mark} ${p.roomId}`);
    const c0 = toCol(p.x - p.hx);
    const c1 = toCol(p.x + p.hx);
    const r0 = toRow(p.z - p.hz);
    const r1 = toRow(p.z + p.hz);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const row = grid[r];
        if (row === undefined) continue;
        // 边框画标记字符，内部留空 —— 重叠时边框会互相穿插，肉眼可见
        const onEdge = r === r0 || r === r1 || c === c0 || c === c1;
        if (onEdge) row[c] = mark;
        else if (row[c] === ' ') row[c] = '·';
      }
    }
  });

  const body = grid.map((row) => `  │${row.join('')}│`).join('\n');
  const bar = `  ┌${'─'.repeat(COLS)}┐`;
  const barBottom = `  └${'─'.repeat(COLS)}┘`;

  return [
    '\n  俯视图（上=北 / -Z，右=东 / +X）',
    bar,
    body,
    barBottom,
    `  ${legend.join('   ')}`,
  ].join('\n');
}
