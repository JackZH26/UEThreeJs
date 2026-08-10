import { z } from 'zod';
import type { Opening } from './opening.js';
import type { Size2, Size3, WallSide } from './primitives.js';
import { WALL_SIDES, WALL_SPAN_AXIS } from './primitives.js';

/**
 * ============================================================
 *  房间规格 —— 全库共用的派生表（改动此处等于破坏性变更）
 * ============================================================
 *
 *  ENTER THE CUBE 的 36 个房间是**可互换单元**：每局按 seed 随机拼装到一个
 *  格位网格里。可互换的前提是外形与接口完全一致 —— 所以尺寸和传送门
 *  **不是每间房单独定的**，而是由「网格单位 × 占格数」派生，全库共用。
 *
 *  ┌─────┬──────────┬───────────┬─────────────────┬────────┬──────┐
 *  │规格 │ 占格      │ 外廓平面   │ 净内空（可走）    │ 层高    │传送门│
 *  ├─────┼──────────┼───────────┼─────────────────┼────────┼──────┤
 *  │ S   │ 1 × 1    │ 30 × 30   │ 28.5 × 28.5     │ 12     │  4   │
 *  │ M   │ 2 × 1    │ 60 × 30   │ 58.5 × 28.5     │ 18     │  6   │
 *  │ L   │ 2 × 2    │ 60 × 60   │ 58.5 × 58.5     │ 24     │  8   │
 *  └─────┴──────────┴───────────┴─────────────────┴────────┴──────┘
 *
 *  ── 墙厚与净内空的关系 ────────────────────────────────────
 *  墙体建在**占格内侧**（墙心距占格边界 t/2，即墙占据 [0, t] 向内），
 *  所以净内空 = 占格边长 − 2t，每边各减 0.75。
 *  推论：房间外廓 AABB **恒等于**占格尺寸，任何两个房间都能无缝对接。
 *  （有测试断言这一点，见 packages/scene/test/shell.test.ts）
 *
 *  ── 传送门为什么是派生的而不是手写的 ──────────────────────
 *  传送门必须**跨占格边界对齐**：否则 A 房间的门对上 B 房间的实墙，
 *  拼装出来直接不连通。对齐的唯一可靠办法是把门锚定到格位本身 ——
 *  **每条占格边一个门，居中于该格边**。
 *
 *  这条规则自动产出用户给定的门数：
 *    S(1×1)：四面各 1 条格边 → 4 门
 *    M(2×1)：宽墙 2 条 + 窄墙 1 条 → 2+2+1+1 = 6 门
 *    L(2×2)：每面 2 条格边     → 8 门
 *
 *  于是传送门**完全由 spec 决定，零手写**：不需要作者写、不需要校验器核对，
 *  也就不存在写错的可能。房间朝向与出口编号由游戏侧处理（房间可旋转），
 *  编辑器只关心布局与结构，因此这里不存任何朝向 / 编号元数据。
 */

/** 格位边长（m）。占格数 × 此值 = 房间外廓平面尺寸。 */
export const GRID_UNIT = 30;

/**
 * 外壳墙厚（m）。
 *
 * 刻意是**常量而非可配置项**：净内空由它派生（`GRID_UNIT − 2 × WALL_T`），
 * 一旦允许按房间/按文档覆盖，同一规格的房间就会出现不同的内部尺寸，
 * 可互换性立刻失效。要改只能改这里，并且是破坏性变更。
 */
export const WALL_T = 0.75;

/** 传送门洞口尺寸（m）—— 恒定，不随房间尺寸变化 */
export const PORTAL_SIZE: Readonly<Size2> = Object.freeze({ w: 3, h: 3.2 });

/** 传送门下沿离地高度。恒为 0：任何出口都必须从地面直接走到。 */
export const PORTAL_ELEVATION = 0;

export const RoomSpec = z
  .enum(['S', 'M', 'L'])
  .describe('房间规格：S=1×1格(30×30, h12) / M=2×1格(60×30, h18) / L=2×2格(60×60, h24)');
export type RoomSpec = z.infer<typeof RoomSpec>;

export const ROOM_SPECS: readonly RoomSpec[] = ['S', 'M', 'L'] as const;

/** 占格数：cx 沿 X，cz 沿 Z */
export interface Footprint {
  cx: number;
  cz: number;
}

export const SPEC_FOOTPRINT: Readonly<Record<RoomSpec, Readonly<Footprint>>> = Object.freeze({
  S: Object.freeze({ cx: 1, cz: 1 }),
  M: Object.freeze({ cx: 2, cz: 1 }),
  L: Object.freeze({ cx: 2, cz: 2 }),
});

/** 层高（净内空高度：地板顶面 → 天花底面） */
export const SPEC_HEIGHT: Readonly<Record<RoomSpec, number>> = Object.freeze({
  S: 12,
  M: 18,
  L: 24,
});

function deriveSize(spec: RoomSpec): Readonly<Size3> {
  const fp = SPEC_FOOTPRINT[spec];
  return Object.freeze({
    w: fp.cx * GRID_UNIT - 2 * WALL_T,
    d: fp.cz * GRID_UNIT - 2 * WALL_T,
    h: SPEC_HEIGHT[spec],
  });
}

/**
 * 净内空尺寸表。
 *
 * 预先算好并冻结：这些对象会被几何生成的热路径反复读取，
 * 每次调用都新建对象是没必要的分配。
 */
export const SPEC_SIZE: Readonly<Record<RoomSpec, Readonly<Size3>>> = Object.freeze({
  S: deriveSize('S'),
  M: deriveSize('M'),
  L: deriveSize('L'),
});

/** 净内空尺寸（w 沿 X，d 沿 Z，h 沿 Y） */
export function specSize(spec: RoomSpec): Readonly<Size3> {
  return SPEC_SIZE[spec];
}

/** 占格数 */
export function specFootprint(spec: RoomSpec): Readonly<Footprint> {
  return SPEC_FOOTPRINT[spec];
}

/** 外廓平面尺寸（含墙）—— 恒等于占格数 × GRID_UNIT */
export function specOuterPlan(spec: RoomSpec): { w: number; d: number } {
  const fp = SPEC_FOOTPRINT[spec];
  return { w: fp.cx * GRID_UNIT, d: fp.cz * GRID_UNIT };
}

/** 某面墙横跨几条占格边：north/south 沿 X 跨 cx 条，east/west 沿 Z 跨 cz 条 */
export function wallCellCount(spec: RoomSpec, wall: WallSide): number {
  const fp = SPEC_FOOTPRINT[spec];
  return WALL_SPAN_AXIS[wall] === 'x' ? fp.cx : fp.cz;
}

/**
 * `cells` 条格边的中心相对**墙中心**的偏移。
 *
 *   1 条 → [0]
 *   2 条 → [-15, +15]
 *
 * 这些偏移是相对占格中心量的，而墙中心与占格中心重合（墙在占格内侧对称收进），
 * 所以偏移值**与墙厚无关** —— 对齐是精确的。
 */
export function cellEdgeOffsets(cells: number): number[] {
  return Array.from({ length: cells }, (_, i) => (i + 0.5 - cells / 2) * GRID_UNIT);
}

function derivePortals(spec: RoomSpec): readonly Opening[] {
  const portals: Opening[] = [];
  for (const wall of WALL_SIDES) {
    const offsets = cellEdgeOffsets(wallCellCount(spec, wall));
    offsets.forEach((offset, i) => {
      portals.push(
        Object.freeze({
          id: `portal_${wall}_${i}`,
          wall,
          type: 'portal' as const,
          offset,
          // 复用同一个冻结对象：所有传送门尺寸恒等，没必要各存一份，
          // 冻结也顺带堵住"改了一个门的尺寸结果全库都变了"这种事故
          size: PORTAL_SIZE,
          elevation: PORTAL_ELEVATION,
        }),
      );
    });
  }
  return Object.freeze(portals);
}

/** 各规格的传送门表（派生，不可手写） */
export const SPEC_PORTALS: Readonly<Record<RoomSpec, readonly Opening[]>> = Object.freeze({
  S: derivePortals('S'),
  M: derivePortals('M'),
  L: derivePortals('L'),
});

/** 该规格的全部传送门。返回冻结的共享数组，不要修改。 */
export function specPortals(spec: RoomSpec): readonly Opening[] {
  return SPEC_PORTALS[spec];
}

/** 该规格的传送门总数（S=4 / M=6 / L=8） */
export function specPortalCount(spec: RoomSpec): number {
  return SPEC_PORTALS[spec].length;
}

/** 传送门 id 的集合，用于检测手写开口与派生传送门撞名 */
export function specPortalIds(spec: RoomSpec): ReadonlySet<string> {
  return new Set(SPEC_PORTALS[spec].map((p) => p.id));
}
