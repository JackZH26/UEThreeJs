import { describe, expect, it } from 'vitest';
import {
  GRID_UNIT,
  PORTAL_SIZE,
  ROOM_SPECS,
  Room,
  WALL_SIDES,
  WALL_T,
  cellEdgeOffsets,
  roomOpenings,
  roomPortals,
  roomSize,
  specFootprint,
  specOuterPlan,
  specPortalCount,
  specPortals,
  specSize,
} from '@tjre/schema';
import type { RoomSpec, WallSide } from '@tjre/schema';

/**
 * 规格派生表是整个模型的地基：房间尺寸、传送门位置、可互换性全从这里来。
 * 这些断言把用户给出的规格表逐条钉死 —— 任何改动都会在这里失败，
 * 而不是等到 36 个房间拼装后发现门对不上墙。
 */

/** 用户给定的规格表（docs/SCOPE.md 与 spec.ts 的注释都引用同一组数字） */
const TABLE: Record<
  RoomSpec,
  { cells: [number, number]; outer: [number, number]; interior: [number, number]; height: number }
> = {
  S: { cells: [1, 1], outer: [30, 30], interior: [28.5, 28.5], height: 12 },
  M: { cells: [2, 1], outer: [60, 30], interior: [58.5, 28.5], height: 18 },
  L: { cells: [2, 2], outer: [60, 60], interior: [58.5, 58.5], height: 24 },
};

describe('常量', () => {
  it('格位 30m、墙厚 0.75m、门洞 3.0 × 3.2m', () => {
    expect(GRID_UNIT).toBe(30);
    expect(WALL_T).toBe(0.75);
    expect(PORTAL_SIZE).toEqual({ w: 3, h: 3.2 });
  });
});

describe('尺寸派生', () => {
  for (const spec of ROOM_SPECS) {
    const row = TABLE[spec];

    it(`${spec}：占格 ${row.cells.join('×')}`, () => {
      expect(specFootprint(spec)).toEqual({ cx: row.cells[0], cz: row.cells[1] });
    });

    it(`${spec}：外廓 ${row.outer.join(' × ')}m`, () => {
      expect(specOuterPlan(spec)).toEqual({ w: row.outer[0], d: row.outer[1] });
    });

    it(`${spec}：净内空 ${row.interior.join(' × ')}m，层高 ${row.height}m`, () => {
      expect(specSize(spec)).toEqual({
        w: row.interior[0],
        d: row.interior[1],
        h: row.height,
      });
    });

    it(`${spec}：外廓 = 净内空 + 2 × 墙厚（每边各减 0.75）`, () => {
      const size = specSize(spec);
      const outer = specOuterPlan(spec);
      expect(size.w + 2 * WALL_T).toBe(outer.w);
      expect(size.d + 2 * WALL_T).toBe(outer.d);
    });

    it(`${spec}：外廓是格位的整数倍 —— 可互换的前提`, () => {
      const outer = specOuterPlan(spec);
      expect(outer.w % GRID_UNIT).toBe(0);
      expect(outer.d % GRID_UNIT).toBe(0);
    });
  }
});

describe('传送门派生', () => {
  it('格边偏移：1 条格边居中，2 条格边在 ±15', () => {
    expect(cellEdgeOffsets(1)).toEqual([0]);
    expect(cellEdgeOffsets(2)).toEqual([-15, 15]);
    expect(cellEdgeOffsets(3)).toEqual([-30, 0, 30]);
  });

  it('S 每面 1 个 → 共 4 个', () => {
    expect(specPortalCount('S')).toBe(4);
    for (const wall of WALL_SIDES) {
      expect(
        specPortals('S')
          .filter((p) => p.wall === wall)
          .map((p) => p.offset),
      ).toEqual([0]);
    }
  });

  it('M 宽墙 2 个、窄墙 1 个 → 共 6 个', () => {
    expect(specPortalCount('M')).toBe(6);
    const byWall = (wall: WallSide): number[] =>
      specPortals('M')
        .filter((p) => p.wall === wall)
        .map((p) => p.offset);
    // 长边沿 X → north / south 是宽墙
    expect(byWall('north')).toEqual([-15, 15]);
    expect(byWall('south')).toEqual([-15, 15]);
    expect(byWall('east')).toEqual([0]);
    expect(byWall('west')).toEqual([0]);
  });

  it('L 每面 2 个 → 共 8 个', () => {
    expect(specPortalCount('L')).toBe(8);
    for (const wall of WALL_SIDES) {
      expect(
        specPortals('L')
          .filter((p) => p.wall === wall)
          .map((p) => p.offset),
      ).toEqual([-15, 15]);
    }
  });

  it('全部传送门尺寸恒定、贴地、类型为 portal', () => {
    for (const spec of ROOM_SPECS) {
      for (const portal of specPortals(spec)) {
        expect(portal.type).toBe('portal');
        expect(portal.size).toEqual({ w: 3, h: 3.2 });
        expect(portal.elevation).toBe(0);
      }
    }
  });

  it('传送门完整落在墙内 —— 洞口不会切到墙角', () => {
    for (const spec of ROOM_SPECS) {
      const size = specSize(spec);
      for (const portal of specPortals(spec)) {
        const span = portal.wall === 'north' || portal.wall === 'south' ? size.w : size.d;
        expect(Math.abs(portal.offset) + portal.size.w / 2).toBeLessThan(span / 2);
        expect(portal.elevation + portal.size.h).toBeLessThan(size.h);
      }
    }
  });

  it('id 唯一且符合 Id 规则（小写字母开头）', () => {
    for (const spec of ROOM_SPECS) {
      const ids = specPortals(spec).map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('返回的是冻结的共享表 —— 防止某个房间改坏全库', () => {
    const portals = specPortals('S');
    expect(Object.isFrozen(portals)).toBe(true);
    expect(Object.isFrozen(portals[0])).toBe(true);
  });
});

describe('Room 的派生访问器', () => {
  const room = Room.parse({ id: 'r', spec: 'M', theme: 't' });

  it('roomSize 等于 specSize', () => {
    expect(roomSize(room)).toEqual(specSize('M'));
  });

  it('roomPortals 等于 specPortals', () => {
    expect(roomPortals(room)).toEqual(specPortals('M'));
  });

  it('roomOpenings = 派生传送门 + 手写开口，且传送门在前', () => {
    const withWindow = Room.parse({
      id: 'r',
      spec: 'M',
      theme: 't',
      openings: [
        { id: 'win', wall: 'north', type: 'window', size: { w: 2, h: 1.5 }, elevation: 4 },
      ],
    });
    const all = roomOpenings(withWindow);
    expect(all).toHaveLength(7);
    expect(all.slice(0, 6)).toEqual(specPortals('M'));
    expect(all[6]?.id).toBe('win');
  });

  it('没有手写开口时 roomOpenings 直接返回共享表（零拷贝）', () => {
    expect(roomOpenings(room)).toBe(specPortals('M'));
  });

  it('schema 不再接受 size / doorCount / pin —— strictObject 会拒绝', () => {
    for (const bad of [
      { size: { w: 8, d: 8, h: 4 } },
      { doorCount: 4 },
      { pin: { x: 0, z: 0 } },
      { wallThickness: 0.2 },
    ]) {
      const result = Room.safeParse({ id: 'r', spec: 'S', theme: 't', ...bad });
      expect(result.success, `不该接受 ${JSON.stringify(bad)}`).toBe(false);
    }
  });
});
