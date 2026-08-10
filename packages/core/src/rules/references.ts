import { isClimbTarget, parseOpeningRef } from '@tjre/schema';
import type { Rule } from '../diagnostics.js';
import { buildRoomIndex, findOpening } from '../lookup.js';

export const R010_unknownTheme: Rule = {
  id: 'R010',
  title: '房间引用了不存在的主题',
  check(doc, report) {
    const themeIds = new Set(doc.themes.map((t) => t.id));
    doc.rooms.forEach((room, ri) => {
      if (!themeIds.has(room.theme)) {
        report({
          severity: 'error',
          path: `rooms[${ri}].theme`,
          message: `房间 "${room.id}" 引用了不存在的主题 "${room.theme}"。`,
          hint: `可用主题：${[...themeIds].join(', ') || '（themes 为空）'}。`,
        });
      }
    });
  },
};

export const R011_connectionUnknownRoom: Rule = {
  id: 'R011',
  title: '连接引用了不存在的房间',
  check(doc, report) {
    const rooms = buildRoomIndex(doc);
    doc.connections.forEach((conn, ci) => {
      for (const side of ['from', 'to'] as const) {
        const { roomId } = parseOpeningRef(conn[side]);
        if (!rooms.has(roomId)) {
          report({
            severity: 'error',
            path: `connections[${ci}].${side}`,
            message: `连接 "${conn.id}" 的 ${side} 引用了不存在的房间 "${roomId}"。`,
            hint: `已定义的房间：${[...rooms.keys()].join(', ') || '（rooms 为空）'}。`,
          });
        }
      }
    });
  },
};

export const R012_connectionUnknownOpening: Rule = {
  id: 'R012',
  title: '连接引用了不存在的开口',
  check(doc, report) {
    const rooms = buildRoomIndex(doc);
    doc.connections.forEach((conn, ci) => {
      for (const side of ['from', 'to'] as const) {
        const { roomId, openingId } = parseOpeningRef(conn[side]);
        const entry = rooms.get(roomId);
        if (entry === undefined) continue; // 由 R011 负责报告
        if (findOpening(entry.room, openingId) === undefined) {
          const available = entry.room.openings.map((o) => o.id);
          report({
            severity: 'error',
            path: `connections[${ci}].${side}`,
            message: `房间 "${roomId}" 中不存在开口 "${openingId}"。`,
            hint: `该房间现有开口：${available.join(', ') || '（无）'}。请先在房间的 openings 中添加。`,
          });
        }
      }
    });
  },
};

export const R013_climbTargetInvalid: Rule = {
  id: 'R013',
  title: '楼梯 / 爬梯 / 斜坡的落点无效',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      const byId = new Map(room.structures.map((s) => [s.id, s]));
      room.structures.forEach((structure, si) => {
        if (
          structure.type !== 'stair' &&
          structure.type !== 'ladder' &&
          structure.type !== 'ramp'
        ) {
          return;
        }
        const target = byId.get(structure.to);
        const path = `rooms[${ri}].structures[${si}].to`;
        if (target === undefined) {
          report({
            severity: 'error',
            path,
            message: `${structure.type} "${structure.id}" 的落点 "${structure.to}" 在房间 "${room.id}" 中不存在。`,
            hint: '落点必须是同一房间内某个 platform 结构件的 id。',
          });
          return;
        }
        if (!isClimbTarget(target)) {
          report({
            severity: 'error',
            path,
            message: `${structure.type} "${structure.id}" 的落点 "${structure.to}" 类型是 "${target.type}"，不可作为落点。`,
            hint: 'v0.1 只允许落在 type=platform 的结构件上。',
          });
          return;
        }
        if (target.elevation <= structure.fromElevation) {
          report({
            severity: 'error',
            path,
            message: `${structure.type} "${structure.id}" 的落点高度 ${target.elevation}m 不高于起点高度 ${structure.fromElevation}m。`,
            hint: '落点平台的 elevation 必须大于该结构件的 fromElevation。',
          });
        }
      });
    });
  },
};

export const referenceRules: readonly Rule[] = [
  R010_unknownTheme,
  R011_connectionUnknownRoom,
  R012_connectionUnknownOpening,
  R013_climbTargetInvalid,
];
