import { loadDocumentFile } from '@tjre/core/node';
import {
  GRID_UNIT,
  WALL_T,
  isPortal,
  prefabDef,
  roomFootprint,
  roomOuterPlan,
  roomPortals,
  roomSize,
} from '@tjre/schema';
import { ExitCode } from '../exit.js';

/**
 * `describe` —— 输出关卡的**压缩摘要**。
 *
 * 存在意义：房间的完整 YAML 可能超出 AI agent 一次能舒服处理的量。
 * 这个命令给出规模与内容的概览，让 agent 先建立全局认知，
 * 再决定去读哪几个房间的细节。
 *
 * 尺寸与传送门是**派生量**（不在文件里），所以这里显式打出来 ——
 * agent 需要知道它在往一个多大的盒子里塞结构。
 */
export function runDescribe(file: string, json: boolean): ExitCode {
  const loaded = loadDocumentFile(file);
  if (!loaded.ok) {
    process.stderr.write(`✗ 无法加载 ${file}：${loaded.errors[0]?.message ?? '未知错误'}\n`);
    process.stderr.write('  先跑 `tjre validate` 看完整诊断。\n');
    return ExitCode.VALIDATION_FAILED;
  }

  const doc = loaded.doc;

  const rooms = doc.rooms.map((room) => {
    const size = roomSize(room);
    const fp = roomFootprint(room);
    return {
      id: room.id,
      name: room.name ?? null,
      spec: room.spec,
      footprint: `${fp.cx}×${fp.cz}`,
      outerPlan: roomOuterPlan(room),
      interior: { w: size.w, d: size.d, h: size.h },
      theme: room.theme,
      portals: roomPortals(room).length,
      windows: room.openings.filter((o) => !isPortal(o.type)).length,
      structures: countBy(room.structures.map((s) => s.type)),
      // 按 prefab 分类而不是只给条数：agent 需要知道这个房间摆了些什么。
      // 文本输出只打种类（`props` 展开会有几百字符，与"压缩摘要"的用途相悖），
      // 完整的 prefab 清单留在 --json 里。
      props: countBy(room.props.map((p) => p.prefab)),
      propKinds: countBy(room.props.map((p) => prefabDef(p.prefab).kind)),
      lights: room.lights.length,
      markers: countBy(room.markers.map((m) => m.kind)),
    };
  });

  const summary = {
    name: doc.meta.name,
    schemaVersion: doc.schemaVersion,
    gridUnit: GRID_UNIT,
    wallThickness: WALL_T,
    snapGrid: doc.meta.grid,
    roomCount: doc.rooms.length,
    themes: doc.themes.map((t) => t.id),
    rooms,
  };

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return ExitCode.OK;
  }

  console.log(`\n${summary.name}  (schema ${summary.schemaVersion})`);
  console.log(
    `  房间 ${summary.roomCount} · 格位 ${summary.gridUnit}m · 墙厚 ${summary.wallThickness}m · 吸附网格 ${summary.snapGrid}m`,
  );
  console.log(`  主题：${summary.themes.join(', ')}`);
  console.log('  每个房间是一个独立关卡；尺寸与传送门由 spec 派生，不写在文件里。\n');

  for (const room of rooms) {
    const label = room.name === null ? room.id : `${room.id} (${room.name})`;
    console.log(`  ${label}   [${room.spec}]`);
    console.log(
      `    占格 ${room.footprint} · 外廓 ${room.outerPlan.w}×${room.outerPlan.d}m · ` +
        `净内空 ${room.interior.w}×${room.interior.d}m · 层高 ${room.interior.h}m`,
    );
    console.log(
      `    主题 ${room.theme} · 传送门 ${room.portals}${room.windows > 0 ? ` · 其它开口 ${room.windows}` : ''}`,
    );
    const structureText = Object.entries(room.structures)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    if (structureText !== '') console.log(`    结构：${structureText}`);
    const propText = Object.entries(room.propKinds)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    if (propText !== '') console.log(`    道具：${propText}（prefab 明细见 --json）`);
    const markerText = Object.entries(room.markers)
      .map(([k, v]) => `${k}×${v}`)
      .join(' ');
    if (markerText !== '') console.log(`    标记：${markerText}`);
    console.log('');
  }

  return ExitCode.OK;
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
