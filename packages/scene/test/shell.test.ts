import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { GRID_UNIT, Room, WALL_SIDES, WALL_T, roomSize, specOuterPlan } from '@tjre/schema';
import type { RoomSpec, WallSide } from '@tjre/schema';
import { buildCeilingGeometry, buildFloorGeometry, buildWallGeometry } from '@tjre/scene';

/**
 * 几何测试跑在 Node 里 —— 构造 BufferGeometry 不需要 WebGL 上下文，
 * 所以墙面开洞是否正确可以**机器验证**，不必靠肉眼看 3D。
 */

/**
 * 断言精度只到 5 位小数（约 1e-5）。
 *
 * three.js 的 BufferAttribute 用 **Float32Array** 存顶点，只有约 7 位十进制
 * 有效数字：0.1 存进去再读出来是 0.10000000149011612。断言更高精度必然失败，
 * 且失败原因与几何正确性无关。米级建筑尺寸下 1e-5 远小于任何有意义的误差。
 *
 * 注意本文件的坐标最大到 30 —— 7 位有效数字下绝对误差约 3e-6，仍在 1e-5 内。
 */
const P = 5;

type RoomInput = Parameters<typeof Room.parse>[0];

function makeRoom(spec: RoomSpec = 'S', overrides: Record<string, unknown> = {}): Room {
  return Room.parse({ id: 'r', spec, theme: 'p', ...overrides } satisfies RoomInput as RoomInput);
}

function bbox(geometry: BufferGeometry): Box3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) throw new Error('无包围盒');
  return box;
}

/** 判断几何体是否存在一个顶点落在目标点附近 */
function hasVertexNear(geometry: BufferGeometry, target: Vector3, tolerance = 1e-4): boolean {
  const position = geometry.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i);
    if (v.distanceTo(target) <= tolerance) return true;
  }
  return false;
}

describe('墙面朝向与位置（S：净内空 28.5 × 28.5 × 12，半尺寸 ±14.25）', () => {
  const H = 14.25; // 半宽 = 半深
  const OUT = H + WALL_T; // = 15 = GRID_UNIT / 2

  const cases: { wall: WallSide; assert: (b: Box3) => void }[] = [
    {
      // north 朝 -Z：内表面 z = -14.25，向外长完整墙厚到 z = -15
      wall: 'north',
      assert: (b) => {
        expect(b.min.z).toBeCloseTo(-OUT, P);
        expect(b.max.z).toBeCloseTo(-H, P);
        expect(b.min.x).toBeCloseTo(-H, P);
        expect(b.max.x).toBeCloseTo(H, P);
      },
    },
    {
      wall: 'south',
      assert: (b) => {
        expect(b.min.z).toBeCloseTo(H, P);
        expect(b.max.z).toBeCloseTo(OUT, P);
      },
    },
    {
      wall: 'east',
      assert: (b) => {
        expect(b.min.x).toBeCloseTo(H, P);
        expect(b.max.x).toBeCloseTo(OUT, P);
        expect(b.min.z).toBeCloseTo(-H, P);
        expect(b.max.z).toBeCloseTo(H, P);
      },
    },
    {
      wall: 'west',
      assert: (b) => {
        expect(b.min.x).toBeCloseTo(-OUT, P);
        expect(b.max.x).toBeCloseTo(-H, P);
      },
    },
  ];

  for (const { wall, assert } of cases) {
    it(`${wall} 墙贴在内表面上，向外长出完整墙厚 ${WALL_T}m`, () => {
      assert(bbox(buildWallGeometry(makeRoom(), wall).geometry));
    });
  }

  it('所有墙的高度都是 [0, 层高]', () => {
    for (const wall of WALL_SIDES) {
      const b = bbox(buildWallGeometry(makeRoom(), wall).geometry);
      expect(b.min.y).toBeCloseTo(0, P);
      expect(b.max.y).toBeCloseTo(12, P);
    }
  });
});

/**
 * ⭐ 可互换性的地基。
 *
 * 房间外壳的水平 AABB 必须**恰好等于占格尺寸**（30 / 60m 的整数倍）。
 * 只要这条成立，任意两个房间在格位网格里就能无缝对接、传送门自动对齐。
 * 墙厚、净内空、格位三者的关系一旦被改坏，这条会立刻失败。
 */
describe('外廓 AABB = 占格尺寸', () => {
  for (const spec of ['S', 'M', 'L'] as const) {
    it(`${spec}：外壳水平范围正好是 ${specOuterPlan(spec).w} × ${specOuterPlan(spec).d}m`, () => {
      const room = makeRoom(spec);
      const union = new Box3();
      for (const wall of WALL_SIDES) union.union(bbox(buildWallGeometry(room, wall).geometry));
      union.union(bbox(buildFloorGeometry(room)));
      union.union(bbox(buildCeilingGeometry(room)));

      const outer = specOuterPlan(spec);
      expect(union.max.x - union.min.x).toBeCloseTo(outer.w, P);
      expect(union.max.z - union.min.z).toBeCloseTo(outer.d, P);
      // 居中：房间原点在外廓中心
      expect(union.min.x).toBeCloseTo(-outer.w / 2, P);
      expect(union.min.z).toBeCloseTo(-outer.d / 2, P);
      // 竖向：地板底 -WALL_T，天花顶 层高 + WALL_T
      expect(union.min.y).toBeCloseTo(-WALL_T, P);
      expect(union.max.y).toBeCloseTo(roomSize(room).h + WALL_T, P);
      // 外廓必须是格位整数倍
      expect((union.max.x - union.min.x) % GRID_UNIT).toBeCloseTo(0, P);
    });
  }
});

describe('洞口', () => {
  it('每面墙都自带派生传送门的洞 —— 没有"零洞口"的墙', () => {
    // S：四面各 1；M：宽墙 2 / 窄墙 1；L：每面 2
    const expected: Record<RoomSpec, Record<WallSide, number>> = {
      S: { north: 1, south: 1, east: 1, west: 1 },
      M: { north: 2, south: 2, east: 1, west: 1 },
      L: { north: 2, south: 2, east: 2, west: 2 },
    };
    for (const spec of ['S', 'M', 'L'] as const) {
      const room = makeRoom(spec);
      for (const wall of WALL_SIDES) {
        expect(buildWallGeometry(room, wall).openingCount, `${spec}/${wall}`).toBe(
          expected[spec][wall],
        );
      }
    }
  });

  it('手写开口叠加在派生传送门之上', () => {
    const room = makeRoom('S', {
      openings: [
        {
          id: 'w1',
          wall: 'north',
          type: 'window',
          offset: 8,
          size: { w: 2, h: 1.5 },
          elevation: 4,
        },
        {
          id: 'w2',
          wall: 'north',
          type: 'window',
          offset: -8,
          size: { w: 2, h: 1.5 },
          elevation: 4,
        },
        {
          id: 'w3',
          wall: 'south',
          type: 'window',
          offset: 0,
          size: { w: 2, h: 1.5 },
          elevation: 4,
        },
      ],
    });
    expect(buildWallGeometry(room, 'north').openingCount).toBe(3); // 1 传送门 + 2 窗
    expect(buildWallGeometry(room, 'south').openingCount).toBe(2);
    expect(buildWallGeometry(room, 'east').openingCount).toBe(1);
  });

  it('派生传送门的洞口位置与尺寸正确（S 北墙：居中，3.0 × 3.2）', () => {
    const { geometry } = buildWallGeometry(makeRoom(), 'north');
    // 内表面 z = -14.25；洞口 x ∈ [-1.5, 1.5]，y ∈ [0, 3.2]
    expect(hasVertexNear(geometry, new Vector3(-1.5, 0, -14.25))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(1.5, 3.2, -14.25))).toBe(true);
  });

  it('M 宽墙上的两个传送门分别在 ±15', () => {
    const { geometry } = buildWallGeometry(makeRoom('M'), 'north');
    // M 净深 28.5 → 内表面 z = -14.25
    for (const cx of [-15, 15]) {
      expect(hasVertexNear(geometry, new Vector3(cx - 1.5, 0, -14.25)), `左沿 @${cx}`).toBe(true);
      expect(hasVertexNear(geometry, new Vector3(cx + 1.5, 3.2, -14.25)), `右上 @${cx}`).toBe(true);
    }
  });

  /**
   * 关键回归测试：`offset` 的方向不能被镜像。
   * north 墙的 offset 沿 +X，所以 offset=+8 的洞口顶点必须出现在 x=+8 附近，
   * 而不是 x=-8。这是"墙面几何直接生成在房间局部坐标系"要防的主要 bug。
   */
  it('north 墙洞口的 offset 沿 +X，不被镜像', () => {
    const room = makeRoom('S', {
      openings: [
        { id: 'w', wall: 'north', type: 'window', offset: 8, size: { w: 2, h: 2 }, elevation: 3 },
      ],
    });
    const { geometry } = buildWallGeometry(room, 'north');
    expect(hasVertexNear(geometry, new Vector3(7, 3, -14.25))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(9, 5, -14.25))).toBe(true);
    // 镜像位置不应存在洞口顶点
    expect(hasVertexNear(geometry, new Vector3(-7, 3, -14.25))).toBe(false);
    expect(hasVertexNear(geometry, new Vector3(-9, 5, -14.25))).toBe(false);
  });

  it('east 墙洞口的 offset 沿 +Z，不被镜像', () => {
    const room = makeRoom('S', {
      openings: [
        { id: 'w', wall: 'east', type: 'window', offset: 6, size: { w: 2, h: 2 }, elevation: 3 },
      ],
    });
    const { geometry } = buildWallGeometry(room, 'east');
    expect(hasVertexNear(geometry, new Vector3(14.25, 3, 5))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(14.25, 5, 7))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(14.25, 3, -5))).toBe(false);
  });

  it('夹层高度的洞口 elevation 生效', () => {
    const room = makeRoom('L', {
      openings: [
        {
          id: 'd',
          wall: 'north',
          type: 'window',
          offset: 0,
          size: { w: 1.6, h: 2.4 },
          elevation: 14,
        },
      ],
    });
    // L 净宽/深 58.5 → 内表面 z = -29.25
    const { geometry } = buildWallGeometry(room, 'north');
    expect(hasVertexNear(geometry, new Vector3(-0.8, 14, -29.25))).toBe(true);
    expect(hasVertexNear(geometry, new Vector3(0.8, 16.4, -29.25))).toBe(true);
    // 地面高度处不应有这个洞口的顶点（但传送门在 x=±15，不在 x=±0.8）
    expect(hasVertexNear(geometry, new Vector3(-0.8, 0, -29.25))).toBe(false);
  });
});

describe('地板与天花', () => {
  it('地板顶面精确落在 y = 0，向下长出完整墙厚', () => {
    const b = bbox(buildFloorGeometry(makeRoom()));
    expect(b.max.y).toBeCloseTo(0, P);
    expect(b.min.y).toBeCloseTo(-WALL_T, P);
    // 地板只铺净内空范围（墙自己占外圈）
    expect(b.min.x).toBeCloseTo(-14.25, P);
    expect(b.max.x).toBeCloseTo(14.25, P);
    expect(b.min.z).toBeCloseTo(-14.25, P);
    expect(b.max.z).toBeCloseTo(14.25, P);
  });

  it('天花底面精确落在层高处', () => {
    const b = bbox(buildCeilingGeometry(makeRoom()));
    expect(b.min.y).toBeCloseTo(12, P);
    expect(b.max.y).toBeCloseTo(12 + WALL_T, P);
  });

  it('层高随规格变化（S 12 / M 18 / L 24）', () => {
    for (const [spec, h] of [
      ['S', 12],
      ['M', 18],
      ['L', 24],
    ] as const) {
      expect(bbox(buildCeilingGeometry(makeRoom(spec))).min.y).toBeCloseTo(h, P);
    }
  });

  it('地板顶面与墙底对齐 —— 不留缝', () => {
    const floor = bbox(buildFloorGeometry(makeRoom()));
    const wall = bbox(buildWallGeometry(makeRoom(), 'north').geometry);
    expect(floor.max.y).toBeCloseTo(wall.min.y, P);
  });
});
