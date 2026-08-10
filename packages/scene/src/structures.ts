import { BoxGeometry, CylinderGeometry } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PointXZ, Room, Structure, WallSide } from '@tjre/schema';
import { OPPOSITE_WALL, roomSize } from '@tjre/schema';
import { DIRECTION, advance, rampLength, stairMetrics } from '@tjre/core';

// 与校验器 R046 共用同一套推导，避免两边各算一遍而漂移
export { rampLength, stairMetrics } from '@tjre/core';

/**
 * ============================================================
 *  内部结构件几何
 * ============================================================
 *
 *  产出的几何体位于**房间局部坐标系**（原点 = 地面矩形中心，y 向上），
 *  与 shell.ts 一致，由 buildScene 统一套房间世界变换。
 *
 *  每个结构件的多个零件（楼梯的每级踏步、护栏的每根立柱…）会被
 *  `mergeGeometries` 合并成**一个** BufferGeometry —— 一部 20 级的楼梯
 *  是 1 个 mesh 而不是 20 个，draw call 差一个数量级。
 */

/** 护栏高度（m），扶手顶面 */
const RAILING_HEIGHT = 1.1;
/** 护栏立柱截面边长与间距 */
const POST_SIZE = 0.06;
const POST_SPACING = 1.2;
/** 扶手横杆截面 */
const RAIL_THICKNESS = 0.08;

/** 爬梯横档间距 */
const RUNG_SPACING = 0.3;

// ── 零件构造 ────────────────────────────────────────────────

function box(
  size: { w: number; h: number; d: number },
  center: { x: number; y: number; z: number },
  rotationY = 0,
): BufferGeometry {
  const geometry = new BoxGeometry(size.w, size.h, size.d);
  if (rotationY !== 0) geometry.rotateY(rotationY);
  geometry.translate(center.x, center.y, center.z);
  return geometry;
}

/** 沿两点连线放一根方棒（用于横梁、隔墙、走道段、扶手） */
function bar(
  from: PointXZ,
  to: PointXZ,
  y: number,
  width: number,
  height: number,
): BufferGeometry | null {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return null;
  // atan2(dx, dz)：让方棒的局部 +Z 指向 from→to
  const rotationY = Math.atan2(dx, dz);
  return box(
    { w: width, h: height, d: length },
    { x: (from.x + to.x) / 2, y, z: (from.z + to.z) / 2 },
    rotationY,
  );
}

/**
 * 护栏上的一个开口 —— 楼梯 / 斜坡 / 爬梯接进平台的位置必须断开，
 * 否则栏杆会横在楼梯口上，人上不去（这是真实踩到的问题）。
 */
export interface RailingGap {
  /** 开口中心（房间局部平面坐标） */
  center: PointXZ;
  /** 开口半宽 */
  halfWidth: number;
}

/** 开口两侧额外留出的余量，避免栏杆立柱正好卡在楼梯边缘 */
const GAP_MARGIN = 0.3;

/**
 * 把 [0,1] 参数区间按开口切成若干段。
 *
 * 只用于**单条直线段**：把每个开口投影到这条线段上得到要挖掉的参数窗口，
 * 再从 [0,1] 里减掉。返回的每一段都会独立生成扶手与立柱。
 */
function segmentsAfterGaps(
  a: PointXZ,
  b: PointXZ,
  gaps: readonly RailingGap[],
): [number, number][] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [];

  const holes: [number, number][] = [];
  for (const gap of gaps) {
    // 开口中心在这条线段上的投影参数
    const t = ((gap.center.x - a.x) * dx + (gap.center.z - a.z) * dz) / (length * length);
    const half = (gap.halfWidth + GAP_MARGIN) / length;
    const lo = t - half;
    const hi = t + half;
    if (hi <= 0 || lo >= 1) continue; // 开口不在这条边上
    holes.push([Math.max(0, lo), Math.min(1, hi)]);
  }
  if (holes.length === 0) return [[0, 1]];

  holes.sort((x, y) => x[0] - y[0]);
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const [lo, hi] of holes) {
    if (lo > cursor) spans.push([cursor, lo]);
    cursor = Math.max(cursor, hi);
  }
  if (cursor < 1) spans.push([cursor, 1]);
  // 太短的残段不值得生成（两根立柱贴在一起很难看）
  return spans.filter(([lo, hi]) => (hi - lo) * length > 0.4);
}

/** 沿折线生成护栏：立柱 + 顶部扶手。`gaps` 处断开。 */
function railingAlong(
  path: readonly PointXZ[],
  baseY: number,
  height: number,
  gaps: readonly RailingGap[] = [],
): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (a === undefined || b === undefined) continue;

    const lerp = (t: number): PointXZ => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

    for (const [lo, hi] of segmentsAfterGaps(a, b, gaps)) {
      const start = lerp(lo);
      const end = lerp(hi);

      const handrail = bar(
        start,
        end,
        baseY + height - RAIL_THICKNESS / 2,
        RAIL_THICKNESS,
        RAIL_THICKNESS,
      );
      if (handrail !== null) parts.push(handrail);

      const segLength = Math.hypot(end.x - start.x, end.z - start.z);
      const postCount = Math.max(2, Math.round(segLength / POST_SPACING) + 1);
      for (let p = 0; p < postCount; p++) {
        const t = p / (postCount - 1);
        parts.push(
          box(
            { w: POST_SIZE, h: height, d: POST_SIZE },
            {
              x: start.x + (end.x - start.x) * t,
              y: baseY + height / 2,
              z: start.z + (end.z - start.z) * t,
            },
          ),
        );
      }
    }
  }
  return parts;
}

/** 矩形某条边的两个端点（WallSide 表示哪条边：north = -Z 边） */
function rectEdge(
  rect: { x: number; z: number; w: number; d: number },
  side: WallSide,
): [PointXZ, PointXZ] {
  const x0 = rect.x - rect.w / 2;
  const x1 = rect.x + rect.w / 2;
  const z0 = rect.z - rect.d / 2;
  const z1 = rect.z + rect.d / 2;
  switch (side) {
    case 'north':
      return [
        { x: x0, z: z0 },
        { x: x1, z: z0 },
      ];
    case 'south':
      return [
        { x: x0, z: z1 },
        { x: x1, z: z1 },
      ];
    case 'east':
      return [
        { x: x1, z: z0 },
        { x: x1, z: z1 },
      ];
    case 'west':
      return [
        { x: x0, z: z0 },
        { x: x0, z: z1 },
      ];
  }
}

/** 线性结构（楼梯 / 走道）沿行进方向的左右侧护栏路径 */
function sideRailingPaths(
  from: PointXZ,
  to: PointXZ,
  width: number,
  side: 'none' | 'left' | 'right' | 'both',
): PointXZ[][] {
  if (side === 'none') return [];
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return [];
  // 行进方向的左法向（绕 +Y 逆时针 90°）
  const nx = -dz / length;
  const nz = dx / length;
  const half = width / 2;

  const offsetPath = (sign: number): PointXZ[] => [
    { x: from.x + nx * half * sign, z: from.z + nz * half * sign },
    { x: to.x + nx * half * sign, z: to.z + nz * half * sign },
  ];

  const paths: PointXZ[][] = [];
  if (side === 'left' || side === 'both') paths.push(offsetPath(1));
  if (side === 'right' || side === 'both') paths.push(offsetPath(-1));
  return paths;
}

// ── 各类型的构造 ────────────────────────────────────────────

type PlatformLike = Extract<Structure, { type: 'platform' }>;

function buildPlatform(
  s: PlatformLike,
  gapsByEdge: Partial<Record<WallSide, RailingGap[]>> = {},
): BufferGeometry[] {
  const parts: BufferGeometry[] = [
    box(
      { w: s.rect.w, h: s.thickness, d: s.rect.d },
      { x: s.rect.x, y: s.elevation - s.thickness / 2, z: s.rect.z },
    ),
  ];
  for (const side of s.railing) {
    parts.push(
      ...railingAlong(rectEdge(s.rect, side), s.elevation, RAILING_HEIGHT, gapsByEdge[side] ?? []),
    );
  }
  return parts;
}

/**
 * 找出所有接进这个平台的楼梯 / 斜坡 / 爬梯，算出各自该在哪条边上留多宽的开口。
 *
 * 这是**派生**的，不需要作者声明：作者已经写了 `stair.to = <平台 id>` 和 `facing`，
 * 那么"从哪条边进来"就是确定的 —— 朝北上行必然穿过平台的**南**边。
 * 让作者手写"哪条边留口"是一份必然会和 facing 漂移的冗余数据。
 *
 * 落点的算法与校验规则 R046 **完全共用**（`stairMetrics` / `rampLength` / `advance`
 * 都来自 `@tjre/core`），所以"校验说落点在平台上"与"栏杆开口开在落点处"永远一致。
 */
function railingGapsFor(room: Room, platformId: string): Partial<Record<WallSide, RailingGap[]>> {
  const gaps: Partial<Record<WallSide, RailingGap[]>> = {};

  for (const other of room.structures) {
    if (other.type !== 'stair' && other.type !== 'ramp' && other.type !== 'ladder') continue;
    if (other.to !== platformId) continue;

    // 上行方向的反向就是进入边：朝北上行 → 从南边进
    const edge = OPPOSITE_WALL[other.facing];

    let center: PointXZ;
    let halfWidth: number;
    if (other.type === 'ladder') {
      center = other.at;
      halfWidth = other.width / 2;
    } else {
      const target = room.structures.find((s) => s.id === platformId);
      const targetElevation =
        target !== undefined && 'elevation' in target ? target.elevation : other.fromElevation;
      const rise = targetElevation - other.fromElevation;
      if (rise <= 0) continue;
      const run =
        other.type === 'stair' ? stairMetrics(rise, other.stepHeight).runLength : rampLength(rise);
      center = advance(other.from, other.facing, run);
      halfWidth = other.width / 2;
    }

    (gaps[edge] ??= []).push({ center, halfWidth });
  }

  return gaps;
}

function buildStair(
  s: Extract<Structure, { type: 'stair' }>,
  targetElevation: number,
): BufferGeometry[] {
  const rise = targetElevation - s.fromElevation;
  if (rise <= 0) return [];
  const { stepCount, tread } = stairMetrics(rise, s.stepHeight);
  const dir = DIRECTION[s.facing];
  const actualStepHeight = rise / stepCount;

  const parts: BufferGeometry[] = [];
  for (let i = 0; i < stepCount; i++) {
    // 第 i 级踏步：实体从地面（或起点高度）一直堆到该级顶面，形成阶梯剖面
    const topY = s.fromElevation + actualStepHeight * (i + 1);
    const height = topY - s.fromElevation;
    const centerAlong = tread * (i + 0.5);
    parts.push(
      box(
        { w: s.width, h: height, d: tread },
        {
          x: s.from.x + dir.x * centerAlong,
          y: s.fromElevation + height / 2,
          z: s.from.z + dir.z * centerAlong,
        },
        // 踏步沿 dir 排列；当 dir 沿 X 时需把 d 轴转到 X
        dir.x !== 0 ? Math.PI / 2 : 0,
      ),
    );
  }

  const top: PointXZ = {
    x: s.from.x + dir.x * tread * stepCount,
    z: s.from.z + dir.z * tread * stepCount,
  };
  for (const path of sideRailingPaths(s.from, top, s.width, s.railing)) {
    // 护栏底部跟随坡面：简化为沿起点高度到顶端高度的直线段
    parts.push(...railingAlong(path, s.fromElevation, RAILING_HEIGHT + rise / 2));
  }
  return parts;
}

function buildRamp(
  s: Extract<Structure, { type: 'ramp' }>,
  targetElevation: number,
): BufferGeometry[] {
  const rise = targetElevation - s.fromElevation;
  if (rise <= 0) return [];
  const length = rampLength(rise);
  const dir = DIRECTION[s.facing];
  const slabThickness = 0.2;

  // 斜板：先建水平板，再绕垂直于行进方向的水平轴倾斜
  const hypotenuse = Math.hypot(length, rise);
  const geometry = new BoxGeometry(s.width, slabThickness, hypotenuse);
  const pitch = Math.atan2(rise, length);
  geometry.rotateX(-pitch);
  geometry.rotateY(Math.atan2(dir.x, dir.z));
  geometry.translate(
    s.from.x + (dir.x * length) / 2,
    s.fromElevation + rise / 2 - slabThickness / 2,
    s.from.z + (dir.z * length) / 2,
  );

  const parts: BufferGeometry[] = [geometry];
  const top: PointXZ = { x: s.from.x + dir.x * length, z: s.from.z + dir.z * length };
  for (const path of sideRailingPaths(s.from, top, s.width, s.railing)) {
    parts.push(...railingAlong(path, s.fromElevation, RAILING_HEIGHT + rise / 2));
  }
  return parts;
}

function buildLadder(
  s: Extract<Structure, { type: 'ladder' }>,
  targetElevation: number,
): BufferGeometry[] {
  const rise = targetElevation - s.fromElevation;
  if (rise <= 0) return [];
  const dir = DIRECTION[s.facing];
  // 两根竖向侧梁分布在垂直于 facing 的方向上
  const px = -dir.z;
  const pz = dir.x;
  const half = s.width / 2;
  const railSize = 0.05;

  const parts: BufferGeometry[] = [];
  for (const sign of [1, -1]) {
    parts.push(
      box(
        { w: railSize, h: rise, d: railSize },
        {
          x: s.at.x + px * half * sign,
          y: s.fromElevation + rise / 2,
          z: s.at.z + pz * half * sign,
        },
      ),
    );
  }
  const rungCount = Math.max(1, Math.floor(rise / RUNG_SPACING));
  for (let i = 1; i <= rungCount; i++) {
    const y = s.fromElevation + (rise * i) / (rungCount + 1);
    const a: PointXZ = { x: s.at.x + px * half, z: s.at.z + pz * half };
    const b: PointXZ = { x: s.at.x - px * half, z: s.at.z - pz * half };
    const rung = bar(a, b, y, 0.04, 0.04);
    if (rung !== null) parts.push(rung);
  }
  return parts;
}

function buildCatwalk(s: Extract<Structure, { type: 'catwalk' }>): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < s.path.length - 1; i++) {
    const a = s.path[i];
    const b = s.path[i + 1];
    if (a === undefined || b === undefined) continue;
    const deck = bar(a, b, s.elevation - s.thickness / 2, s.width, s.thickness);
    if (deck !== null) parts.push(deck);
    for (const path of sideRailingPaths(a, b, s.width, s.railing)) {
      parts.push(...railingAlong(path, s.elevation, RAILING_HEIGHT));
    }
  }
  return parts;
}

function buildPillar(
  s: Extract<Structure, { type: 'pillar' }>,
  roomHeight: number,
): BufferGeometry[] {
  const height = s.height ?? roomHeight - s.fromElevation;
  if (height <= 0) return [];
  const centerY = s.fromElevation + height / 2;
  if (s.profile === 'round') {
    const geometry = new CylinderGeometry(s.size / 2, s.size / 2, height, 16);
    geometry.translate(s.at.x, centerY, s.at.z);
    return [geometry];
  }
  return [box({ w: s.size, h: height, d: s.size }, { x: s.at.x, y: centerY, z: s.at.z })];
}

// ── 分派 ────────────────────────────────────────────────────

export interface StructureGeometryResult {
  structureId: string;
  type: Structure['type'];
  geometry: BufferGeometry;
  /** 是否提供可行走表面 —— 第一人称漫游的地面检测只关心这些 */
  walkable: boolean;
  partCount: number;
}

const WALKABLE: ReadonlySet<Structure['type']> = new Set(['platform', 'catwalk', 'stair', 'ramp']);

/**
 * 生成一个结构件的几何体。
 *
 * 返回 `null` 表示该结构件无有效几何（例如楼梯的落点不比起点高，
 * 这种情况已由校验规则 R013 报告为 error）。
 */
export function buildStructureGeometry(
  room: Room,
  structure: Structure,
): StructureGeometryResult | null {
  const targetElevation = (id: string): number => {
    const target = room.structures.find((s) => s.id === id);
    return target !== undefined && 'elevation' in target ? target.elevation : 0;
  };

  let parts: BufferGeometry[];
  switch (structure.type) {
    case 'platform':
      // 栏杆在楼梯 / 斜坡 / 爬梯的接入处断开，否则上不去
      parts = buildPlatform(structure, railingGapsFor(room, structure.id));
      break;
    case 'stair':
      parts = buildStair(structure, targetElevation(structure.to));
      break;
    case 'ramp':
      parts = buildRamp(structure, targetElevation(structure.to));
      break;
    case 'ladder':
      parts = buildLadder(structure, targetElevation(structure.to));
      break;
    case 'catwalk':
      parts = buildCatwalk(structure);
      break;
    case 'railing':
      parts = railingAlong(structure.path, structure.elevation, structure.height);
      break;
    case 'pillar':
      parts = buildPillar(structure, roomSize(room).h);
      break;
    case 'beam': {
      const beam = bar(
        structure.from,
        structure.to,
        structure.elevation + structure.height / 2,
        structure.width,
        structure.height,
      );
      parts = beam === null ? [] : [beam];
      break;
    }
    case 'partition': {
      const wall = bar(
        structure.from,
        structure.to,
        structure.fromElevation + structure.height / 2,
        structure.thickness,
        structure.height,
      );
      parts = wall === null ? [] : [wall];
      break;
    }
  }

  if (parts.length === 0) return null;

  // 合并成单个几何体：一部 20 级楼梯变成 1 个 mesh 而不是 20 个
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (merged === undefined || merged === null) return null;
  if (parts.length > 1) for (const part of parts) part.dispose();

  merged.name = `${room.id}_${structure.type}_${structure.id}`;
  return {
    structureId: structure.id,
    type: structure.type,
    geometry: merged,
    walkable: WALKABLE.has(structure.type),
    partCount: parts.length,
  };
}
