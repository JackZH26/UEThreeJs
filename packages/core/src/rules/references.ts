import { isClimbTarget } from '@tjre/schema';
import type { Rule } from '../diagnostics.js';

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

/**
 * ── 已停用：R011 / R012（连接引用完整性）────────────────────
 * v0.2 移除了文档级 `connections`。编号不复用，见 docs/CONVENTIONS.md §4.7。
 */

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

export const referenceRules: readonly Rule[] = [R010_unknownTheme, R013_climbTargetInvalid];
