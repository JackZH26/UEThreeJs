import { describe, expect, it } from 'vitest';
import type { Box3 } from 'three';
import type { BufferGeometry } from 'three';
import { RoomGraphDocument, SCHEMA_VERSION } from '@tjre/schema';
import type { Room, RoomGraphDocumentInput, Structure } from '@tjre/schema';
import { buildStructureGeometry, rampLength, stairMetrics } from '@tjre/scene';

const P = 4; // Float32 顶点精度，见 shell.test.ts

type StructureInput = NonNullable<
  NonNullable<RoomGraphDocumentInput['rooms']>[number]['structures']
>;

/** 造一个 20×16×10 的高房间（目标形态：仓库 / loft），塞进给定结构件 */
function makeRoom(structures: StructureInput): Room {
  const doc = RoomGraphDocument.parse({
    schemaVersion: SCHEMA_VERSION,
    meta: { name: 'T' },
    themes: [{ id: 'p', surfaces: { floor: 'f', ceiling: 'c', wall: 'w' } }],
    rooms: [{ id: 'r', size: { w: 20, d: 16, h: 10 }, theme: 'p', doorCount: 0, structures }],
    connections: [],
  } satisfies RoomGraphDocumentInput);
  const room = doc.rooms[0];
  if (room === undefined) throw new Error('fixture 构造失败');
  return room;
}

function buildOne(structures: StructureInput, id: string) {
  const room = makeRoom(structures);
  const target = room.structures.find((s) => s.id === id);
  if (target === undefined) throw new Error(`结构件 ${id} 不存在`);
  return { room, structure: target, built: buildStructureGeometry(room, target) };
}

function bbox(geometry: BufferGeometry): Box3 {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (box === null) throw new Error('无包围盒');
  return box;
}

const PLATFORM: Structure = {
  id: 'mezz',
  type: 'platform',
  rect: { x: 0, z: -5, w: 20, d: 6 },
  elevation: 4,
  thickness: 0.35,
  railing: [],
};

describe('楼梯比例由 Blondel 公式导出', () => {
  it('2R + G = 630mm，stepHeight 0.18 → 踏面 0.27', () => {
    const { tread } = stairMetrics(4, 0.18);
    expect(tread).toBeCloseTo(0.27, 6);
  });

  it('极端踢面高度会被夹到合理区间', () => {
    // 很矮的踢面 → 公式给出 >0.34，被夹到 0.34
    expect(stairMetrics(4, 0.05).tread).toBeCloseTo(0.34, 6);
    // 很高的踢面 → 公式给出 <0.22，被夹到 0.22
    expect(stairMetrics(4, 0.3).tread).toBeCloseTo(0.22, 6);
  });

  it('级数向上取整，保证一定爬到目标高度', () => {
    // 4m / 0.18 = 22.2 → 23 级
    expect(stairMetrics(4, 0.18).stepCount).toBe(23);
    expect(stairMetrics(4, 0.18).runLength).toBeCloseTo(23 * 0.27, 6);
  });

  it('斜坡按 1:8 坡度定长', () => {
    expect(rampLength(4)).toBeCloseTo(32, 6);
  });
});

describe('platform（夹层）', () => {
  it('上表面精确落在 elevation，向下长出 thickness', () => {
    const { built } = buildOne([PLATFORM], 'mezz');
    expect(built).not.toBeNull();
    if (built === null) return;
    const b = bbox(built.geometry);
    expect(b.max.y).toBeCloseTo(4, P);
    expect(b.min.y).toBeCloseTo(4 - 0.35, P);
    // 平面轮廓 = rect
    expect(b.min.x).toBeCloseTo(-10, P);
    expect(b.max.x).toBeCloseTo(10, P);
    expect(b.min.z).toBeCloseTo(-8, P);
    expect(b.max.z).toBeCloseTo(-2, P);
    expect(built.walkable).toBe(true);
  });

  it('加护栏后高度顶到 elevation + 1.1，且零件数增加', () => {
    const plain = buildOne([PLATFORM], 'mezz').built;
    const railed = buildOne([{ ...PLATFORM, railing: ['south'] }], 'mezz').built;
    expect(plain).not.toBeNull();
    expect(railed).not.toBeNull();
    if (plain === null || railed === null) return;
    expect(bbox(railed.geometry).max.y).toBeCloseTo(4 + 1.1, P);
    expect(railed.partCount).toBeGreaterThan(plain.partCount);
  });

  it('护栏落在指定的那条边上', () => {
    const { built } = buildOne([{ ...PLATFORM, railing: ['south'] }], 'mezz');
    if (built === null) throw new Error('无几何');
    // south 边在 z = rect.z + d/2 = -2。护栏以边线为**中心**放置，
    // 扶手截面 0.08 厚，所以会向外超出 0.04 —— 这是正确行为，不是误差。
    const b = bbox(built.geometry);
    expect(b.max.z).toBeGreaterThan(-2.01);
    expect(b.max.z).toBeLessThan(-1.9);
    // 若护栏错跑到 north 边，min.z 处也会有 1.1m 高的东西 —— 用切片检查
    const position = built.geometry.getAttribute('position');
    let highAtNorth = false;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > 4.5 && position.getZ(i) < -7.5) highAtNorth = true;
    }
    expect(highAtNorth).toBe(false);
  });
});

describe('stair（室内楼梯）', () => {
  const STAIR: Structure = {
    id: 'st',
    type: 'stair',
    from: { x: -7, z: 1 },
    fromElevation: 0,
    to: 'mezz',
    width: 1.4,
    facing: 'north',
    stepHeight: 0.18,
    railing: 'none',
  };

  it('从地面爬到目标平台高度', () => {
    const { built } = buildOne([PLATFORM, STAIR], 'st');
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.min.y).toBeCloseTo(0, P);
    expect(b.max.y).toBeCloseTo(4, P); // 顶级踏步顶面 = 平台高度
    expect(built.walkable).toBe(true);
  });

  it('沿 facing 方向延伸，长度 = 级数 × 踏面', () => {
    const { built } = buildOne([PLATFORM, STAIR], 'st');
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    const { runLength } = stairMetrics(4, 0.18);
    // facing = north（-Z），从 z=1 向 -Z 延伸
    expect(b.max.z).toBeCloseTo(1, P);
    expect(b.min.z).toBeCloseTo(1 - runLength, P);
    // 宽度沿 X
    expect(b.max.x - b.min.x).toBeCloseTo(1.4, P);
  });

  it('facing 沿 X 时宽度改到 Z 方向', () => {
    const { built } = buildOne([PLATFORM, { ...STAIR, facing: 'east' }], 'st');
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    const { runLength } = stairMetrics(4, 0.18);
    expect(b.max.x - b.min.x).toBeCloseTo(runLength, P);
    expect(b.max.z - b.min.z).toBeCloseTo(1.4, P);
  });

  it('每级踏步是实体（合并成单个几何体，零件数 = 级数）', () => {
    const { built } = buildOne([PLATFORM, STAIR], 'st');
    if (built === null) throw new Error('无几何');
    expect(built.partCount).toBe(stairMetrics(4, 0.18).stepCount);
  });

  it('落点不高于起点时不产生几何（已由 R013 报 error）', () => {
    const { built } = buildOne(
      [
        { ...PLATFORM, elevation: 2 },
        { ...STAIR, fromElevation: 3 },
      ],
      'st',
    );
    expect(built).toBeNull();
  });
});

describe('其它结构件', () => {
  it('catwalk 沿折线延展，上表面在 elevation', () => {
    const { built } = buildOne(
      [
        {
          id: 'cw',
          type: 'catwalk',
          path: [
            { x: 8, z: -2 },
            { x: 8, z: 4 },
            { x: 2, z: 4 },
          ],
          elevation: 4,
          width: 1.2,
          thickness: 0.15,
          railing: 'none',
        },
      ],
      'cw',
    );
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.max.y).toBeCloseTo(4, P);
    expect(b.min.y).toBeCloseTo(4 - 0.15, P);
    expect(built.walkable).toBe(true);
    // 两段折线 → 2 个甲板零件
    expect(built.partCount).toBe(2);
  });

  it('pillar 不指定 height 时顶到天花', () => {
    const { built } = buildOne([{ id: 'p1', type: 'pillar', at: { x: 0, z: 0 } }], 'p1');
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.min.y).toBeCloseTo(0, P);
    expect(b.max.y).toBeCloseTo(10, P); // room.size.h
    expect(built.walkable).toBe(false);
  });

  it('round 型 pillar 用圆柱', () => {
    const { built } = buildOne(
      [{ id: 'p1', type: 'pillar', at: { x: 0, z: 0 }, profile: 'round', size: 0.6 }],
      'p1',
    );
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.max.x - b.min.x).toBeCloseTo(0.6, 2);
  });

  it('ladder 从起点竖直到平台，不可行走', () => {
    const { built } = buildOne(
      [PLATFORM, { id: 'ld', type: 'ladder', at: { x: 5, z: 2 }, to: 'mezz', facing: 'west' }],
      'ld',
    );
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.min.y).toBeCloseTo(0, P);
    expect(b.max.y).toBeCloseTo(4, P);
    expect(built.walkable).toBe(false);
  });

  it('beam 跨两点，梁底在 elevation', () => {
    const { built } = buildOne(
      [
        {
          id: 'bm',
          type: 'beam',
          from: { x: -8, z: 0 },
          to: { x: 8, z: 0 },
          elevation: 8,
          width: 0.3,
          height: 0.4,
        },
      ],
      'bm',
    );
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.min.y).toBeCloseTo(8, P);
    expect(b.max.y).toBeCloseTo(8.4, P);
    expect(b.max.x - b.min.x).toBeCloseTo(16, P);
  });

  it('partition 是内部隔墙，不可行走', () => {
    const { built } = buildOne(
      [
        {
          id: 'pt',
          type: 'partition',
          from: { x: 0, z: -4 },
          to: { x: 0, z: 4 },
          height: 3,
          thickness: 0.15,
        },
      ],
      'pt',
    );
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.max.y).toBeCloseTo(3, P);
    expect(b.max.z - b.min.z).toBeCloseTo(8, P);
    expect(built.walkable).toBe(false);
  });

  it('ramp 按 1:8 坡度延伸并爬到平台高度', () => {
    const { built } = buildOne(
      [PLATFORM, { id: 'rp', type: 'ramp', from: { x: 0, z: 6 }, to: 'mezz', facing: 'north' }],
      'rp',
    );
    if (built === null) throw new Error('无几何');
    const b = bbox(built.geometry);
    expect(b.max.y).toBeCloseTo(4, 1);
    expect(built.walkable).toBe(true);
  });

  it('零长度的 beam / partition 不产生几何（不是崩溃）', () => {
    const { built } = buildOne(
      [
        {
          id: 'bm',
          type: 'beam',
          from: { x: 1, z: 1 },
          to: { x: 1, z: 1 },
          elevation: 5,
        },
      ],
      'bm',
    );
    expect(built).toBeNull();
  });
});
