import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { BufferGeometry, Box3 } from 'three';
import { RoomGraphDocument, SCHEMA_VERSION } from '@tjre/schema';
import type { Room, RoomGraphDocumentInput, WallSide } from '@tjre/schema';
import { buildCeilingGeometry, buildFloorGeometry, buildWallGeometry } from '@tjre/scene';

/**
 * 几何测试跑在 Node 里 —— 构造 BufferGeometry 不需要 WebGL 上下文，
 * 所以墙面开洞是否正确可以**机器验证**，不必靠肉眼看 3D。
 */

const T = 0.2; // wallThickness

/**
 * 断言精度只到 5 位小数（约 1e-5）。
 *
 * three.js 的 BufferAttribute 用 **Float32Array** 存顶点，只有约 7 位十进制
 * 有效数字：0.1 存进去再读出来是 0.10000000149011612。断言更高精度必然失败，
 * 且失败原因与几何正确性无关。米级建筑尺寸下 1e-5 远小于任何有意义的误差。
 */
const P = 5;

/** schema 里 rooms 带 `.default([])`，输入类型上是可选的，需先 NonNullable 再取元素 */
type RoomInput = NonNullable<RoomGraphDocumentInput['rooms']>[number];

function makeRoom(overrides: Partial<RoomInput> = {}): Room {
  const input: RoomGraphDocumentInput = {
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'T' },
    themes: [{ id: 'p', surfaces: { floor: 'f', ceiling: 'c', wall: 'w' } }],
    rooms: [
      {
        id: 'r',
        size: { w: 8, d: 6, h: 4 },
        theme: 'p',
        doorCount: 0,
        ...overrides,
      },
    ],
    connections: [],
  };
  const doc = RoomGraphDocument.parse(input);
  const room = doc.rooms[0];
  if (room === undefined) throw new Error('fixture 构造失败');
  return room;
}

function bbox(geometry: BufferGeometry): Box3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) throw new Error('无包围盒');
  return box;
}

/** 判断某个点是否落在几何体的某个三角形所覆盖的平面区域内（粗判：用顶点集合） */
function hasVertexNear(geometry: BufferGeometry, target: Vector3, tolerance = 1e-4): boolean {
  const position = geometry.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    if (v.distanceTo(target) <= tolerance) return true;
  }
  return false;
}

describe('墙面朝向与位置', () => {
  const cases: { wall: WallSide; expect: (b: Box3) => void }[] = [
    {
      // north 朝 -Z：内表面在 z = -3，向外长到 z = -3.1
      wall: 'north',
      expect: (b) => {
        expect(b.min.z).toBeCloseTo(-3 - T / 2, P);
        expect(b.max.z).toBeCloseTo(-3, P);
        expect(b.min.x).toBeCloseTo(-4, P); // 沿 X 跨 size.w = 8
        expect(b.max.x).toBeCloseTo(4, P);
      },
    },
    {
      wall: 'south',
      expect: (b) => {
        expect(b.min.z).toBeCloseTo(3, P);
        expect(b.max.z).toBeCloseTo(3 + T / 2, P);
      },
    },
    {
      // east 朝 +X：内表面 x = 4，沿 Z 跨 size.d = 6
      wall: 'east',
      expect: (b) => {
        expect(b.min.x).toBeCloseTo(4, P);
        expect(b.max.x).toBeCloseTo(4 + T / 2, P);
        expect(b.min.z).toBeCloseTo(-3, P);
        expect(b.max.z).toBeCloseTo(3, P);
      },
    },
    {
      wall: 'west',
      expect: (b) => {
        expect(b.min.x).toBeCloseTo(-4 - T / 2, P);
        expect(b.max.x).toBeCloseTo(-4, P);
      },
    },
  ];

  for (const { wall, expect: assert } of cases) {
    it(`${wall} 墙位于正确的内表面并向外长出半个墙厚`, () => {
      const { geometry } = buildWallGeometry(makeRoom(), wall, T);
      assert(bbox(geometry));
    });
  }

  it('所有墙的高度都是 [0, h]', () => {
    for (const wall of ['north', 'south', 'east', 'west'] as const) {
      const b = bbox(buildWallGeometry(makeRoom(), wall, T).geometry);
      expect(b.min.y).toBeCloseTo(0, P);
      expect(b.max.y).toBeCloseTo(4, P);
    }
  });
});

describe('洞口', () => {
  it('无洞口时不产生 hole', () => {
    const { openingCount } = buildWallGeometry(makeRoom(), 'north', T);
    expect(openingCount).toBe(0);
  });

  it('洞口数量与该墙上的 openings 一致，且只算本墙的', () => {
    const room = makeRoom({
      doorCount: 2,
      openings: [
        { id: 'a', wall: 'north', type: 'door', offset: 0, size: { w: 1.5, h: 2.4 } },
        { id: 'b', wall: 'north', type: 'arch', offset: 3, size: { w: 1, h: 2.2 } },
        { id: 'c', wall: 'south', type: 'window', offset: 0, size: { w: 2, h: 1 }, elevation: 2 },
      ],
    });
    expect(buildWallGeometry(room, 'north', T).openingCount).toBe(2);
    expect(buildWallGeometry(room, 'south', T).openingCount).toBe(1);
    expect(buildWallGeometry(room, 'east', T).openingCount).toBe(0);
  });

  /**
   * 关键回归测试：`offset` 的方向不能被镜像。
   * north 墙的 offset 沿 +X，所以 offset=+3 的洞口顶点必须出现在 x=+3 附近，
   * 而不是 x=-3。这是"墙面几何直接生成在房间局部坐标系"要防的主要 bug。
   */
  it('north 墙洞口的 offset 沿 +X，不被镜像', () => {
    const room = makeRoom({
      doorCount: 1,
      openings: [{ id: 'd', wall: 'north', type: 'door', offset: 3, size: { w: 1, h: 2 } }],
    });
    const { geometry } = buildWallGeometry(room, 'north', T);
    // 洞口左右边界应在 x = 2.5 与 3.5，高度 0..2，内表面 z = -3
    expect(hasVertexNear(geometry, new Vector3(2.5, 0, -3))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(3.5, 2, -3))).toBe(true);
    // 镜像位置不应存在洞口顶点
    expect(hasVertexNear(geometry, new Vector3(-2.5, 0, -3))).toBe(false);
    expect(hasVertexNear(geometry, new Vector3(-3.5, 2, -3))).toBe(false);
  });

  it('east 墙洞口的 offset 沿 +Z，不被镜像', () => {
    const room = makeRoom({
      doorCount: 1,
      openings: [{ id: 'd', wall: 'east', type: 'door', offset: 2, size: { w: 1, h: 2 } }],
    });
    const { geometry } = buildWallGeometry(room, 'east', T);
    expect(hasVertexNear(geometry, new Vector3(4, 0, 1.5))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(4, 2, 2.5))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(4, 0, -1.5))).toBe(false);
  });

  it('夹层高度的洞口 elevation 生效', () => {
    const room = makeRoom({
      size: { w: 8, d: 6, h: 10 },
      doorCount: 1,
      openings: [
        { id: 'd', wall: 'north', type: 'door', offset: 0, size: { w: 1.6, h: 2.4 }, elevation: 4 },
      ],
    });
    const { geometry } = buildWallGeometry(room, 'north', T);
    // 洞口底沿 y=4，顶沿 y=6.4
    expect(hasVertexNear(geometry, new Vector3(-0.8, 4, -3))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(0.8, 6.4, -3))).toBe(true);
    // 地面高度处不应有洞口顶点
    expect(hasVertexNear(geometry, new Vector3(-0.8, 0, -3))).toBe(false);
  });

  it('开洞后三角形数量比实心墙多（Earcut 确实生效）', () => {
    const solid = buildWallGeometry(makeRoom(), 'north', T).geometry;
    const holed = buildWallGeometry(
      makeRoom({
        doorCount: 1,
        openings: [{ id: 'd', wall: 'north', type: 'door', offset: 0, size: { w: 1.5, h: 2.4 } }],
      }),
      'north',
      T,
    ).geometry;
    const count = (g: BufferGeometry): number => g.getAttribute('position').count;
    expect(count(holed)).toBeGreaterThan(count(solid));
  });
});

describe('地板与天花', () => {
  it('地板顶面精确落在 y = 0，向下长出半个墙厚', () => {
    const b = bbox(buildFloorGeometry(makeRoom(), T));
    expect(b.max.y).toBeCloseTo(0, P);
    expect(b.min.y).toBeCloseTo(-T / 2, P);
    expect(b.min.x).toBeCloseTo(-4, P);
    expect(b.max.x).toBeCloseTo(4, P);
    expect(b.min.z).toBeCloseTo(-3, P);
    expect(b.max.z).toBeCloseTo(3, P);
  });

  it('天花底面精确落在 y = room.size.h', () => {
    const b = bbox(buildCeilingGeometry(makeRoom(), T));
    expect(b.min.y).toBeCloseTo(4, P);
    expect(b.max.y).toBeCloseTo(4 + T / 2, P);
  });

  it('地板顶面与墙底对齐 —— 不留缝', () => {
    const floor = bbox(buildFloorGeometry(makeRoom(), T));
    const wall = bbox(buildWallGeometry(makeRoom(), 'north', T).geometry);
    expect(floor.max.y).toBeCloseTo(wall.min.y, P);
  });
});
