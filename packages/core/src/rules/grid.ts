import type { Rule } from '../diagnostics.js';
import { isOnGrid } from '../lookup.js';

/**
 * 网格对齐 —— 只报 warning。
 * 对齐网格能让房间拼接干净、UE 侧 lightmap 与模块化资产复用更稳，
 * 但刻意的非对齐尺寸是合法的设计选择，所以不升级为 error。
 */
export const R050_gridAlignment: Rule = {
  id: 'R050',
  title: '尺寸未对齐到网格',
  check(doc, report) {
    const grid = doc.meta.grid;

    doc.rooms.forEach((room, ri) => {
      const dims = [
        { key: 'w', value: room.size.w },
        { key: 'd', value: room.size.d },
        { key: 'h', value: room.size.h },
      ] as const;
      for (const { key, value } of dims) {
        if (!isOnGrid(value, grid)) {
          report({
            severity: 'warning',
            path: `rooms[${ri}].size.${key}`,
            message: `房间 "${room.id}" 的 size.${key} = ${value} 未对齐到网格 ${grid}。`,
            hint: `改成 ${grid} 的整数倍，例如 ${(Math.round(value / grid) * grid).toFixed(2)}。`,
          });
        }
      }

      room.openings.forEach((opening, oi) => {
        if (!isOnGrid(opening.offset, grid)) {
          report({
            severity: 'warning',
            path: `rooms[${ri}].openings[${oi}].offset`,
            message: `开口 "${opening.id}" 的 offset = ${opening.offset} 未对齐到网格 ${grid}。`,
            hint: `改成 ${(Math.round(opening.offset / grid) * grid).toFixed(2)}。`,
          });
        }
      });
    });
  },
};

export const gridRules: readonly Rule[] = [R050_gridAlignment];
