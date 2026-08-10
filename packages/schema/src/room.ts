import { z } from 'zod';
import type { Footprint } from './spec.js';
import { RoomSpec, specFootprint, specOuterPlan, specPortals, specSize } from './spec.js';
import type { Size3 } from './primitives.js';
import { Id, Tags, UserData } from './primitives.js';
import { Opening } from './opening.js';
import { Structure } from './structure.js';
import { Light, Marker, Prop } from './content.js';

/**
 * Room —— 一个**全封闭**的立方体外壳 + 内部结构。**一个房间 = 一个独立关卡。**
 *
 * ── 作者写什么，什么是派生的 ────────────────────────────────
 *
 *  作者/AI 只写 **`spec` + 内部内容**。以下全部由 `spec` 派生，**不出现在文档里**：
 *    · 净内空尺寸  `roomSize(room)`      ← GRID_UNIT × 占格 − 2×WALL_T
 *    · 外廓尺寸    `roomOuterPlan(room)`
 *    · 传送门      `roomPortals(room)`   ← 每条占格边一个，居中于格边
 *    · 门数        传送门数量（S=4 / M=6 / L=8）
 *
 *  这不只是省字数。36 个房间是**可互换单元**，同规格的房间外形与接口必须
 *  逐毫米一致；只要允许手写，就一定会漂移，而漂移的后果是拼装后门对不上墙。
 *  把它们变成派生量，这类 bug 在结构上不可能发生 —— 不需要校验器去抓。
 *
 *  同样的理由，这里**没有** `pin` / `size` / `doorCount` / `wallThickness`：
 *  房间不需要世界坐标（每个房间就是一个独立关卡，永远在原点），
 *  朝向与出口编号由游戏侧处理（房间可旋转）。
 */
export const Room = z
  .strictObject({
    id: Id,
    name: z.string().max(80).optional().describe('给人看的显示名'),

    /** 唯一的尺寸来源。改 spec 就改了尺寸、层高和传送门布局。 */
    spec: RoomSpec,
    theme: Id.describe('引用 document.themes 中的主题 id'),

    openings: z
      .array(Opening)
      .default([])
      .describe(
        '**额外**的非传送门开口（窗 / 内部拱门等）。传送门由 spec 派生，写在这里会被 R020 拒绝',
      ),
    structures: z.array(Structure).default([]).describe('内部结构件：夹层 / 楼梯 / 廊桥 / 柱梁等'),
    props: z.array(Prop).default([]),
    lights: z.array(Light).default([]),
    markers: z.array(Marker).default([]),

    tags: Tags,
    userData: UserData,
    note: z.string().max(500).optional(),
  })
  .describe('一个全封闭的立方体房间 —— 同时是一个独立关卡');
export type Room = z.infer<typeof Room>;

// ── 派生量访问器 ──────────────────────────────────────────────
//
// 刻意做成函数而不是 schema 字段：字段可以被手写覆盖，函数不能。

/** 净内空尺寸（可走范围）。w 沿 X，d 沿 Z，h 沿 Y。 */
export function roomSize(room: Room): Readonly<Size3> {
  return specSize(room.spec);
}

/** 占格数 */
export function roomFootprint(room: Room): Readonly<Footprint> {
  return specFootprint(room.spec);
}

/** 外廓平面尺寸（含墙）—— 恒等于占格数 × GRID_UNIT */
export function roomOuterPlan(room: Room): { w: number; d: number } {
  return specOuterPlan(room.spec);
}

/** 由规格派生的传送门。返回冻结的共享数组，不要修改。 */
export function roomPortals(room: Room): readonly Opening[] {
  return specPortals(room.spec);
}

/**
 * 房间外壳上的**全部**开口 = 派生传送门 + 作者手写的其它开口。
 *
 * 几何生成与开口类校验都必须走这个函数，否则会漏掉传送门。
 */
export function roomOpenings(room: Room): readonly Opening[] {
  const portals = roomPortals(room);
  return room.openings.length === 0 ? portals : [...portals, ...room.openings];
}
