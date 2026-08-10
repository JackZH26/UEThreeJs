import { Group, Mesh, MathUtils } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { Room, RoomGraphDocument, Theme, WallSide } from '@tjre/schema';
import { WALL_SIDES } from '@tjre/schema';
import { solveLayout } from '@tjre/core';
import type { LayoutResult, RoomPlacement } from '@tjre/core';
import { MaterialLibrary } from './materials.js';
import { buildCeilingGeometry, buildFloorGeometry, buildWallGeometry } from './shell.js';
import { buildStructureGeometry } from './structures.js';

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
}

export interface BuildSceneResult {
  root: Group;
  layout: LayoutResult;
  materials: MaterialLibrary;
  /** roomId → 该房间的 Group，供编辑器做选择高亮 */
  roomGroups: Map<string, Group>;
  /** 可行走表面的 mesh —— 第一人称漫游的地面射线只需要打这些 */
  walkables: Mesh[];
  stats: { rooms: number; meshes: number; openings: number; structures: number };
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

  for (const room of doc.rooms) {
    const placement = layout.placements.get(room.id);
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
      meta: { kind: string; walkable?: boolean; structureId?: string } = { kind: 'shell' },
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
