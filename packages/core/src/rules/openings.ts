import { isDoor, isPassable, isPortal, parseOpeningRef } from '@tjre/schema';
import type { Rule } from '../diagnostics.js';
import { wallSpan } from '../lookup.js';

/**
 * "全封闭 + 固定数量门" 这条游戏设计约束的机器可检查形式。
 * 房间显式声明 doorCount，校验器核对实际可通行开口数量。
 */
export const R020_doorCountMismatch: Rule = {
  id: 'R020',
  title: '声明的门数与实际不符',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      const actual = room.openings.filter((o) => isDoor(o.type)).length;
      if (actual !== room.doorCount) {
        report({
          severity: 'error',
          path: `rooms[${ri}].doorCount`,
          message: `房间 "${room.id}" 声明 doorCount=${room.doorCount}，但实际有 ${actual} 个可通行开口。`,
          hint:
            actual > room.doorCount
              ? `把 doorCount 改为 ${actual}，或删掉多余的可通行开口。`
              : `把 doorCount 改为 ${actual}，或补上缺少的门（type 用 door / arch / passage / hidden；window 不计入）。`,
        });
      }
    });
  },
};

export const R021_openingOutOfWall: Rule = {
  id: 'R021',
  title: '开口超出墙面范围',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      room.openings.forEach((opening, oi) => {
        const span = wallSpan(room, opening.wall);
        const half = span / 2;
        const left = opening.offset - opening.size.w / 2;
        const right = opening.offset + opening.size.w / 2;
        if (left < -half || right > half) {
          report({
            severity: 'error',
            path: `rooms[${ri}].openings[${oi}].offset`,
            message: `开口 "${opening.id}" 横向超出 ${opening.wall} 墙范围：占据 [${left.toFixed(2)}, ${right.toFixed(2)}]，墙可用范围 [${(-half).toFixed(2)}, ${half.toFixed(2)}]。`,
            hint: `把 offset 收进 ±${(half - opening.size.w / 2).toFixed(2)} 以内，或减小 size.w。`,
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
      room.openings.forEach((opening, oi) => {
        const top = opening.elevation + opening.size.h;
        if (top > room.size.h) {
          report({
            severity: 'error',
            path: `rooms[${ri}].openings[${oi}].elevation`,
            message: `开口 "${opening.id}" 顶部到 ${top.toFixed(2)}m，超过房间高度 ${room.size.h}m。`,
            hint: `降低 elevation（最大 ${(room.size.h - opening.size.h).toFixed(2)}）或减小 size.h，或增加房间 size.h。`,
          });
        }
      });
    });
  },
};

/**
 * 可通行开口未参与任何连接 —— 意味着一扇通往虚空的门。
 * 可能是有意设计（预留出口），故为 warning 而非 error。
 */
export const R023_sealedPassableOpening: Rule = {
  id: 'R023',
  title: '可通行开口未连接到任何房间',
  check(doc, report) {
    const used = new Set<string>();
    for (const conn of doc.connections) {
      used.add(conn.from);
      used.add(conn.to);
    }
    doc.rooms.forEach((room, ri) => {
      room.openings.forEach((opening, oi) => {
        if (!isPassable(opening.type)) return;
        // 传送门的另一端在**别的关卡文档**里，本文档内本就没有连接对象。
        // 对它告警是纯噪声 —— 而且它是房间之间唯一的正常连接方式。
        if (isPortal(opening.type)) return;
        const ref = `${room.id}.${opening.id}`;
        if (!used.has(ref)) {
          report({
            severity: 'warning',
            path: `rooms[${ri}].openings[${oi}]`,
            message: `可通行开口 "${ref}" 没有参与任何连接，会形成一扇通往虚空的门。`,
            hint: '添加一条 connection 把它接到别的房间；若是有意预留，可在 note 里注明。',
          });
        }
      });
    });
  },
};

/** 同一开口被多条连接使用 —— 一个洞口只能通往一处 */
export const R024_openingReusedByConnections: Rule = {
  id: 'R024',
  title: '同一开口被多条连接使用',
  check(doc, report) {
    const owner = new Map<string, string>();
    doc.connections.forEach((conn, ci) => {
      for (const side of ['from', 'to'] as const) {
        const ref = conn[side];
        const previous = owner.get(ref);
        if (previous !== undefined) {
          report({
            severity: 'error',
            path: `connections[${ci}].${side}`,
            message: `开口 "${ref}" 已被连接 "${previous}" 使用，不能再被连接 "${conn.id}" 使用。`,
            hint: '一个开口最多参与一条连接。请在对应房间新增一个开口。',
          });
        } else {
          owner.set(ref, conn.id);
        }
      }
    });
  },
};

/** 连接两端指向同一开口 */
export const R025_connectionSelfOpening: Rule = {
  id: 'R025',
  title: '连接两端是同一个开口',
  check(doc, report) {
    doc.connections.forEach((conn, ci) => {
      if (conn.from === conn.to) {
        report({
          severity: 'error',
          path: `connections[${ci}]`,
          message: `连接 "${conn.id}" 的 from 与 to 都是 "${conn.from}"。`,
          hint: '连接必须跨越两个不同的开口。',
        });
        return;
      }
      const a = parseOpeningRef(conn.from);
      const b = parseOpeningRef(conn.to);
      if (a.roomId === b.roomId) {
        report({
          severity: 'warning',
          path: `connections[${ci}]`,
          message: `连接 "${conn.id}" 的两端都在房间 "${a.roomId}" 内，形成自环。`,
          hint: '自环不会参与布局求解。若非有意设计，请把一端改到另一个房间。',
        });
      }
    });
  },
};

export const openingRules: readonly Rule[] = [
  R020_doorCountMismatch,
  R021_openingOutOfWall,
  R022_openingExceedsHeight,
  R023_sealedPassableOpening,
  R024_openingReusedByConnections,
  R025_connectionSelfOpening,
];
