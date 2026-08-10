import type { BufferGeometry } from 'three';
import { ExtrudeGeometry, Path, Shape } from 'three';
import type { Opening, Room, WallSide } from '@tjre/schema';
import { WALL_SPAN_AXIS, WALL_T, roomOpenings, roomSize } from '@tjre/schema';

/**
 * ============================================================
 *  房间外壳几何 —— 带洞口的墙面 + 地板 + 天花
 * ============================================================
 *
 *  · 净内空尺寸由 `roomSize(room)` 从 spec 派生，墙体从内表面向**外**长出
 *  · 每面墙长出**完整** `WALL_T`（0.75m）。
 *      于是外廓 AABB 恰好等于占格尺寸（30/60m 的整数倍），任意两个房间
 *      都能无缝对接。v0.1 曾让每面墙只出半厚（相邻房间各出一半共享一道墙），
 *      那是"关卡=多房间连通空间"模型的产物；现在每个房间是独立关卡，
 *      各自带完整外壳。
 *  · 洞口用 `Shape` + `holes` 挖出，交给 three.js 内置的 Earcut 三角化
 *  · 洞口取 `roomOpenings(room)` —— **必须**包含派生传送门，否则墙上不开洞
 *
 *  本模块产出的几何体**已经位于房间局部坐标系**（原点 = 地面矩形中心，
 *  y 向上，与 structures / markers 的基准一致）。`buildScene` 只需再套一层
 *  房间的世界变换。刻意不返回"墙面局部坐标 + 需要调用方推导旋转"的形式 ——
 *  那样极容易把 `offset` 的方向搞反。
 */

/** 挤出用的中间坐标：x = 沿墙延展(u)，y = 高度(v)，z = 朝外深度(e) */
interface UVE {
  u: number;
  v: number;
  e: number;
}

/**
 * 把 (u, v, e) 映射到房间局部 (x, y, z)。
 *
 * `u` 的正方向**必须**与 schema 的 `offset` 正方向一致
 * （north/south 沿 +X，east/west 沿 +Z），否则洞口会左右镜像。
 *
 * 其中 north / east 两种映射的行列式为 -1（含镜像），会让三角形绕向翻转、
 * `computeVertexNormals` 算出朝内的法线。这里**不做修正**，因为材质使用
 * `DoubleSide` —— three.js 的着色器对背面片元会自动翻转法线
 * （`normal_fragment_begin` 里按 `gl_FrontFacing` 取反），光照结果正确。
 */
function mapper(room: Room, wall: WallSide): (p: UVE) => [number, number, number] {
  const size = roomSize(room);
  const halfW = size.w / 2;
  const halfD = size.d / 2;
  switch (wall) {
    case 'north': // 朝 -Z
      return ({ u, v, e }) => [u, v, -halfD - e];
    case 'south': // 朝 +Z
      return ({ u, v, e }) => [u, v, halfD + e];
    case 'east': // 朝 +X
      return ({ u, v, e }) => [halfW + e, v, u];
    case 'west': // 朝 -X
      return ({ u, v, e }) => [-halfW - e, v, u];
  }
}

/** 原地把几何体的顶点从 (u,v,e) 重映射到房间局部坐标 */
function remap(geometry: BufferGeometry, map: (p: UVE) => [number, number, number]): void {
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = map({ u: position.getX(i), v: position.getY(i), e: position.getZ(i) });
    position.setXYZ(i, x, y, z);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** 墙面在其延展轴上的净跨度 */
function wallSpan(room: Room, wall: WallSide): number {
  const size = roomSize(room);
  return WALL_SPAN_AXIS[wall] === 'x' ? size.w : size.d;
}

function openingsOnWall(room: Room, wall: WallSide): Opening[] {
  return roomOpenings(room).filter((o) => o.wall === wall);
}

/**
 * 一面墙的 2D 轮廓：外框 = 整面墙，holes = 各洞口。
 *
 * `Shape.holes` 要求与外轮廓**相反**的绕向：外轮廓逆时针，洞口顺时针。
 */
function wallShape(room: Room, wall: WallSide): Shape {
  const half = wallSpan(room, wall) / 2;
  const height = roomSize(room).h;

  const shape = new Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half, height);
  shape.lineTo(-half, height);
  shape.closePath();

  for (const opening of openingsOnWall(room, wall)) {
    const u0 = opening.offset - opening.size.w / 2;
    const u1 = opening.offset + opening.size.w / 2;
    const v0 = opening.elevation;
    const v1 = opening.elevation + opening.size.h;

    const hole = new Path();
    hole.moveTo(u0, v0);
    hole.lineTo(u0, v1);
    hole.lineTo(u1, v1);
    hole.lineTo(u1, v0);
    hole.closePath();
    shape.holes.push(hole);
  }

  return shape;
}

function extrude(shape: Shape, depth: number): BufferGeometry {
  return new ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 });
}

export interface WallGeometryResult {
  wall: WallSide;
  geometry: BufferGeometry;
  openingCount: number;
}

/** 生成一面墙的几何体（房间局部坐标） */
export function buildWallGeometry(
  room: Room,
  wall: WallSide,
  wallThickness: number = WALL_T,
): WallGeometryResult {
  const shape = wallShape(room, wall);
  const geometry = extrude(shape, wallThickness);
  remap(geometry, mapper(room, wall));
  geometry.name = `${room.id}_wall_${wall}`;
  return { wall, geometry, openingCount: shape.holes.length };
}

/** 内部净内空的水平矩形，用于地板 / 天花 */
function footprintShape(room: Room): Shape {
  const size = roomSize(room);
  const hw = size.w / 2;
  const hd = size.d / 2;
  const shape = new Shape();
  shape.moveTo(-hw, -hd);
  shape.lineTo(hw, -hd);
  shape.lineTo(hw, hd);
  shape.lineTo(-hw, hd);
  shape.closePath();
  return shape;
}

/** 地板：顶面精确落在 y = 0，向下长出一个完整墙厚 */
export function buildFloorGeometry(room: Room, wallThickness: number = WALL_T): BufferGeometry {
  const geometry = extrude(footprintShape(room), wallThickness);
  // shape 的 (x, y) 是水平面的 (x, z)，挤出方向 e 变成向下
  remap(geometry, ({ u, v, e }) => [u, -e, v]);
  geometry.name = `${room.id}_floor`;
  return geometry;
}

/** 天花：底面精确落在 y = 层高 */
export function buildCeilingGeometry(room: Room, wallThickness: number = WALL_T): BufferGeometry {
  const geometry = extrude(footprintShape(room), wallThickness);
  const height = roomSize(room).h;
  remap(geometry, ({ u, v, e }) => [u, height + e, v]);
  geometry.name = `${room.id}_ceiling`;
  return geometry;
}

/**
 * ── Phase 1 的已知简化点（Phase 5 导出 UE 前需处理）────────────
 *
 * 1. UV：`ExtrudeGeometry` 默认的 UV 生成器不适合墙面贴图，当前只服务可视化。
 *    Phase 4 接材质预设时需要自定义 UVGenerator。
 * 2. 四面墙在角落互相重叠 `WALL_T × WALL_T` 的一小段。视觉上无影响
 *    （两块实体交叠，不是共面，不会 z-fighting），但导出 UE 时应做布尔合并
 *    以免碰撞体重复计算 —— Phase 5 处理。
 * 3. 洞口只支持四面立墙；地板 / 天花开洞不在 v0.2 schema 范围内。
 */
