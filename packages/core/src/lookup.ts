import type { Opening, Room, RoomGraphDocument, WallSide } from '@tjre/schema';
import { WALL_SPAN_AXIS, roomOpenings, roomPortals, roomSize } from '@tjre/schema';

export interface RoomEntry {
  room: Room;
  index: number;
}

/** roomId → { room, index }。index 用于生成诊断路径。 */
export function buildRoomIndex(doc: RoomGraphDocument): Map<string, RoomEntry> {
  const map = new Map<string, RoomEntry>();
  doc.rooms.forEach((room, index) => {
    if (!map.has(room.id)) map.set(room.id, { room, index });
  });
  return map;
}

/** 按 id 找开口 —— 含派生传送门，所以 `portal_north_0` 这类 id 也能查到 */
export function findOpening(room: Room, openingId: string): Opening | undefined {
  return roomOpenings(room).find((o) => o.id === openingId);
}

/**
 * 某面墙在其延展轴上的可用长度（净内空）。
 * north/south 墙沿 X 延展 → 长度 = size.w；east/west 墙沿 Z 延展 → 长度 = size.d。
 */
export function wallSpan(room: Room, wall: WallSide): number {
  const size = roomSize(room);
  return WALL_SPAN_AXIS[wall] === 'x' ? size.w : size.d;
}

/** 房间局部的水平半径范围，用于结构件越界检查 */
export function roomHalfExtents(room: Room): { hx: number; hz: number } {
  const size = roomSize(room);
  return { hx: size.w / 2, hz: size.d / 2 };
}

/**
 * 遍历房间的**全部**开口（派生传送门 + 手写开口），并给出稳定的诊断路径。
 *
 * 派生传送门不在 `room.openings` 数组里，路径必须指向 `portals[i]` 而不是
 * `openings[i]` —— 否则诊断会指着一个不存在的下标，AI 照着改会改错东西。
 */
export function eachOpening(
  room: Room,
  visit: (opening: Opening, path: (field?: string) => string) => void,
): void {
  const portalCount = roomPortals(room).length;
  roomOpenings(room).forEach((opening, i) => {
    const base = i < portalCount ? `portals[${i}]` : `openings[${i - portalCount}]`;
    visit(opening, (field) => (field === undefined ? base : `${base}.${field}`));
  });
}

/** 浮点容差比较 —— 尺寸都是米，1e-6 足够 */
export function nearlyEqual(a: number, b: number, epsilon = 1e-6): boolean {
  return Math.abs(a - b) <= epsilon;
}

/** 是否对齐到网格 */
export function isOnGrid(value: number, grid: number, epsilon = 1e-6): boolean {
  const remainder = Math.abs(value / grid) % 1;
  return remainder <= epsilon || remainder >= 1 - epsilon;
}
