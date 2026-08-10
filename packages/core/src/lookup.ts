import type { Opening, Room, RoomGraphDocument, WallSide } from '@tjre/schema';
import { WALL_SPAN_AXIS } from '@tjre/schema';

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

export function findOpening(room: Room, openingId: string): Opening | undefined {
  return room.openings.find((o) => o.id === openingId);
}

/**
 * 某面墙在其延展轴上的可用长度。
 * north/south 墙沿 X 延展 → 长度 = size.w；east/west 墙沿 Z 延展 → 长度 = size.d。
 */
export function wallSpan(room: Room, wall: WallSide): number {
  return WALL_SPAN_AXIS[wall] === 'x' ? room.size.w : room.size.d;
}

/** 房间局部的水平半径范围，用于结构件越界检查 */
export function roomHalfExtents(room: Room): { hx: number; hz: number } {
  return { hx: room.size.w / 2, hz: room.size.d / 2 };
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
