import { loadDocumentFile } from '@tjre/core';
import { isDoor, parseOpeningRef } from '@tjre/schema';
import { ExitCode } from '../exit.js';

/**
 * `describe` —— 输出关卡的**压缩摘要**。
 *
 * 存在意义：大关卡的完整 YAML 可能超出 AI agent 一次能舒服处理的量。
 * 这个命令给出拓扑与规模的概览，让 agent 先建立全局认知，
 * 再决定去读哪几个房间的细节。
 */
export function runDescribe(file: string, json: boolean): ExitCode {
  const loaded = loadDocumentFile(file);
  if (!loaded.ok) {
    process.stderr.write(`✗ 无法加载 ${file}：${loaded.errors[0]?.message ?? '未知错误'}\n`);
    process.stderr.write('  先跑 `tjre validate` 看完整诊断。\n');
    return ExitCode.VALIDATION_FAILED;
  }

  const doc = loaded.doc;

  const neighbours = new Map<string, string[]>();
  const addNeighbour = (from: string, to: string): void => {
    const list = neighbours.get(from);
    if (list === undefined) neighbours.set(from, [to]);
    else list.push(to);
  };
  for (const conn of doc.connections) {
    const a = parseOpeningRef(conn.from).roomId;
    const b = parseOpeningRef(conn.to).roomId;
    addNeighbour(a, conn.oneWay ? `${b} (单向)` : b);
    if (!conn.oneWay) addNeighbour(b, a);
  }

  const rooms = doc.rooms.map((room) => ({
    id: room.id,
    name: room.name ?? null,
    size: room.size,
    theme: room.theme,
    doors: room.openings.filter((o) => isDoor(o.type)).length,
    windows: room.openings.filter((o) => !isDoor(o.type)).length,
    structures: countBy(room.structures.map((s) => s.type)),
    props: room.props.length,
    lights: room.lights.length,
    markers: countBy(room.markers.map((m) => m.kind)),
    connectsTo: neighbours.get(room.id) ?? [],
  }));

  const summary = {
    name: doc.meta.name,
    schemaVersion: doc.schemaVersion,
    entryRoom: doc.meta.entryRoom ?? null,
    grid: doc.meta.grid,
    wallThickness: doc.meta.wallThickness,
    roomCount: doc.rooms.length,
    connectionCount: doc.connections.length,
    themes: doc.themes.map((t) => t.id),
    rooms,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return ExitCode.OK;
  }

  console.log(`\n${summary.name}  (schema ${summary.schemaVersion})`);
  console.log(
    `  房间 ${summary.roomCount} · 连接 ${summary.connectionCount} · 入口 ${summary.entryRoom ?? '(未声明)'} · 网格 ${summary.grid}m · 墙厚 ${summary.wallThickness}m`,
  );
  console.log(`  主题：${summary.themes.join(', ')}\n`);

  for (const room of rooms) {
    const label = room.name === null ? room.id : `${room.id} (${room.name})`;
    console.log(`  ${label}`);
    console.log(
      `    ${room.size.w}×${room.size.d}×${room.size.h}m · 主题 ${room.theme} · 门 ${room.doors}${room.windows > 0 ? ` · 窗 ${room.windows}` : ''}`,
    );
    const structureText = Object.entries(room.structures)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    if (structureText !== '') console.log(`    结构：${structureText}`);
    const markerText = Object.entries(room.markers)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    if (markerText !== '') console.log(`    标记：${markerText}`);
    console.log(`    通向：${room.connectsTo.join(', ') || '(无)'}`);
    console.log('');
  }

  return ExitCode.OK;
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
