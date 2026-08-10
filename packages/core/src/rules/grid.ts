import type { Rule } from '../diagnostics.js';
import { eachOpening, isOnGrid } from '../lookup.js';

/**
 * 网格对齐 —— 只报 warning。
 * 对齐网格能让 UE 侧 lightmap 与模块化资产复用更稳，
 * 但刻意的非对齐尺寸是合法的设计选择，所以不升级为 error。
 *
 * 不检查房间尺寸：它由 spec 派生（28.5 / 58.5 / 12 / 18 / 24 都是 0.5 的整数倍），
 * 作者无从写错。开口的 offset 仍然值得查 —— 那是手写的。
 */
export const R050_gridAlignment: Rule = {
  id: 'R050',
  title: '尺寸未对齐到网格',
  check(doc, report) {
    const grid = doc.meta.grid;

    doc.rooms.forEach((room, ri) => {
      eachOpening(room, (opening, path) => {
        if (!isOnGrid(opening.offset, grid)) {
          report({
            severity: 'warning',
            path: `rooms[${ri}].${path('offset')}`,
            message: `开口 "${opening.id}" 的 offset = ${opening.offset} 未对齐到网格 ${grid}。`,
            hint: `改成 ${(Math.round(opening.offset / grid) * grid).toFixed(2)}。`,
          });
        }
      });
    });
  },
};

export const gridRules: readonly Rule[] = [R050_gridAlignment];
