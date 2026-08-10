import { isPassable, parseOpeningRef } from '@tjre/schema';
import type { Rule } from '../diagnostics.js';
import { buildRoomIndex, findOpening, nearlyEqual } from '../lookup.js';

export const R030_nonPassableInConnection: Rule = {
  id: 'R030',
  title: '连接使用了不可通行的开口',
  check(doc, report) {
    const rooms = buildRoomIndex(doc);
    doc.connections.forEach((conn, ci) => {
      for (const side of ['from', 'to'] as const) {
        const { roomId, openingId } = parseOpeningRef(conn[side]);
        const room = rooms.get(roomId)?.room;
        if (room === undefined) continue; // 由 R011 负责报告
        const opening = findOpening(room, openingId);
        if (opening === undefined) continue; // 由 R012 负责报告
        if (!isPassable(opening.type)) {
          report({
            severity: 'error',
            path: `connections[${ci}].${side}`,
            message: `开口 "${conn[side]}" 的类型是 "${opening.type}"，不可通行，不能用于连接。`,
            hint: '把开口 type 改为 door / arch / passage / hidden，或改用另一个可通行开口。',
          });
        }
      }
    });
  },
};

/**
 * 夹层高度的门必须两端等高，否则门洞对不上。
 * 这是"房间可以很高、门可以开在夹层"引入的新约束。
 */
export const R031_connectionElevationMismatch: Rule = {
  id: 'R031',
  title: '连接两端开口高度不一致',
  check(doc, report) {
    const rooms = buildRoomIndex(doc);
    doc.connections.forEach((conn, ci) => {
      const a = parseOpeningRef(conn.from);
      const b = parseOpeningRef(conn.to);
      const roomA = rooms.get(a.roomId)?.room;
      const roomB = rooms.get(b.roomId)?.room;
      if (roomA === undefined || roomB === undefined) return;
      const openingA = findOpening(roomA, a.openingId);
      const openingB = findOpening(roomB, b.openingId);
      if (openingA === undefined || openingB === undefined) return;

      if (!nearlyEqual(openingA.elevation, openingB.elevation)) {
        report({
          severity: 'error',
          path: `connections[${ci}]`,
          message: `连接 "${conn.id}" 两端开口高度不一致：${conn.from} 在 ${openingA.elevation}m，${conn.to} 在 ${openingB.elevation}m。`,
          hint: `把两个开口的 elevation 改成同一个值（例如都设为 ${openingA.elevation}）。如果需要跨高度连通，请在房间内用 stair / ladder / ramp 解决。`,
        });
      }
    });
  },
};

export const R032_connectionSizeMismatch: Rule = {
  id: 'R032',
  title: '连接两端开口尺寸不一致',
  check(doc, report) {
    const rooms = buildRoomIndex(doc);
    doc.connections.forEach((conn, ci) => {
      const a = parseOpeningRef(conn.from);
      const b = parseOpeningRef(conn.to);
      const roomA = rooms.get(a.roomId)?.room;
      const roomB = rooms.get(b.roomId)?.room;
      if (roomA === undefined || roomB === undefined) return;
      const openingA = findOpening(roomA, a.openingId);
      const openingB = findOpening(roomB, b.openingId);
      if (openingA === undefined || openingB === undefined) return;

      if (
        !nearlyEqual(openingA.size.w, openingB.size.w) ||
        !nearlyEqual(openingA.size.h, openingB.size.h)
      ) {
        report({
          severity: 'warning',
          path: `connections[${ci}]`,
          message: `连接 "${conn.id}" 两端洞口尺寸不同：${openingA.size.w}×${openingA.size.h} vs ${openingB.size.w}×${openingB.size.h}。`,
          hint: '尺寸不同会在门框处出现台阶。建议统一，或确认这是刻意的造型。',
        });
      }
    });
  },
};

/**
 * 可达性 —— 对"多房间串联"的游戏来说，孤岛房间是硬伤。
 * 单向连接只能从 from 走到 to。
 */
export const R033_unreachableRoom: Rule = {
  id: 'R033',
  title: '存在从入口无法到达的房间',
  check(doc, report) {
    if (doc.rooms.length === 0) return;

    const rooms = buildRoomIndex(doc);
    const declaredEntry = doc.meta.entryRoom;
    const firstRoom = doc.rooms[0];
    if (firstRoom === undefined) return;

    let entryId: string;
    if (declaredEntry !== undefined && rooms.has(declaredEntry)) {
      entryId = declaredEntry;
    } else {
      entryId = firstRoom.id;
      if (declaredEntry === undefined) {
        report({
          severity: 'warning',
          path: 'meta.entryRoom',
          message: `未声明 meta.entryRoom，可达性检查退化为从第一个房间 "${entryId}" 出发。`,
          hint: '显式设置 meta.entryRoom 为玩家进入关卡的房间 id。',
        });
      } else {
        report({
          severity: 'error',
          path: 'meta.entryRoom',
          message: `meta.entryRoom = "${declaredEntry}" 不是一个已定义的房间。`,
          hint: `可用房间：${[...rooms.keys()].join(', ')}。`,
        });
      }
    }

    // 构建有向邻接表（双向连接展开为两条边）
    const adjacency = new Map<string, string[]>();
    const addEdge = (from: string, to: string): void => {
      const list = adjacency.get(from);
      if (list === undefined) adjacency.set(from, [to]);
      else list.push(to);
    };
    for (const conn of doc.connections) {
      const a = parseOpeningRef(conn.from).roomId;
      const b = parseOpeningRef(conn.to).roomId;
      if (!rooms.has(a) || !rooms.has(b)) continue;
      addEdge(a, b);
      if (!conn.oneWay) addEdge(b, a);
    }

    const reached = new Set<string>([entryId]);
    const queue = [entryId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of adjacency.get(current) ?? []) {
        if (!reached.has(next)) {
          reached.add(next);
          queue.push(next);
        }
      }
    }

    doc.rooms.forEach((room, ri) => {
      if (!reached.has(room.id)) {
        report({
          severity: 'error',
          path: `rooms[${ri}]`,
          message: `房间 "${room.id}" 无法从入口 "${entryId}" 到达。`,
          hint: '添加一条 connection 把它接入主流程；注意单向连接（oneWay）不提供反向通路。',
        });
      }
    });
  },
};

export const connectionRules: readonly Rule[] = [
  R030_nonPassableInConnection,
  R031_connectionElevationMismatch,
  R032_connectionSizeMismatch,
  R033_unreachableRoom,
];
