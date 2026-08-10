import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3 } from 'three';
import { parseDocument } from '@tjre/core';
import { buildRoom, buildRoomFromDocument } from '@tjre/scene';
import { WALL_T, roomSize, specOuterPlan, specPortalCount } from '@tjre/schema';
import type { RoomGraphDocument, RoomSpec } from '@tjre/schema';

const examplesDir = resolve(import.meta.dirname, '../../../examples');
const P = 4; // Float32 顶点精度，见 shell.test.ts

const EXAMPLES: Record<RoomSpec, { file: string; roomId: string }> = {
  S: { file: 'etc-s-piston-floor.roomgraph.yaml', roomId: 'piston_floor' },
  M: { file: 'etc-m-catwalk-gallery.roomgraph.yaml', roomId: 'catwalk_gallery' },
  L: { file: 'etc-l-atrium.roomgraph.yaml', roomId: 'atrium' },
};

function loadExample(name: string): RoomGraphDocument {
  const loaded = parseDocument(readFileSync(resolve(examplesDir, name), 'utf8'), name);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors, null, 2));
  return loaded.doc;
}

function firstRoomOf(spec: RoomSpec) {
  const { file, roomId } = EXAMPLES[spec];
  return roomFrom(file, roomId);
}

function roomFrom(file: string, roomId: string) {
  const doc = loadExample(file);
  const room = doc.rooms.find((r) => r.id === roomId);
  if (room === undefined) throw new Error(`${file} 里没有房间 ${roomId}`);
  return { doc, room, theme: doc.themes.find((t) => t.id === room.theme) };
}

/** 唯一带道具的示例 —— 三个 S/M/L 基准示例刻意保持"零道具"以隔离外壳断言 */
function arenaRoom() {
  return roomFrom('etc-s-bumper-arena.roomgraph.yaml', 'bumper_arena');
}

describe('外壳 mesh 数量', () => {
  it('默认不生成天花 —— 4 墙 + 地板 + 传送门×2', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { room, theme } = firstRoomOf(spec);
      const built = buildRoom(room, theme, { showStructures: false });
      expect(built.stats.meshes, `spec=${spec}`).toBe(5 + specPortalCount(spec) * 2);
      expect(built.root.children.some((c) => c.name === 'ceiling')).toBe(false);
      built.dispose();
    }
  });

  it('showCeiling 打开后多一个 mesh', () => {
    const { room, theme } = firstRoomOf('S');
    const off = buildRoom(room, theme, { showStructures: false });
    const on = buildRoom(room, theme, { showStructures: false, showCeiling: true });
    expect(on.stats.meshes).toBe(off.stats.meshes + 1);
    expect(on.root.children.some((c) => c.name === 'ceiling')).toBe(true);
    off.dispose();
    on.dispose();
  });

  it('结构件默认生成，数量与文档一致', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { room, theme } = firstRoomOf(spec);
      const built = buildRoom(room, theme);
      expect(built.stats.structures, `spec=${spec}`).toBe(room.structures.length);
      built.dispose();
    }
  });

  it('showStructures=false 时结构件计数为 0', () => {
    const { room, theme } = firstRoomOf('L');
    expect(room.structures.length).toBeGreaterThan(0);
    const built = buildRoom(room, theme, { showStructures: false });
    expect(built.stats.structures).toBe(0);
    built.dispose();
  });
});

/**
 * 道具在 v0.2 之前与 `room.lights` 一样是个**死字段**（YAML 里写了，几何一个不生成）。
 * 这一组盯住"接上了"这件事本身。
 */
describe('道具', () => {
  it('默认生成，数量与文档一致', () => {
    const { room, theme } = arenaRoom();
    expect(room.props.length, '示例应该有道具').toBeGreaterThan(0);
    const built = buildRoom(room, theme);
    expect(built.stats.props).toBe(room.props.length);
    built.dispose();
  });

  it('showProps=false 时一个都不建，且 mesh 数明显下降', () => {
    const { room, theme } = arenaRoom();
    const on = buildRoom(room, theme);
    const off = buildRoom(room, theme, { showProps: false });
    expect(off.stats.props).toBe(0);
    expect(off.stats.meshes).toBeLessThan(on.stats.meshes);
    on.dispose();
    off.dispose();
  });

  it('一个道具按材质拆成多个 mesh，且都带 propId', () => {
    const { room, theme } = arenaRoom();
    const built = buildRoom(room, theme, { showStructures: false });
    const propMeshes = built.root.children.filter((c) => c.name.startsWith('prop:'));
    // 碰碰车用 5 种材质，所以 mesh 数必然多于道具数
    expect(propMeshes.length).toBeGreaterThan(built.stats.props);
    for (const mesh of propMeshes) {
      expect(typeof (mesh.userData as { propId?: unknown }).propId).toBe('string');
      expect((mesh.userData as { kind?: unknown }).kind).toBe('prop');
    }
    built.dispose();
  });

  it('道具不可行走 —— Prop 是摆放物，不提供可行走表面', () => {
    const { room, theme } = arenaRoom();
    const built = buildRoom(room, theme);
    expect(built.walkables.some((m) => m.name.startsWith('prop:'))).toBe(false);
    built.dispose();
  });

  it('自发光道具（彩灯 / 车灯 / 霓虹）不投影，其余道具投影', () => {
    const { room, theme } = arenaRoom();
    const built = buildRoom(room, theme, { showStructures: false });
    const byName = (needle: string) =>
      built.root.children.find((c) => c.name.includes(needle)) as
        { castShadow: boolean } | undefined;
    expect(byName('prop:fest_n1:neon_')?.castShadow).toBe(false);
    expect(byName('prop:car_pink:car_paint_pink')?.castShadow).toBe(true);
    built.dispose();
  });

  it('道具不会捅出外壳', () => {
    const { room, theme } = arenaRoom();
    const built = buildRoom(room, theme, { showCeiling: true });
    const box = new Box3().setFromObject(built.root);
    const outer = specOuterPlan('S');
    expect(box.min.x).toBeGreaterThanOrEqual(-outer.w / 2 - 1e-3);
    expect(box.max.x).toBeLessThanOrEqual(outer.w / 2 + 1e-3);
    expect(box.min.z).toBeGreaterThanOrEqual(-outer.d / 2 - 1e-3);
    expect(box.max.z).toBeLessThanOrEqual(outer.d / 2 + 1e-3);
    expect(box.max.y).toBeLessThanOrEqual(roomSize(room).h + WALL_T + 1e-3);
    built.dispose();
  });
});

describe('灯光', () => {
  it('房间自带的灯默认被实例化 —— 它在 v0.2 之前是个死字段', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { room, theme } = firstRoomOf(spec);
      expect(room.lights.length, `${spec} 示例应该有灯`).toBeGreaterThan(0);
      const built = buildRoom(room, theme);
      expect(built.stats.lights, `spec=${spec}`).toBe(room.lights.length);
      built.dispose();
    }
  });

  it('showLights=false 时一盏都不建', () => {
    const { room, theme } = firstRoomOf('S');
    const built = buildRoom(room, theme, { showLights: false });
    expect(built.stats.lights).toBe(0);
    expect(built.stats.shadowCasters).toBe(0);
    built.dispose();
  });

  it('灯光进了场景图，spot 的 target 也在（否则朝向不生效）', () => {
    const { room, theme } = firstRoomOf('L');
    const built = buildRoom(room, theme, { showStructures: false });
    const lights = built.root.children.filter((c) => c.name.startsWith('light:'));
    expect(lights).toHaveLength(room.lights.length);
    for (const spot of lights.filter(
      (l) => (l as { isSpotLight?: boolean }).isSpotLight === true,
    )) {
      const target = (spot as unknown as { target: { parent: unknown } }).target;
      expect(target.parent, 'spot 的 target 必须也在场景图里').not.toBeNull();
    }
    built.dispose();
  });

  it('阴影标记：外壳与结构件参与，传送门不参与', () => {
    const { room, theme } = firstRoomOf('S');
    const built = buildRoom(room, theme, { showCeiling: true });
    // 只看 mesh —— 灯光与 spot 的 target 也是 root 的子节点
    const meshes = built.root.children.filter((c) => (c as { isMesh?: boolean }).isMesh === true);
    expect(meshes.length).toBe(built.stats.meshes);

    for (const mesh of meshes) {
      const isPortal = mesh.name.startsWith('portal');
      // 传送门是自发光面片，投影只会在地上留一块莫名黑影
      expect(mesh.castShadow, mesh.name).toBe(!isPortal);
      expect(mesh.receiveShadow, mesh.name).toBe(!isPortal);
    }

    // 地板必须接收阴影 —— 它是结构件投影的主要落点，也是最容易漏的一个
    const floor = meshes.find((m) => m.name === 'floor');
    expect(floor?.receiveShadow).toBe(true);
    built.dispose();
  });
});

describe('洞口与可行走面', () => {
  it('洞口总数 = 派生传送门 + 手写开口', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { room, theme } = firstRoomOf(spec);
      const built = buildRoom(room, theme, { showStructures: false });
      expect(built.stats.openings, `spec=${spec}`).toBe(
        specPortalCount(spec) + room.openings.length,
      );
      built.dispose();
    }
  });

  it('可行走表面 = 地板 + platform/catwalk/stair/ramp', () => {
    const { room, theme } = firstRoomOf('L');
    const built = buildRoom(room, theme);
    const walkableStructures = room.structures.filter((s) =>
      ['platform', 'catwalk', 'stair', 'ramp'].includes(s.type),
    );
    expect(built.walkables).toHaveLength(1 + walkableStructures.length);
    // 柱子不可行走
    expect(built.walkables.some((m) => m.name.startsWith('pillar:'))).toBe(false);
    built.dispose();
  });
});

/**
 * ⭐ 与 shell.test.ts 的同名断言互补：那边验证单个几何体，这边验证
 * **整个房间 Group** 的包围盒 —— 也就是实际进场景的东西。
 */
describe('房间包围盒 = 占格尺寸', () => {
  for (const spec of ['S', 'M', 'L'] as const) {
    it(`${spec}：外壳恰好占满 ${specOuterPlan(spec).w} × ${specOuterPlan(spec).d}m`, () => {
      const { room, theme } = firstRoomOf(spec);
      const built = buildRoom(room, theme, { showCeiling: true, showStructures: false });
      const box = new Box3().setFromObject(built.root);
      const outer = specOuterPlan(spec);

      expect(box.min.x).toBeCloseTo(-outer.w / 2, P);
      expect(box.max.x).toBeCloseTo(outer.w / 2, P);
      expect(box.min.z).toBeCloseTo(-outer.d / 2, P);
      expect(box.max.z).toBeCloseTo(outer.d / 2, P);
      expect(box.min.y).toBeCloseTo(-WALL_T, P);
      expect(box.max.y).toBeCloseTo(roomSize(room).h + WALL_T, P);

      built.dispose();
    });
  }

  it('关掉天花时最高点是墙顶（正好等于层高）', () => {
    const { room, theme } = firstRoomOf('S');
    const built = buildRoom(room, theme, { showStructures: false });
    expect(new Box3().setFromObject(built.root).max.y).toBeCloseTo(roomSize(room).h, P);
    built.dispose();
  });

  it('结构件不会捅出外壳', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { room, theme } = firstRoomOf(spec);
      const built = buildRoom(room, theme, { showCeiling: true });
      const box = new Box3().setFromObject(built.root);
      const outer = specOuterPlan(spec);
      expect(box.min.x, `${spec} 西`).toBeGreaterThanOrEqual(-outer.w / 2 - 1e-3);
      expect(box.max.x, `${spec} 东`).toBeLessThanOrEqual(outer.w / 2 + 1e-3);
      expect(box.min.z, `${spec} 北`).toBeGreaterThanOrEqual(-outer.d / 2 - 1e-3);
      expect(box.max.z, `${spec} 南`).toBeLessThanOrEqual(outer.d / 2 + 1e-3);
      expect(box.max.y, `${spec} 顶`).toBeLessThanOrEqual(roomSize(room).h + WALL_T + 1e-3);
      built.dispose();
    }
  });
});

describe('材质与释放', () => {
  it('材质按 id 复用，不是每面墙新建一个', () => {
    const { room, theme } = firstRoomOf('L');
    const built = buildRoom(room, theme);
    // 3 种表面 + 结构件 + 传送门两种 = 至多 6 种，远少于 mesh 数
    expect(built.materials.size).toBeLessThanOrEqual(6);
    expect(built.materials.size).toBeGreaterThan(0);
    expect(built.stats.meshes).toBeGreaterThan(built.materials.size);
    built.dispose();
  });

  it('同一材质 id 每次得到相同颜色（占位色必须稳定）', () => {
    const { room, theme } = firstRoomOf('S');
    const a = buildRoom(room, theme);
    const b = buildRoom(room, theme);
    const colorOf = (r: ReturnType<typeof buildRoom>): string => {
      const first = r.materials.list()[0];
      if (first === undefined || !('color' in first)) throw new Error('无材质');
      return String((first as { color: { getHexString: () => string } }).color.getHexString());
    };
    expect(colorOf(b)).toBe(colorOf(a));
    a.dispose();
    b.dispose();
  });

  it('外部传入的材质库不会被 dispose 掉（多次重建要复用）', () => {
    const { room, theme } = firstRoomOf('S');
    const first = buildRoom(room, theme);
    const shared = first.materials;
    const sizeBefore = shared.size;

    const second = buildRoom(room, theme, { materials: shared });
    second.dispose();
    expect(shared.size).toBe(sizeBefore); // 仍然可用

    first.dispose();
    expect(shared.size).toBe(0); // 拥有者释放后才清空
  });

  it('dispose 后 Group 被清空', () => {
    const { room, theme } = firstRoomOf('S');
    const built = buildRoom(room, theme);
    expect(built.root.children.length).toBeGreaterThan(0);
    built.dispose();
    expect(built.root.children).toHaveLength(0);
    expect(built.walkables).toHaveLength(0);
  });
});

describe('派生尺寸随结果一起返回', () => {
  it('size / outerPlan 与 schema 的派生值一致', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const { room, theme } = firstRoomOf(spec);
      const built = buildRoom(room, theme, { showStructures: false });
      expect(built.size).toEqual({ ...roomSize(room) });
      expect(built.outerPlan).toEqual(specOuterPlan(spec));
      built.dispose();
    }
  });

  it('buildRoomFromDocument 自己查房间与主题', () => {
    const { doc, room } = firstRoomOf('M');
    const built = buildRoomFromDocument(doc, room.id, { showStructures: false });
    expect(built.stats.portals).toBe(6);
    built.dispose();
  });
});
