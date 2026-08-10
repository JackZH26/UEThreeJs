import { Group, Mesh } from 'three';
import type { BufferGeometry } from 'three';
import type { Room, RoomGraphDocument, Theme } from '@tjre/schema';
import { WALL_SIDES, isPortal, roomOuterPlan, roomPortals, roomSize } from '@tjre/schema';
import { MaterialLibrary } from './materials.js';
import { buildCeilingGeometry, buildFloorGeometry, buildWallGeometry } from './shell.js';
import { buildStructureGeometry } from './structures.js';
import { buildPropGeometry } from './props.js';
import { PORTAL_FRAME_MATERIAL, PORTAL_SURFACE_MATERIAL, buildPortalGeometry } from './portal.js';
import { buildLights } from './lights.js';

/**
 * ============================================================
 *  Room → three.js 场景
 * ============================================================
 *
 *  **一次只构建一个房间**，固定在原点、旋转 0。
 *
 *  这不是一个"隔离视图"选项，而是模型本身：ENTER THE CUBE 的每个房间就是
 *  一个独立关卡，36 个房间是可互换单元，运行时按 seed 拼装、朝向由游戏侧
 *  决定。所以"房间的世界坐标"在编辑器里不是一个有意义的概念 ——
 *  v0.1 的布局求解器已随此模型修正一并删除。
 *
 *  文档里若有多个房间，视为一个**房间库**，由调用方选一个来构建。
 */

export interface BuildRoomOptions {
  /** 复用外部材质库（多次重建时避免重复编译 shader）；不传则内部新建 */
  materials?: MaterialLibrary;
  wireframe?: boolean;
  /**
   * 是否生成天花。
   *
   * **默认 `false`** —— 编辑器的常态是从外部俯视，天花会把房间内部
   * （夹层、楼梯、道具）全部挡住，等于什么都看不见。第一人称漫游时才需要打开。
   */
  showCeiling?: boolean;
  /** 是否生成内部结构件几何。默认 `true`。 */
  showStructures?: boolean;
  /**
   * 是否生成道具几何（`room.props`）。默认 `true`。
   *
   * 关掉是为了看清结构：一间摆满碰碰车的房间，地面布局会被道具遮住。
   */
  showProps?: boolean;
  /**
   * 是否把 `room.lights` 里的灯光实例化进场景。默认 `true`。
   *
   * 关掉是为了对照：只留编辑器的主光时更容易看清几何，
   * 而开着才是关卡的真实照明。
   */
  showLights?: boolean;
}

export interface BuildRoomStats {
  /** 洞口总数（含派生传送门） */
  openings: number;
  portals: number;
  structures: number;
  /** 实际建出几何的道具数（不是 mesh 数 —— 一个道具会按材质拆成多个 mesh） */
  props: number;
  meshes: number;
  /** 实例化的灯光数 */
  lights: number;
  /** 其中开启了阴影的灯数 —— 阴影是主要开销，值得暴露出来 */
  shadowCasters: number;
}

export interface BuildRoomResult {
  /** 该房间的 Group，位于原点。直接 `scene.add(root)`。 */
  root: Group;
  materials: MaterialLibrary;
  /** 可行走表面的 mesh —— 第一人称漫游的地面射线只需要打这些 */
  walkables: Mesh[];
  /** 净内空尺寸（w/d/h）与外廓平面尺寸，供相机取景与面板显示 */
  size: { w: number; d: number; h: number };
  outerPlan: { w: number; d: number };
  stats: BuildRoomStats;
  /**
   * 释放本次构建产生的全部 GPU 资源。
   *
   * three.js 核心没有自动回收 —— 忘记调用就会漏显存且**不报任何错**。
   * 编辑器每次热重载都必须调它。
   */
  dispose: () => void;
}

/** 表面材质 id：优先主题指定，缺失则回落到一个可辨识的占位名 */
function surfaceMaterialId(
  theme: Theme | undefined,
  surface: 'floor' | 'ceiling' | 'wall',
): string {
  return theme?.surfaces[surface] ?? `missing_${surface}`;
}

/** 构建单个房间。`room` 与 `theme` 由调用方查好 —— 本函数不做查找与校验。 */
export function buildRoom(
  room: Room,
  theme: Theme | undefined,
  options: BuildRoomOptions = {},
): BuildRoomResult {
  const materials = options.materials ?? new MaterialLibrary({ wireframe: options.wireframe });
  const ownsMaterials = options.materials === undefined;

  const root = new Group();
  root.name = `room:${room.id}`;
  root.userData = { roomId: room.id, kind: 'room' };

  const walkables: Mesh[] = [];
  const geometries: BufferGeometry[] = [];
  const stats: BuildRoomStats = {
    openings: 0,
    portals: 0,
    structures: 0,
    props: 0,
    meshes: 0,
    lights: 0,
    shadowCasters: 0,
  };

  const add = (
    geometry: BufferGeometry,
    materialId: string,
    name: string,
    meta: {
      kind: string;
      walkable?: boolean;
      structureId?: string;
      openingId?: string;
      propId?: string;
      /** 覆盖阴影开关；留空 = 按 kind 判断 */
      shadow?: boolean;
    } = {
      kind: 'shell',
    },
  ): void => {
    const mesh = new Mesh(geometry, materials.get(materialId));
    mesh.name = name;
    mesh.userData = { roomId: room.id, ...meta };
    // 外壳与结构件都参与阴影：墙体投影会在地面形成"井底"光影，
    // 那正是参考例子（阳光射进地牢）的观感来源。
    // 传送门与彩灯是自发光面片，投影只会给出一块莫名的黑影 —— 排除。
    const shadow = meta.shadow ?? meta.kind !== 'portal';
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    root.add(mesh);
    stats.meshes++;
    geometries.push(geometry);
    if (meta.walkable === true) walkables.push(mesh);
  };

  // 四面立墙（洞口已由 shell 从 roomOpenings 里挖好，含派生传送门）
  for (const wall of WALL_SIDES) {
    const built = buildWallGeometry(room, wall);
    stats.openings += built.openingCount;
    add(built.geometry, surfaceMaterialId(theme, 'wall'), `wall:${wall}`);
  }

  add(buildFloorGeometry(room), surfaceMaterialId(theme, 'floor'), 'floor', {
    kind: 'shell',
    walkable: true,
  });

  if (options.showCeiling === true) {
    add(buildCeilingGeometry(room), surfaceMaterialId(theme, 'ceiling'), 'ceiling');
  }

  // 传送门：固定样式（门面 + 门框），样式定义在 portal.ts
  for (const opening of roomPortals(room)) {
    if (!isPortal(opening.type)) continue;
    const portal = buildPortalGeometry(room, opening);
    stats.portals++;
    add(portal.surface, PORTAL_SURFACE_MATERIAL, `portal:${opening.id}`, {
      kind: 'portal',
      openingId: opening.id,
    });
    add(portal.frame, PORTAL_FRAME_MATERIAL, `portal_frame:${opening.id}`, {
      kind: 'portal',
      openingId: opening.id,
    });
  }

  if (options.showStructures !== false) {
    const structureMaterial = theme?.surfaces.structure ?? 'missing_structure';
    for (const structure of room.structures) {
      const built = buildStructureGeometry(room, structure);
      // null = 该结构件无有效几何（例如楼梯落点不高于起点，已由 R013 报 error）
      if (built === null) continue;
      stats.structures++;
      add(
        built.geometry,
        structure.material ?? structureMaterial,
        `${built.type}:${structure.id}`,
        {
          kind: 'structure',
          walkable: built.walkable,
          structureId: structure.id,
        },
      );
    }
  }

  // ── 道具 ──────────────────────────────────────────────
  // 道具**不进 walkables**：Prop 是摆放物，不提供可行走表面（见 props.ts）
  if (options.showProps !== false) {
    for (const prop of room.props) {
      const built = buildPropGeometry(prop);
      if (built === null) continue;
      stats.props++;
      for (const part of built.parts) {
        add(part.geometry, part.materialId, `prop:${prop.id}:${part.materialId}`, {
          kind: 'prop',
          propId: prop.id,
          shadow: !part.emissive,
        });
      }
    }
  }

  // ── 灯光 ──────────────────────────────────────────────
  // spot 的 target 必须一起进场景图，否则它的世界矩阵不更新、朝向不生效
  const builtLights = options.showLights === false ? null : buildLights(room);
  if (builtLights !== null) {
    for (const { light, target } of builtLights.lights) {
      root.add(light);
      if (target !== null) root.add(target);
    }
    stats.lights = builtLights.lights.length;
    stats.shadowCasters = builtLights.shadowCasters;
  }

  const size = roomSize(room);

  return {
    root,
    materials,
    walkables,
    size: { w: size.w, d: size.d, h: size.h },
    outerPlan: roomOuterPlan(room),
    stats,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      walkables.length = 0;
      // 灯光也持有 GPU 资源（阴影贴图、RectAreaLight 的 LTC 纹理）
      if (builtLights !== null) {
        for (const { light } of builtLights.lights) light.dispose();
        builtLights.lights.length = 0;
      }
      if (ownsMaterials) materials.dispose();
      root.clear();
    },
  };
}

/**
 * 便捷入口：从文档里按 id 取房间并构建。
 *
 * 找不到房间时**抛错**而不是静默返回空场景 —— 静默失败在 v0.1 已经让
 * "整页空白且没有任何提示"这种故障出现过一次，代价远大于一个异常。
 */
export function buildRoomFromDocument(
  doc: RoomGraphDocument,
  roomId: string,
  options: BuildRoomOptions = {},
): BuildRoomResult {
  const room = doc.rooms.find((r) => r.id === roomId);
  if (room === undefined) {
    const available = doc.rooms.map((r) => r.id).join(', ') || '（文档里没有房间）';
    throw new Error(`房间 "${roomId}" 不在文档里。可用房间：${available}`);
  }
  return buildRoom(
    room,
    doc.themes.find((t) => t.id === room.theme),
    options,
  );
}
