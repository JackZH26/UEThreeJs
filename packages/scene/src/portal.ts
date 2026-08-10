import { BoxGeometry, PlaneGeometry } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Opening, Room, WallSide } from '@tjre/schema';
import { roomSize } from '@tjre/schema';
import { DIRECTION } from '@tjre/core';

/**
 * ============================================================
 *  传送门几何（固定样式）
 * ============================================================
 *
 *  传送门是房间之间**唯一**的连接方式，另一端在别的关卡里 ——
 *  运行时由生成器按 seed 决定去向，关卡作者不指定。
 *
 *  传送门的**位置与数量**由房间规格派生（见 schema/spec.ts：每条占格边一个，
 *  居中于格边）。本文件只管**长什么样**。
 *
 *  样式先固定下来（本文件即样式的唯一定义处），由两部分组成：
 *    · 门面：填满洞口的一个平面，用高亮自发光材质，在灰调场景里一眼可辨
 *    · 门框：沿洞口四边的一圈方棒，向房间内侧略微凸出，提供厚度感
 *
 *  产出几何位于**房间局部坐标系**，与 shell.ts / structures.ts 一致。
 */

/** 门框截面尺寸（m） */
const FRAME_THICKNESS = 0.12;
/** 门框向房间内侧凸出的距离 */
const FRAME_DEPTH = 0.16;
/** 门面相对墙内表面向房间内侧偏移，避免与墙面 z-fighting */
const SURFACE_INSET = 0.02;

/** 传送门的两种材质槽 —— 由 MaterialLibrary 按这两个 id 取色 */
export const PORTAL_SURFACE_MATERIAL = 'portal_surface';
export const PORTAL_FRAME_MATERIAL = 'portal_frame';

/**
 * 把「墙面 2D 坐标 (u, v) + 朝内深度 d」映射到房间局部 (x, y, z)。
 *
 * `u` 与 schema 的 `offset` 同向（north/south 沿 +X，east/west 沿 +Z），
 * `d` 为正表示朝**房间内侧**（与墙的朝外法向相反）。
 */
function toLocal(
  room: Room,
  wall: WallSide,
  u: number,
  v: number,
  d: number,
): [number, number, number] {
  const size = roomSize(room);
  const halfW = size.w / 2;
  const halfD = size.d / 2;
  const dir = DIRECTION[wall]; // 朝外法向
  switch (wall) {
    case 'north':
    case 'south':
      return [u, v, dir.z * halfD - dir.z * d];
    case 'east':
    case 'west':
      return [dir.x * halfW - dir.x * d, v, u];
  }
}

/** 绕 Y 轴的旋转角，使几何体的局部 +Z 对准该墙的朝外法向 */
function wallYaw(wall: WallSide): number {
  const dir = DIRECTION[wall];
  return Math.atan2(dir.x, dir.z);
}

export interface PortalGeometryResult {
  openingId: string;
  /** 门面（自发光平面） */
  surface: BufferGeometry;
  /** 门框（一圈方棒，已合并） */
  frame: BufferGeometry;
}

/**
 * 生成一个传送门的几何体。
 *
 * 只在 `opening.type === 'portal'` 时调用；调用方负责筛选。
 */
export function buildPortalGeometry(room: Room, opening: Opening): PortalGeometryResult {
  const { wall, offset, size, elevation } = opening;
  const centerV = elevation + size.h / 2;

  // ── 门面 ────────────────────────────────────────────────
  const surface = new PlaneGeometry(size.w, size.h);
  // PlaneGeometry 默认在 XY 平面、法线朝 +Z；转到该墙的朝向
  surface.rotateY(wallYaw(wall));
  {
    const [x, y, z] = toLocal(room, wall, offset, centerV, SURFACE_INSET);
    surface.translate(x, y, z);
  }
  surface.name = `${room.id}_portal_surface_${opening.id}`;

  // ── 门框：四条方棒 ──────────────────────────────────────
  const halfW = size.w / 2;
  const halfH = size.h / 2;
  const t = FRAME_THICKNESS;
  const bars: BufferGeometry[] = [];

  /** 在墙面坐标里放一根方棒：沿 u 长 lu、沿 v 长 lv，中心 (cu, cv) */
  const addBar = (cu: number, cv: number, lu: number, lv: number): void => {
    const bar = new BoxGeometry(lu, lv, FRAME_DEPTH);
    bar.rotateY(wallYaw(wall));
    const [x, y, z] = toLocal(room, wall, cu, cv, FRAME_DEPTH / 2);
    bar.translate(x, y, z);
    bars.push(bar);
  };

  // 上、下（横向跨满含边框外扩）
  addBar(offset, centerV + halfH + t / 2, size.w + t * 2, t);
  addBar(offset, centerV - halfH - t / 2, size.w + t * 2, t);
  // 左、右（纵向只跨洞口高度）
  addBar(offset - halfW - t / 2, centerV, t, size.h);
  addBar(offset + halfW + t / 2, centerV, t, size.h);

  const merged = mergeGeometries(bars, false);
  for (const bar of bars) bar.dispose();
  if (merged === null) throw new Error(`传送门 ${opening.id} 的门框几何合并失败`);
  merged.name = `${room.id}_portal_frame_${opening.id}`;

  return { openingId: opening.id, surface, frame: merged };
}
