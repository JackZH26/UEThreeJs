import { describe, expect, it } from 'vitest';
import type { Box3 } from 'three';
import type { BufferGeometry } from 'three';
import { Room, roomSize } from '@tjre/schema';
import type { Room as RoomType, RoomGraphDocumentInput, Structure } from '@tjre/schema';
import { buildStructureGeometry, rampLength, stairMetrics } from '@tjre/scene';

const P = 4; // Float32 顶点精度，见 shell.test.ts

type StructureInput = NonNullable<
  NonNullable<RoomGraphDocumentInput['rooms']>[number]['structures']
>;

/**
 * 用 S 规格房间（净内空 28.5 × 28.5，层高 12）承载测试结构件。
 * 结构件坐标都在 ±10 以内，任何规格都装得下 —— 这些测试只关心结构件
 * 自身的几何，唯一与房间相关的量是"pillar 不给 height 时顶到天花"。
 */
const ROOM_HEIGHT = roomSize(Room.parse({ id: 'r', spec: 'S', theme: 'p' })).h;

function makeRoom(structures: StructureInput): RoomType {
  return Room.parse({ id: 'r', spec: 'S', theme: 'p', structures });
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

/**
 * 楼梯接进平台的位置，平台栏杆必须断开 —— 否则栏杆横在楼梯口上，人上不去。
 * 这是真实踩到的问题（S 示例的角落平台）。开口是**派生**的：
 * 作者写了 `stair.to` 和 `facing`，进入边与开口宽度就唯一确定了。
 */
describe('护栏在楼梯接入处断开', () => {
  /** 平台 z ∈ [-8, -2]，x ∈ [-10, 10]，标高 4；楼梯朝北上行、从南边接入 */
  const DECK: Structure = {
    id: 'mezz',
    type: 'platform',
    rect: { x: 0, z: -5, w: 20, d: 6 },
    elevation: 4,
    thickness: 0.3,
    railing: ['south'],
  };
  /** rise 4 / stepHeight 0.18 → 23 级 × 0.27 = 进深 6.21 → 顶端 z = -5.21 */
  const STAIR: Structure = {
    id: 'st',
    type: 'stair',
    from: { x: 0, z: 1 },
    fromElevation: 0,
    to: 'mezz',
    facing: 'north',
    width: 1.6,
    stepHeight: 0.18,
    railing: 'none',
  };

  /** 取 south 边（z ≈ -2）上、扶手高度处的顶点 x 范围 */
  function handrailXSpanAtGap(structures: Structure[]): number[] {
    const { built } = buildOne(structures, 'mezz');
    if (built === null) throw new Error('无几何');
    const position = built.geometry.getAttribute('position');
    const xs: number[] = [];
    for (let i = 0; i < position.count; i++) {
      // 扶手顶面在 4 + 1.1 附近，south 边在 z ≈ -2
      if (position.getY(i) > 4.9 && position.getZ(i) > -2.2) xs.push(position.getX(i));
    }
    return xs;
  }

  it('没有楼梯时护栏是连续的 —— 覆盖整条边', () => {
    const xs = handrailXSpanAtGap([DECK]);
    // 边中点附近必须有扶手顶点（连续）
    expect(xs.some((x) => Math.abs(x) < 0.9)).toBe(true);
  });

  it('楼梯接入后，接入处的护栏被挖开', () => {
    const xs = handrailXSpanAtGap([DECK, STAIR]);
    // 楼梯宽 1.6（半宽 0.8）+ 余量 0.3 → 开口约 x ∈ [-1.1, 1.1]
    const insideGap = xs.filter((x) => Math.abs(x) < 0.9);
    expect(insideGap, `开口内仍有扶手顶点：${insideGap.join(', ')}`).toEqual([]);
    // 但开口两侧仍然有护栏（不是把整条边都删了）
    expect(xs.some((x) => x < -2)).toBe(true);
    expect(xs.some((x) => x > 2)).toBe(true);
  });

  it('开口只影响楼梯进入的那条边', () => {
    // 同一个平台四边都加栏杆，只有 south 该被挖开
    const { built } = buildOne(
      [{ ...DECK, railing: ['north', 'south', 'east', 'west'] }, STAIR],
      'mezz',
    );
    if (built === null) throw new Error('无几何');
    const position = built.geometry.getAttribute('position');
    let northHasRailAtCenter = false;
    for (let i = 0; i < position.count; i++) {
      // north 边在 z = -8。阈值取 0.9 与 south 的断言一致 ——
      // 立柱间距 1.2m，中心附近最近的立柱落在 x ≈ ±0.59，窗口再窄就会
      // 落在两根立柱之间而误判（box 几何只有角点，扶手中段没有顶点）。
      if (position.getY(i) > 4.9 && position.getZ(i) < -7.8 && Math.abs(position.getX(i)) < 0.9) {
        northHasRailAtCenter = true;
      }
    }
    expect(northHasRailAtCenter, 'north 边不该被挖开').toBe(true);
  });

  it('爬梯同样会挖开护栏', () => {
    const xs = handrailXSpanAtGap([
      DECK,
      {
        id: 'ld',
        type: 'ladder',
        at: { x: 0, z: -1.4 },
        fromElevation: 0,
        to: 'mezz',
        width: 0.9,
        facing: 'north',
      },
    ]);
    // 爬梯宽 0.9（半宽 0.45）+ 余量 0.3 → 开口约 ±0.75
    expect(xs.filter((x) => Math.abs(x) < 0.6)).toEqual([]);
  });

  it('楼梯指向别的平台时不挖开本平台', () => {
    const xs = handrailXSpanAtGap([DECK, { ...STAIR, to: 'other' }]);
    expect(xs.some((x) => Math.abs(x) < 0.9)).toBe(true);
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
    expect(b.max.y).toBeCloseTo(ROOM_HEIGHT, P); // 层高由 spec 派生（S = 12）
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
