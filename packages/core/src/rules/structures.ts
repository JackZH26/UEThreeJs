import type { PointXZ, Room, Structure } from '@tjre/schema';
import { isElevatedSurface, isPassable } from '@tjre/schema';
import type { Rule, Reporter } from '../diagnostics.js';
import { roomHalfExtents } from '../lookup.js';

/** 收集一个结构件占用的所有水平采样点，用于越界检查 */
function footprintPoints(structure: Structure): PointXZ[] {
  switch (structure.type) {
    case 'platform': {
      const { x, z, w, d } = structure.rect;
      const hw = w / 2;
      const hd = d / 2;
      return [
        { x: x - hw, z: z - hd },
        { x: x + hw, z: z - hd },
        { x: x - hw, z: z + hd },
        { x: x + hw, z: z + hd },
      ];
    }
    case 'stair':
    case 'ramp':
      return [structure.from];
    case 'ladder':
    case 'pillar':
      return [structure.at];
    case 'catwalk':
    case 'railing':
      return [...structure.path];
    case 'beam':
    case 'partition':
      return [structure.from, structure.to];
  }
}

/** 结构件的最高点（相对房间地面）。返回 undefined 表示"顶到天花板"或无法静态判定。 */
function topElevation(structure: Structure): number | undefined {
  switch (structure.type) {
    case 'platform':
      return structure.elevation;
    case 'catwalk':
      return structure.elevation;
    case 'railing':
      return structure.elevation + structure.height;
    case 'beam':
      return structure.elevation + structure.height;
    case 'partition':
      return structure.fromElevation + structure.height;
    case 'pillar':
      return structure.height === undefined
        ? undefined
        : structure.fromElevation + structure.height;
    case 'stair':
    case 'ladder':
    case 'ramp':
      return undefined; // 由 R013 通过落点平台高度间接约束
  }
}

export const R040_structureOutOfRoom: Rule = {
  id: 'R040',
  title: '结构件超出房间平面范围',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      const { hx, hz } = roomHalfExtents(room);
      room.structures.forEach((structure, si) => {
        for (const point of footprintPoints(structure)) {
          if (Math.abs(point.x) > hx + 1e-6 || Math.abs(point.z) > hz + 1e-6) {
            report({
              severity: 'error',
              path: `rooms[${ri}].structures[${si}]`,
              message: `${structure.type} "${structure.id}" 的点 (${point.x}, ${point.z}) 超出房间 "${room.id}" 的内部范围（x ±${hx}, z ±${hz}）。`,
              hint: '结构件必须完全落在房间内部尺寸之内。缩小它或加大房间 size。',
            });
            return; // 每个结构件只报一次
          }
        }
      });
    });
  },
};

export const R041_structureExceedsHeight: Rule = {
  id: 'R041',
  title: '结构件超出房间高度',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      room.structures.forEach((structure, si) => {
        const top = topElevation(structure);
        if (top === undefined) return;
        if (top > room.size.h + 1e-6) {
          report({
            severity: 'error',
            path: `rooms[${ri}].structures[${si}]`,
            message: `${structure.type} "${structure.id}" 顶部到 ${top.toFixed(2)}m，超过房间 "${room.id}" 的高度 ${room.size.h}m。`,
            hint: `降低它的 elevation / height，或把房间 size.h 提高到至少 ${top.toFixed(2)}。`,
          });
        }
      });
    });
  },
};

/** 夹层平台离天花板太近，玩家站不起来 —— 高仓库场景的常见错误 */
const MIN_HEADROOM = 1.9;

export const R042_platformHeadroom: Rule = {
  id: 'R042',
  title: '平台上方净空不足',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      room.structures.forEach((structure, si) => {
        if (structure.type !== 'platform' && structure.type !== 'catwalk') return;
        const headroom = room.size.h - structure.elevation;
        if (headroom < MIN_HEADROOM) {
          report({
            severity: 'warning',
            path: `rooms[${ri}].structures[${si}].elevation`,
            message: `${structure.type} "${structure.id}" 上方净空仅 ${headroom.toFixed(2)}m，低于可站立高度 ${MIN_HEADROOM}m。`,
            hint: `把 elevation 降到 ${(room.size.h - MIN_HEADROOM).toFixed(2)} 以下，或提高房间 size.h。`,
          });
        }
      });
    });
  },
};

/** 平台之下净空不足 —— 平台底面离地太低会形成不可用的爬行空间 */
const MIN_UNDER_CLEARANCE = 1.9;

export const R043_platformUnderClearance: Rule = {
  id: 'R043',
  title: '平台下方净空不足',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      room.structures.forEach((structure, si) => {
        if (structure.type !== 'platform') return;
        const underside = structure.elevation - structure.thickness;
        if (underside < MIN_UNDER_CLEARANCE) {
          report({
            severity: 'warning',
            path: `rooms[${ri}].structures[${si}].elevation`,
            message: `平台 "${structure.id}" 底面距地 ${underside.toFixed(2)}m，低于可通行高度 ${MIN_UNDER_CLEARANCE}m。`,
            hint: `把 elevation 提高到至少 ${(MIN_UNDER_CLEARANCE + structure.thickness).toFixed(2)}，或确认此处不需要通行。`,
          });
        }
      });
    });
  },
};

/** 夹层门校验：开在夹层高度的门，房间内需要有能到达该高度的结构 */
export const R044_elevatedDoorUnreachable: Rule = {
  id: 'R044',
  title: '夹层高度的门在房间内无法到达',
  check(doc, report) {
    doc.rooms.forEach((room, ri) => {
      const platformTops = room.structures.filter(isElevatedSurface).map((s) => s.elevation);

      room.openings.forEach((opening, oi) => {
        // 只有可通行开口才需要"站得上去"；高窗不需要平台
        if (!isPassable(opening.type)) return;
        if (opening.elevation <= 1e-6) return; // 地面门，无需结构支撑
        const supported = platformTops.some((top) => Math.abs(top - opening.elevation) <= 0.25);
        if (!supported) {
          report({
            severity: 'warning',
            path: `rooms[${ri}].openings[${oi}].elevation`,
            message: `开口 "${opening.id}" 位于 ${opening.elevation}m 高处，但房间 "${room.id}" 内没有该高度的平台或廊桥。`,
            hint: `添加一个 elevation ≈ ${opening.elevation} 的 platform / catwalk，并用 stair / ladder / ramp 连到地面。`,
          });
        }
      });
    });
  },
};

/** 房间尺寸的合理性提示 —— 针对"高仓库 / loft"这一目标形态 */
export const R045_roomProportions: Rule = {
  id: 'R045',
  title: '房间尺寸可疑',
  check(doc, report) {
    doc.rooms.forEach((room: Room, ri) => {
      if (room.size.h < 2.2) {
        report({
          severity: 'warning',
          path: `rooms[${ri}].size.h`,
          message: `房间 "${room.id}" 高度仅 ${room.size.h}m，玩家可能无法正常通行。`,
          hint: '建议 size.h ≥ 2.4。',
        });
      }
    });
  },
};

export const structureRules: readonly Rule[] = [
  R040_structureOutOfRoom,
  R041_structureExceedsHeight,
  R042_platformHeadroom,
  R043_platformUnderClearance,
  R044_elevatedDoorUnreachable,
  R045_roomProportions,
];

// 显式导出以便测试单独调用
export type { Reporter };
