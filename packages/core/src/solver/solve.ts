import type { Room, RoomGraphDocument } from '@tjre/schema';
import { parseOpeningRef } from '@tjre/schema';
import type { Diagnostic } from '../diagnostics.js';
import { buildRoomIndex, findOpening } from '../lookup.js';
import type { Rotation } from './rotation.js';
import {
  OPPOSITE,
  isRotation,
  openingLocalPosition,
  rotateXZ,
  rotationForFacing,
  worldFacing,
  worldHalfExtents,
  worldNormal,
} from './rotation.js';

/**
 * ============================================================
 *  布局求解器 —— P2「图驱动布局」的核心
 * ============================================================
 *
 *  输入：连接图（拓扑）        输出：每个房间的世界坐标 + 旋转
 *
 *  作者/AI **从不书写房间世界坐标**。位置由「哪个门接哪个门」推导出来。
 *  这是让 LLM 能可靠编辑关卡的关键：它擅长拓扑关系，不擅长坐标算术。
 *
 *  核心几何：设房间 A 的开口在世界位置 Pa、朝外法向 Na，
 *  则连接的另一端 B 的同一开口必须落在 Pa + Na · wallThickness
 *  （`size` 是内部净尺寸，相邻房间共享一道厚度为 t 的墙），
 *  且 B 的该面墙必须朝向 -Na。由此唯一确定 B 的旋转与中心坐标。
 *
 *  诊断编号段 R07x —— 由求解器产生，不在 ALL_RULES 注册表里
 *  （见 docs/CONVENTIONS.md §4.6）。
 */

export interface RoomPlacement {
  roomId: string;
  /** 世界坐标：房间地面矩形的中心 */
  x: number;
  y: number;
  z: number;
  rotationY: Rotation;
  /** 旋转后的世界水平半尺寸，供重叠检测与场景构建使用 */
  hx: number;
  hz: number;
  /** 该房间的定位来源，便于排查 */
  origin: 'pin' | 'anchor' | 'derived';
}

export interface LayoutBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface LayoutResult {
  ok: boolean;
  placements: Map<string, RoomPlacement>;
  diagnostics: Diagnostic[];
  bounds: LayoutBounds;
}

/** 浮点容差。尺寸单位是米，1e-6 远小于任何有意义的建筑尺度。 */
const EPS = 1e-6;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

/** 把 -0 归一成 0，避免序列化/快照出现 "-0" */
function norm(value: number): number {
  return value === 0 ? 0 : value;
}

interface Edge {
  connectionId: string;
  fromRoom: string;
  fromOpening: string;
  toRoom: string;
  toOpening: string;
}

/**
 * 构建**无向**邻接表。
 *
 * 注意与 R033 可达性检查的区别：`oneWay` 只影响玩家能否通行，
 * 不影响两个房间在物理上是否相邻。因此布局求解必须忽略 oneWay，
 * 否则单向门后面的房间会被判定为无法定位。
 */
function buildAdjacency(doc: RoomGraphDocument): Map<string, Edge[]> {
  const adjacency = new Map<string, Edge[]>();
  const push = (roomId: string, edge: Edge): void => {
    const list = adjacency.get(roomId);
    if (list === undefined) adjacency.set(roomId, [edge]);
    else list.push(edge);
  };

  for (const conn of doc.connections) {
    const a = parseOpeningRef(conn.from);
    const b = parseOpeningRef(conn.to);
    if (a.roomId === b.roomId) continue; // 自环不参与布局（R025 已告警）

    push(a.roomId, {
      connectionId: conn.id,
      fromRoom: a.roomId,
      fromOpening: a.openingId,
      toRoom: b.roomId,
      toOpening: b.openingId,
    });
    push(b.roomId, {
      connectionId: conn.id,
      fromRoom: b.roomId,
      fromOpening: b.openingId,
      toRoom: a.roomId,
      toOpening: a.openingId,
    });
  }
  return adjacency;
}

/** 开口中心的世界坐标 */
function openingWorldPosition(
  room: Room,
  wall: Parameters<typeof worldFacing>[0],
  offset: number,
  placement: RoomPlacement,
): { x: number; z: number } {
  const local = openingLocalPosition(wall, offset, room.size);
  const rotated = rotateXZ(local, placement.rotationY);
  return { x: placement.x + rotated.x, z: placement.z + rotated.z };
}

/**
 * 从连接图求解所有房间的世界坐标。
 *
 * 前置条件：文档已通过 schema 解析与 `validateDocument` 的引用完整性检查
 * （R011 / R012）。求解器假定连接引用的房间与开口都存在。
 */
export function solveLayout(doc: RoomGraphDocument): LayoutResult {
  const diagnostics: Diagnostic[] = [];
  const placements = new Map<string, RoomPlacement>();
  const rooms = buildRoomIndex(doc);
  const adjacency = buildAdjacency(doc);
  const defaultThickness = doc.meta.wallThickness;

  const report = (d: Diagnostic): void => {
    diagnostics.push(d);
  };

  // ── 1. 确定锚点 ─────────────────────────────────────────
  const anchors: string[] = [];

  for (const [roomId, { room, index }] of rooms) {
    if (room.pin === undefined) continue;
    if (!isRotation(room.pin.rotationY)) {
      report({
        rule: 'R073',
        severity: 'error',
        path: `rooms[${index}].pin.rotationY`,
        message: `房间 "${roomId}" 的 pin.rotationY = ${room.pin.rotationY} 不是 90° 的整数倍。`,
        hint: 'v0.1 只支持 0 / 90 / 180 / 270。',
      });
      continue;
    }
    const extents = worldHalfExtents(room.size, room.pin.rotationY);
    placements.set(roomId, {
      roomId,
      x: room.pin.x,
      y: room.pin.y,
      z: room.pin.z,
      rotationY: room.pin.rotationY,
      hx: extents.hx,
      hz: extents.hz,
      origin: 'pin',
    });
    anchors.push(roomId);
  }

  // 没有任何 pin 时，用 entryRoom（或第一个房间）作为原点锚
  if (anchors.length === 0) {
    const entry = doc.meta.entryRoom;
    const fallback = doc.rooms[0];
    const anchorId = entry !== undefined && rooms.has(entry) ? entry : fallback?.id;
    if (anchorId === undefined) {
      return {
        ok: true,
        placements,
        diagnostics,
        bounds: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      };
    }
    const room = rooms.get(anchorId)?.room;
    if (room !== undefined) {
      const extents = worldHalfExtents(room.size, 0);
      placements.set(anchorId, {
        roomId: anchorId,
        x: 0,
        y: 0,
        z: 0,
        rotationY: 0,
        hx: extents.hx,
        hz: extents.hz,
        origin: 'anchor',
      });
      anchors.push(anchorId);
    }
  }

  // ── 2. BFS 沿连接传播 ───────────────────────────────────
  // 队列按 id 排序处理，保证同一文档每次求解结果逐字节一致
  const queue = [...anchors].sort();
  const visited = new Set(queue);

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (currentId === undefined) break;
    const current = placements.get(currentId);
    const currentRoom = rooms.get(currentId)?.room;
    if (current === undefined || currentRoom === undefined) continue;

    const edges = [...(adjacency.get(currentId) ?? [])].sort((a, b) =>
      a.connectionId < b.connectionId ? -1 : a.connectionId > b.connectionId ? 1 : 0,
    );

    for (const edge of edges) {
      const fromOpening = findOpening(currentRoom, edge.fromOpening);
      const neighbourEntry = rooms.get(edge.toRoom);
      if (fromOpening === undefined || neighbourEntry === undefined) continue;
      const neighbourRoom = neighbourEntry.room;
      const toOpening = findOpening(neighbourRoom, edge.toOpening);
      if (toOpening === undefined) continue;

      // A 侧开口的世界位置与朝外法向
      const pa = openingWorldPosition(currentRoom, fromOpening.wall, fromOpening.offset, current);
      const na = worldNormal(fromOpening.wall, current.rotationY);
      const facingA = worldFacing(fromOpening.wall, current.rotationY);

      // B 的该面墙必须朝向 A 的反向
      const rotationB = rotationForFacing(toOpening.wall, OPPOSITE[facingA]);

      // 相邻房间共享一道墙：从 A 的内壁面沿法向推进一个墙厚，落到 B 的内壁面
      const thickness =
        currentRoom.wallThickness ?? neighbourRoom.wallThickness ?? defaultThickness;
      const pb = { x: pa.x + na.x * thickness, z: pa.z + na.z * thickness };

      // 由开口世界位置反推 B 的中心：center = P - R(θ)·localOffset
      const localB = openingLocalPosition(toOpening.wall, toOpening.offset, neighbourRoom.size);
      const rotatedB = rotateXZ(localB, rotationB);
      const extentsB = worldHalfExtents(neighbourRoom.size, rotationB);

      const candidate: RoomPlacement = {
        roomId: edge.toRoom,
        x: norm(pb.x - rotatedB.x),
        y: current.y,
        z: norm(pb.z - rotatedB.z),
        rotationY: rotationB,
        hx: extentsB.hx,
        hz: extentsB.hz,
        origin: 'derived',
      };

      const existing = placements.get(edge.toRoom);
      if (existing === undefined) {
        placements.set(edge.toRoom, candidate);
        visited.add(edge.toRoom);
        queue.push(edge.toRoom);
        continue;
      }

      // 已被定位过 —— 校验一致性。环路里的矛盾就在这里暴露。
      const consistent =
        near(existing.x, candidate.x) &&
        near(existing.z, candidate.z) &&
        existing.rotationY === candidate.rotationY;

      if (!consistent) {
        const detail =
          existing.rotationY !== candidate.rotationY
            ? `旋转 ${existing.rotationY}° vs ${candidate.rotationY}°`
            : `坐标 (${existing.x.toFixed(3)}, ${existing.z.toFixed(3)}) vs (${candidate.x.toFixed(3)}, ${candidate.z.toFixed(3)})`;
        report({
          rule: 'R071',
          severity: 'error',
          path: `connections[${doc.connections.findIndex((c) => c.id === edge.connectionId)}]`,
          message: `连接 "${edge.connectionId}" 推导出的房间 "${edge.toRoom}" 位置与已有结果冲突：${detail}。`,
          hint:
            existing.origin === 'pin'
              ? `房间 "${edge.toRoom}" 被 pin 固定，但连接要求它在别处。移除 pin，或调整开口 offset / 房间尺寸让两者吻合。`
              : '连接图里存在闭环，且环上的尺寸与门位对不上。调整环上某个房间的尺寸或开口 offset，或用 pin 显式固定其中一个房间。',
        });
      }
    }
  }

  // ── 3. 未被定位的房间 ───────────────────────────────────
  doc.rooms.forEach((room, index) => {
    if (!placements.has(room.id)) {
      report({
        rule: 'R072',
        severity: 'error',
        path: `rooms[${index}]`,
        message: `房间 "${room.id}" 无法定位：它没有任何连接，也没有 pin。`,
        hint: '给它加一条 connection 接入关卡，或用 pin 显式指定世界坐标。',
      });
    }
  });

  // ── 4. 重叠检测 ─────────────────────────────────────────
  detectOverlaps(doc, placements, report);

  const bounds = computeBounds(placements);
  const ok = diagnostics.every((d) => d.severity !== 'error');

  diagnostics.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  return { ok, placements, diagnostics, bounds };
}

/**
 * 房间外壳的 AABB 重叠检测。
 *
 * 用内部尺寸做 AABB：相邻房间的内壁面之间隔着一道墙，所以正常拼接
 * **不会**重叠，边界刚好相切也不算重叠（需真正相交才报）。
 */
function detectOverlaps(
  doc: RoomGraphDocument,
  placements: Map<string, RoomPlacement>,
  report: (d: Diagnostic) => void,
): void {
  const list = [...placements.values()].sort((a, b) => (a.roomId < b.roomId ? -1 : 1));

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a === undefined || b === undefined) continue;

      const overlapX = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx);
      const overlapZ = Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz);

      if (overlapX > EPS && overlapZ > EPS) {
        const index = doc.rooms.findIndex((r) => r.id === b.roomId);
        report({
          rule: 'R070',
          severity: 'error',
          path: `rooms[${index}]`,
          message: `房间 "${a.roomId}" 与 "${b.roomId}" 在世界空间重叠（X 方向 ${overlapX.toFixed(2)}m，Z 方向 ${overlapZ.toFixed(2)}m）。`,
          hint: '房间位置由连接图推导。调整连接拓扑、房间尺寸或开口 offset 让它们错开。',
        });
      }
    }
  }
}

function computeBounds(placements: Map<string, RoomPlacement>): LayoutBounds {
  if (placements.size === 0) return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of placements.values()) {
    minX = Math.min(minX, p.x - p.hx);
    maxX = Math.max(maxX, p.x + p.hx);
    minZ = Math.min(minZ, p.z - p.hz);
    maxZ = Math.max(maxZ, p.z + p.hz);
  }
  return { minX, maxX, minZ, maxZ };
}
