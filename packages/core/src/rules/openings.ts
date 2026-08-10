import { isPassable, isPortal, roomPortals, roomSize } from '@tjre/schema';
import type { Rule } from '../diagnostics.js';
import { eachOpening, wallSpan } from '../lookup.js';

/**
 * ============================================================
 *  开口类规则
 * ============================================================
 *
 *  传送门是**派生**的（见 schema/spec.ts）：数量、位置、尺寸全部由 `spec`
 *  唯一决定，作者写不了也就错不了。所以这里**没有**"门数不符"、
 *  "传送门没对齐"这类规则 —— 那些错误在结构上已经不可能发生。
 *
 *  R021 / R022 仍然把派生传送门一起检查：它们此时不是在校验作者的输入，
 *  而是在给 `spec` 表本身兜底（例如哪天把 S 的层高改到 3m，
 *  3.2m 高的门就会顶穿天花，这条规则会当场抓住）。
 */

/**
 * 手写 `type: portal` 的开口 —— 直接拒绝。
 *
 * 传送门必须跨占格边界对齐，否则拼装后门对上实墙、关卡不连通。
 * 唯一可靠的做法是由 `spec` 派生，所以手写就是错。
 */
export const R020_handWrittenPortal: Rule = {
  id: 'R020',
  title: '手写了传送门',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      room.openings.forEach((opening, oi) => {
        if (!isPortal(opening.type)) return;
        report({
          severity: 'error',
          path: `rooms[${ri}].openings[${oi}].type`,
          message: `房间 "${room.id}" 手写了传送门 "${opening.id}"。传送门由 spec 派生，不能手写。`,
          hint:
            `把这个开口从 openings 里删掉。房间 "${room.id}"（spec=${room.spec}）` +
            `已自动拥有 ${roomPortals(room).length} 个传送门：` +
            `${roomPortals(room)
              .map(
                (p) =>
                  `${p.id}@${p.wall}${p.offset === 0 ? '' : p.offset > 0 ? `+${p.offset}` : p.offset}`,
              )
              .join(', ')}。`,
        });
      });
    });
  },
};

export const R021_openingOutOfWall: Rule = {
  id: 'R021',
  title: '开口超出墙面范围',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      eachOpening(room, (opening, path) => {
        const span = wallSpan(room, opening.wall);
        const half = span / 2;
        const left = opening.offset - opening.size.w / 2;
        const right = opening.offset + opening.size.w / 2;
        if (left < -half || right > half) {
          report({
            severity: 'error',
            path: `rooms[${ri}].${path('offset')}`,
            message: `开口 "${opening.id}" 横向超出 ${opening.wall} 墙范围：占据 [${left.toFixed(2)}, ${right.toFixed(2)}]，墙可用范围 [${(-half).toFixed(2)}, ${half.toFixed(2)}]。`,
            hint: isPortal(opening.type)
              ? '这是派生传送门，说明 spec 表本身有问题（格边偏移与墙跨度不匹配），请检查 schema/spec.ts。'
              : `把 offset 收进 ±${(half - opening.size.w / 2).toFixed(2)} 以内，或减小 size.w。`,
          });
        }
      });
    });
  },
};

export const R022_openingExceedsHeight: Rule = {
  id: 'R022',
  title: '开口超出房间高度',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      const height = roomSize(room).h;
      eachOpening(room, (opening, path) => {
        const top = opening.elevation + opening.size.h;
        if (top > height) {
          report({
            severity: 'error',
            path: `rooms[${ri}].${path('elevation')}`,
            message: `开口 "${opening.id}" 顶部到 ${top.toFixed(2)}m，超过房间高度 ${height}m。`,
            hint: isPortal(opening.type)
              ? `这是派生传送门（恒 3.0×3.2m），说明 spec=${room.spec} 的层高 ${height}m 装不下门，请检查 schema/spec.ts。`
              : `降低 elevation（最大 ${(height - opening.size.h).toFixed(2)}）或减小 size.h。`,
          });
        }
      });
    });
  },
};

/**
 * 手写的可通行开口 —— 会形成一扇通往虚空的门。
 *
 * 房间是全封闭的独立关卡，外壳之外没有任何空间。传送门是**唯一**合法的出口，
 * 而它是派生的；作者手写的 door / arch / passage / hidden 一定通向虚空。
 *
 * 定为 warning 而非 error：造型上的假门 / 封堵的门洞是合法的美术选择。
 */
export const R023_openingToVoid: Rule = {
  id: 'R023',
  title: '手写的可通行开口通往房间外的虚空',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      room.openings.forEach((opening, oi) => {
        if (isPortal(opening.type)) return; // R020 负责
        if (!isPassable(opening.type)) return; // 窗不通行，开在外壳上没问题
        report({
          severity: 'warning',
          path: `rooms[${ri}].openings[${oi}].type`,
          message: `开口 "${opening.id}" 类型 "${opening.type}" 可通行，但它开在外壳上 —— 房间之外没有空间，玩家会走进虚空。`,
          hint: '房间之间的连接只能靠派生传送门。若这只是造型（假门 / 封堵洞口），把 type 改成 window，或在 note 里注明。',
        });
      });
    });
  },
};

export const openingRules: readonly Rule[] = [
  R020_handWrittenPortal,
  R021_openingOutOfWall,
  R022_openingExceedsHeight,
  R023_openingToVoid,
];
