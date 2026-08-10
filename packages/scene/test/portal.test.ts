import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Box3 } from 'three';
import { parseDocument } from '@tjre/core';
import { PORTAL_SIZE, Room, roomPortals, roomSize, specPortalCount } from '@tjre/schema';
import type { Opening, Room as RoomType, RoomSpec, WallSide } from '@tjre/schema';
import {
  PORTAL_FRAME_MATERIAL,
  PORTAL_SURFACE_MATERIAL,
  buildPortalGeometry,
  buildRoom,
  buildRoomFromDocument,
} from '@tjre/scene';

const P = 4; // Float32 顶点精度

const THEME = { id: 'p', surfaces: { floor: 'f', ceiling: 'c', wall: 'w' } } as const;

function makeRoom(spec: RoomSpec = 'S'): RoomType {
  return Room.parse({ id: 'r', spec, theme: 'p' });
}

/** 取某面墙上的第 n 个派生传送门 */
function portalOn(spec: RoomSpec, wall: WallSide, index = 0): { room: RoomType; opening: Opening } {
  const room = makeRoom(spec);
  const opening = roomPortals(room).filter((p) => p.wall === wall)[index];
  if (opening === undefined) throw new Error(`${spec}/${wall} 上没有第 ${index} 个传送门`);
  return { room, opening };
}

function bbox(g: { computeBoundingBox: () => void; boundingBox: Box3 | null }): Box3 {
  g.computeBoundingBox();
  if (g.boundingBox === null) throw new Error('无包围盒');
  return g.boundingBox;
}

describe('传送门几何（固定样式）', () => {
  it('门面尺寸等于洞口尺寸（恒 3.0 × 3.2）', () => {
    const { room, opening } = portalOn('S', 'north');
    const b = bbox(buildPortalGeometry(room, opening).surface);
    expect(b.max.x - b.min.x).toBeCloseTo(PORTAL_SIZE.w, P);
    expect(b.max.y - b.min.y).toBeCloseTo(PORTAL_SIZE.h, P);
  });

  it('门面贴地（elevation = 0）', () => {
    const { room, opening } = portalOn('S', 'north');
    const b = bbox(buildPortalGeometry(room, opening).surface);
    expect(b.min.y).toBeCloseTo(0, P);
    expect(b.max.y).toBeCloseTo(PORTAL_SIZE.h, P);
  });

  // S 净内空 28.5 → north/south 内表面 z = ∓14.25，east/west 内表面 x = ±14.25
  const H = 14.25;
  const cases: { wall: WallSide; assert: (b: Box3) => void }[] = [
    { wall: 'north', assert: (b) => expect(b.min.z).toBeGreaterThan(-H) },
    { wall: 'south', assert: (b) => expect(b.max.z).toBeLessThan(H) },
    { wall: 'east', assert: (b) => expect(b.max.x).toBeLessThan(H) },
    { wall: 'west', assert: (b) => expect(b.min.x).toBeGreaterThan(-H) },
  ];
  for (const { wall, assert } of cases) {
    it(`${wall} 墙上的门面向房间内侧偏移（避免与墙 z-fighting）`, () => {
      const { room, opening } = portalOn('S', wall);
      assert(bbox(buildPortalGeometry(room, opening).surface));
    });
  }

  it('offset 沿正确方向，不被镜像（M 宽墙的第 2 个门在 x = +15）', () => {
    const { room, opening } = portalOn('M', 'north', 1);
    expect(opening.offset).toBe(15);
    const b = bbox(buildPortalGeometry(room, opening).surface);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(15, P);
  });

  it('east 墙 offset 沿 +Z（L 东墙的第 2 个门在 z = +15）', () => {
    const { room, opening } = portalOn('L', 'east', 1);
    expect(opening.offset).toBe(15);
    const b = bbox(buildPortalGeometry(room, opening).surface);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(15, P);
  });

  it('门框包住门面（四边都比洞口大一圈）', () => {
    const { room, opening } = portalOn('S', 'north');
    const built = buildPortalGeometry(room, opening);
    const surface = bbox(built.surface);
    const frame = bbox(built.frame);
    expect(frame.min.x).toBeLessThan(surface.min.x);
    expect(frame.max.x).toBeGreaterThan(surface.max.x);
    expect(frame.min.y).toBeLessThan(surface.min.y);
    expect(frame.max.y).toBeGreaterThan(surface.max.y);
  });

  it('所有规格所有传送门都完全落在房间内部（不穿墙、不顶天花）', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const room = makeRoom(spec);
      const size = roomSize(room);
      for (const opening of roomPortals(room)) {
        const b = bbox(buildPortalGeometry(room, opening).frame);
        expect(Math.abs(b.min.x), `${spec}/${opening.id}`).toBeLessThanOrEqual(size.w / 2 + 1e-3);
        expect(Math.abs(b.max.x), `${spec}/${opening.id}`).toBeLessThanOrEqual(size.w / 2 + 1e-3);
        expect(Math.abs(b.min.z), `${spec}/${opening.id}`).toBeLessThanOrEqual(size.d / 2 + 1e-3);
        expect(b.max.y, `${spec}/${opening.id}`).toBeLessThan(size.h);
      }
    }
  });
});

describe('传送门在场景里', () => {
  it('每个传送门产出 2 个 mesh（门面 + 门框），数量随规格派生', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const built = buildRoom(makeRoom(spec), THEME);
      expect(built.stats.portals, `spec=${spec}`).toBe(specPortalCount(spec));
      // 4 面墙 + 地板 + 每个传送门 2 个
      expect(built.stats.meshes).toBe(4 + 1 + specPortalCount(spec) * 2);
      built.dispose();
    }
  });

  it('传送门用固定材质，不走哈希占位色', () => {
    const built = buildRoom(makeRoom(), THEME);
    const names = built.materials.list().map((m) => m.name);
    expect(names).toContain(PORTAL_SURFACE_MATERIAL);
    expect(names).toContain(PORTAL_FRAME_MATERIAL);
    built.dispose();
  });

  it('示例关卡里的传送门数量与规格一致', () => {
    const text = readFileSync(
      resolve(import.meta.dirname, '../../../examples/etc-s-piston-floor.roomgraph.yaml'),
      'utf8',
    );
    const loaded = parseDocument(text);
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors, null, 2));

    const built = buildRoomFromDocument(loaded.doc, 'piston_floor');
    expect(built.stats.portals).toBe(4); // S：四面墙各一个
    built.dispose();
  });
});

describe('单房间构建', () => {
  it('房间固定在原点、旋转 0', () => {
    const built = buildRoom(makeRoom(), THEME);
    expect(built.root.position.x).toBe(0);
    expect(built.root.position.y).toBe(0);
    expect(built.root.position.z).toBe(0);
    expect(built.root.rotation.y).toBe(0);
    built.dispose();
  });

  it('buildRoomFromDocument 找不到房间时抛错并列出可选项', () => {
    const doc = parseDocument(`
schemaVersion: 0.2.0
meta: { name: T }
themes:
  - id: p
    surfaces: { floor: f, ceiling: c, wall: w }
rooms:
  - { id: only_one, spec: S, theme: p }
`);
    if (!doc.ok) throw new Error('fixture 解析失败');
    expect(() => buildRoomFromDocument(doc.doc, 'ghost')).toThrow(/only_one/);
  });
});
