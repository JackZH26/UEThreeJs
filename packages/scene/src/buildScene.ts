import { Group, Mesh, MathUtils } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { Room, RoomGraphDocument, Theme, WallSide } from '@tjre/schema';
import { WALL_SIDES, isPortal } from '@tjre/schema';
import { solveLayout } from '@tjre/core';
import type { LayoutResult, RoomPlacement } from '@tjre/core';
import { MaterialLibrary } from './materials.js';
import { buildCeilingGeometry, buildFloorGeometry, buildWallGeometry } from './shell.js';
import { buildStructureGeometry } from './structures.js';
import { PORTAL_FRAME_MATERIAL, PORTAL_SURFACE_MATERIAL, buildPortalGeometry } from './portal.js';

/**
 * RoomGraph → three.js 场景。
 *
 * 房间的世界坐标不来自文档，而来自 `solveLayout` 的求解结果 ——
 * 这是 P2「图驱动布局」在渲染侧的体现。
 */

export interface BuildSceneOptions {
  /** 复用已有的求解结果；不传则内部求解一次 */
  layout?: LayoutResult;
  materials?: MaterialLibrary;
  wireframe?: boolean;
  /**
   * 是否生成天花。
   *
   * **默认 `false`** —— 编辑器的常态是从外部俯视，天花会把房间内部
   * （夹层、楼梯、道具）全部挡住，等于什么都看不见。第一人称漫游时才需要打开。
   */
  showCeiling?: boolean;
  /** 是否生成内部结构件几何 */
  showStructures?: boolean;
  /**
   * **单房间隔离模式** —— 只构建这一个房间，并把它固定在原点、旋转 0。
   *
   * 这是编辑器的**常态**：游戏（ENTER THE CUBE）里 36 个房间是可互换的独立
   * 单元，每局按 seed 随机拼装，房间之间没有固定连接。所以"把整份文档当成
   * 一个连通空间来摆位"是错的模型 —— 一次只编辑一个房间才对。
   *
   * 隔离模式**完全不走布局求解器**：房间就在原点，不存在需要推导的位置。
   */
  isolateRoom?: string;
}

export interface BuildSceneResult {
  root: Group;
  layout: LayoutResult;
  materials: MaterialLibrary;
  /** roomId → 该房间的 Group，供编辑器做选择高亮 */
  roomGroups: Map<string, Group>;
  /** 可行走表面的 mesh —— 第一人称漫游的地面射线只需要打这些 */
  walkables: Mesh[];
  stats: { rooms: number; meshes: number; openings: number; structures: number; portals: number };
  /**
   * 释放本次构建产生的全部 GPU 资源。
   *
   * three.js 核心没有自动回收 —— 忘记调用就会漏显存且**不报任何错**。
   * 编辑器每次热重载都必须调它。
   */
  dispose: () => void;
}

function themeOf(doc: RoomGraphDocument, room: Room): Theme | undefined {
  return doc.themes.find((t) => t.id === room.theme);
}

/** 表面材质 id：优先主题指定，缺失则回落到一个可辨识的占位名 */
function surfaceMaterialId(
  theme: Theme | undefined,
  surface: 'floor' | 'ceiling' | 'wall',
): string {
  return theme?.surfaces[surface] ?? `missing_${surface}`;
}

function applyPlacement(object: Object3D, placement: RoomPlacement): void {
  object.position.set(placement.x, placement.y, placement.z);
  object.rotation.y = MathUtils.degToRad(placement.rotationY);
}

export function buildScene(
  doc: RoomGraphDocument,
  options: BuildSceneOptions = {},
): BuildSceneResult {
  const layout = options.layout ?? solveLayout(doc);
  const materials = options.materials ?? new MaterialLibrary({ wireframe: options.wireframe });
  const ownsMaterials = options.materials === undefined;

  const root = new Group();
  root.name = 'roomgraph';

  const roomGroups = new Map<string, Group>();
  const walkables: Mesh[] = [];
  const geometries: { dispose: () => void }[] = [];
  let meshCount = 0;
  let openingCount = 0;
  let structureCount = 0;
  let portalCount = 0;

  const isolate = options.isolateRoom;

  for (const room of doc.rooms) {
    if (isolate !== undefined && room.id !== isolate) continue;

    // 隔离模式：房间固定在原点，不查求解结果
    const placement =
      isolate !== undefined
        ? ({
            roomId: room.id,
            x: 0,
            y: 0,
            z: 0,
            rotationY: 0,
            hx: room.size.w / 2,
            hz: room.size.d / 2,
            origin: 'anchor',
          } as RoomPlacement)
        : layout.placements.get(room.id);

    // 未被定位的房间跳过 —— 求解器已用 R072 报告，这里静默略过避免叠加噪声
    if (placement === undefined) continue;

    const theme = themeOf(doc, room);
    const thickness = room.wallThickness ?? doc.meta.wallThickness;

    const group = new Group();
    group.name = `room:${room.id}`;
    group.userData = { roomId: room.id, kind: 'room' };
    applyPlacement(group, placement);

    const add = (
      geometry: BufferGeometry,
      materialId: string,
      name: string,
      meta: { kind: string; walkable?: boolean; structureId?: string; openingId?: string } = {
        kind: 'shell',
      },
    ): void => {
      const mesh = new Mesh(geometry, materials.get(materialId));
      mesh.name = name;
      mesh.userData = { roomId: room.id, ...meta };
      group.add(mesh);
      meshCount++;
      geometries.push(geometry);
      if (meta.walkable === true) walkables.push(mesh);
    };

    // 四面立墙（带洞口）
    for (const wall of WALL_SIDES as readonly WallSide[]) {
      const built = buildWallGeometry(room, wall, thickness);
      openingCount += built.openingCount;
      add(built.geometry, surfaceMaterialId(theme, 'wall'), `wall:${wall}`);
    }

    add(buildFloorGeometry(room, thickness), surfaceMaterialId(theme, 'floor'), 'floor', {
      kind: 'shell',
      walkable: true,
    });

    if (options.showCeiling === true) {
      add(buildCeilingGeometry(room, thickness), surfaceMaterialId(theme, 'ceiling'), 'ceiling');
    }

    // 传送门：固定样式（门面 + 门框），样式定义在 portal.ts
    for (const opening of room.openings) {
      if (!isPortal(opening.type)) continue;
      const portal = buildPortalGeometry(room, opening);
      portalCount++;
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
        structureCount++;
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

    root.add(group);
    roomGroups.set(room.id, group);
  }

  return {
    root,
    layout,
    materials,
    roomGroups,
    walkables,
    stats: {
      rooms: roomGroups.size,
      meshes: meshCount,
      openings: openingCount,
      structures: structureCount,
      portals: portalCount,
    },
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      geometries.length = 0;
      walkables.length = 0;
      if (ownsMaterials) materials.dispose();
      root.clear();
      roomGroups.clear();
    },
  };
}
