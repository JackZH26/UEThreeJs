import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Box3 } from 'three';
import { parseDocument } from '@tjre/core';
import { RoomGraphDocument, SCHEMA_VERSION } from '@tjre/schema';
import type { Opening, Room, RoomGraphDocumentInput, WallSide } from '@tjre/schema';
import {
  PORTAL_FRAME_MATERIAL,
  PORTAL_SURFACE_MATERIAL,
  buildPortalGeometry,
  buildScene,
} from '@tjre/scene';

const P = 4; // Float32 顶点精度

function makeRoom(
  openings: NonNullable<RoomGraphDocumentInput['rooms']>[number]['openings'],
): Room {
  const doc = RoomGraphDocument.parse({
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'T' },
    themes: [{ id: 'p', surfaces: { floor: 'f', ceiling: 'c', wall: 'w' } }],
    rooms: [
      {
        id: 'r',
        size: { w: 16, d: 12, h: 8 },
        theme: 'p',
        doorCount: openings?.length ?? 0,
        openings,
      },
    ],
    connections: [],
  } satisfies RoomGraphDocumentInput);
  const room = doc.rooms[0];
  if (room === undefined) throw new Error('fixture 构造失败');
  return room;
}

function portalOn(wall: WallSide, offset = 0, elevation = 0): { room: Room; opening: Opening } {
  const room = makeRoom([
    { id: 'p1', wall, type: 'portal', offset, size: { w: 2.4, h: 3 }, elevation },
  ]);
  const opening = room.openings[0];
  if (opening === undefined) throw new Error('无开口');
  return { room, opening };
}

function bbox(g: { computeBoundingBox: () => void; boundingBox: Box3 | null }): Box3 {
  g.computeBoundingBox();
  if (g.boundingBox === null) throw new Error('无包围盒');
  return g.boundingBox;
}

describe('传送门几何（固定样式）', () => {
  it('门面尺寸等于洞口尺寸', () => {
    const { room, opening } = portalOn('north');
    const b = bbox(buildPortalGeometry(room, opening).surface);
    expect(b.max.x - b.min.x).toBeCloseTo(2.4, P);
    expect(b.max.y - b.min.y).toBeCloseTo(3, P);
  });

  const cases: { wall: WallSide; assert: (b: Box3) => void }[] = [
    // 房间 16×12：north/south 墙在 z = ∓6，east/west 墙在 x = ±8
    { wall: 'north', assert: (b) => expect(b.min.z).toBeGreaterThan(-6) },
    { wall: 'south', assert: (b) => expect(b.max.z).toBeLessThan(6) },
    { wall: 'east', assert: (b) => expect(b.max.x).toBeLessThan(8) },
    { wall: 'west', assert: (b) => expect(b.min.x).toBeGreaterThan(-8) },
  ];
  for (const { wall, assert } of cases) {
    it(`${wall} 墙上的门面向房间内侧偏移（避免与墙 z-fighting）`, () => {
      const { room, opening } = portalOn(wall);
      assert(bbox(buildPortalGeometry(room, opening).surface));
    });
  }

  it('offset 沿正确方向，不被镜像', () => {
    const { room, opening } = portalOn('north', 3);
    const b = bbox(buildPortalGeometry(room, opening).surface);
    // north 墙 offset 沿 +X → 门面中心应在 x=+3
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(3, P);
  });

  it('east 墙 offset 沿 +Z', () => {
    const { room, opening } = portalOn('east', 2);
    const b = bbox(buildPortalGeometry(room, opening).surface);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(2, P);
  });

  it('elevation 生效', () => {
    const { room, opening } = portalOn('north', 0, 4);
    const b = bbox(buildPortalGeometry(room, opening).surface);
    expect(b.min.y).toBeCloseTo(4, P);
    expect(b.max.y).toBeCloseTo(7, P);
  });

  it('门框包住门面（四边都比洞口大一圈）', () => {
    const { room, opening } = portalOn('north');
    const built = buildPortalGeometry(room, opening);
    const surface = bbox(built.surface);
    const frame = bbox(built.frame);
    expect(frame.min.x).toBeLessThan(surface.min.x);
    expect(frame.max.x).toBeGreaterThan(surface.max.x);
    expect(frame.min.y).toBeLessThan(surface.min.y);
    expect(frame.max.y).toBeGreaterThan(surface.max.y);
  });
});

describe('传送门在场景里', () => {
  it('每个传送门产出 2 个 mesh（门面 + 门框），并计入 stats', () => {
    const text = readFileSync(
      resolve(import.meta.dirname, '../../../examples/etc-piston-floor.roomgraph.yaml'),
      'utf8',
    );
    const loaded = parseDocument(text);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors, null, 2));

    const built = buildScene(loaded.doc, { isolateRoom: 'piston_floor' });
    expect(built.stats.portals).toBe(4); // 四面墙各一个
    built.dispose();
  });

  it('传送门用固定材质，不走哈希占位色', () => {
    const room = makeRoom([{ id: 'p1', wall: 'north', type: 'portal', size: { w: 2.4, h: 3 } }]);
    const doc = RoomGraphDocument.parse({
      schemaVersion: SCHEMA_VERSION,
      meta: { name: 'T' },
      themes: [{ id: 'p', surfaces: { floor: 'f', ceiling: 'c', wall: 'w' } }],
      rooms: [room],
      connections: [],
    } satisfies RoomGraphDocumentInput);

    const built = buildScene(doc, { isolateRoom: 'r' });
    const names = built.materials.list().map((m) => m.name);
    expect(names).toContain(PORTAL_SURFACE_MATERIAL);
    expect(names).toContain(PORTAL_FRAME_MATERIAL);
    // 门面必须自发光 —— 固定样式的核心，保证在灰调场景里一眼可辨
    const surface = built.materials.list().find((m) => m.name === PORTAL_SURFACE_MATERIAL);
    expect(surface).toBeDefined();
    built.dispose();
  });
});

describe('单房间隔离模式', () => {
  function multiRoomDoc() {
    const text = readFileSync(
      resolve(import.meta.dirname, '../../../examples/loft-warehouse.roomgraph.yaml'),
      'utf8',
    );
    const loaded = parseDocument(text);
    if (!loaded.ok) throw new Error('load fail');
    return loaded.doc;
  }

  it('只构建指定的那一个房间', () => {
    const doc = multiRoomDoc();
    expect(doc.rooms.length).toBe(3);
    const built = buildScene(doc, { isolateRoom: 'hall' });
    expect(built.stats.rooms).toBe(1);
    expect([...built.roomGroups.keys()]).toEqual(['hall']);
    built.dispose();
  });

  it('隔离的房间固定在原点、旋转 0（不走求解器）', () => {
    const doc = multiRoomDoc();
    // 非隔离模式下 hall 会被求解到 (0, -12.25)
    const solved = buildScene(doc);
    expect(solved.roomGroups.get('hall')?.position.z).toBeCloseTo(-12.25, 2);
    solved.dispose();

    // 隔离模式必须在原点
    const isolated = buildScene(doc, { isolateRoom: 'hall' });
    const group = isolated.roomGroups.get('hall');
    expect(group?.position.x).toBe(0);
    expect(group?.position.y).toBe(0);
    expect(group?.position.z).toBe(0);
    expect(group?.rotation.y).toBe(0);
    isolated.dispose();
  });

  it('隔离一个本来会被求解器旋转的房间也归零', () => {
    const doc = multiRoomDoc();
    const built = buildScene(doc, { isolateRoom: 'catwalk_room' });
    expect(built.roomGroups.get('catwalk_room')?.position.x).toBe(0);
    expect(built.stats.rooms).toBe(1);
    built.dispose();
  });
});
