import { describe, expect, it } from 'vitest';
import { solveLayout, rotationForFacing, worldFacing } from '@tjre/core';
import type { RoomPlacement } from '@tjre/core';
import { makeDoc } from './fixtures.js';

function placementOf(doc: Parameters<typeof solveLayout>[0], roomId: string): RoomPlacement {
  const result = solveLayout(doc);
  const placement = result.placements.get(roomId);
  expect(
    placement,
    `房间 "${roomId}" 未被定位；诊断：${JSON.stringify(result.diagnostics)}`,
  ).toBeDefined();
  return placement as RoomPlacement;
}

describe('旋转数学', () => {
  it('90° 旋转把局部墙面映射到正确的世界方向', () => {
    // 绕 Y 轴 90°：north→west→south→east→north
    expect(worldFacing('north', 90)).toBe('west');
    expect(worldFacing('west', 90)).toBe('south');
    expect(worldFacing('south', 90)).toBe('east');
    expect(worldFacing('east', 90)).toBe('north');
  });

  it('0° 旋转是恒等映射', () => {
    for (const wall of ['north', 'south', 'east', 'west'] as const) {
      expect(worldFacing(wall, 0)).toBe(wall);
    }
  });

  it('180° 旋转翻转所有方向', () => {
    expect(worldFacing('north', 180)).toBe('south');
    expect(worldFacing('east', 180)).toBe('west');
  });

  it('rotationForFacing 是 worldFacing 的逆运算', () => {
    for (const wall of ['north', 'south', 'east', 'west'] as const) {
      for (const target of ['north', 'south', 'east', 'west'] as const) {
        const rotation = rotationForFacing(wall, target);
        expect(worldFacing(wall, rotation)).toBe(target);
      }
    }
  });

  it('坐标不含浮点噪声（不使用 Math.cos 的收益）', () => {
    // a 旋转 90°，其 north 门朝西 → b 落在正西方，Z 方向应**精确**为 0。
    // 若用 Math.cos(Math.PI/2)（= 6.123e-17）而非整数查表，
    // 这里会得到 ±1e-16 或 -0，进而污染 golden 测试与序列化确定性。
    const doc = makeDoc((d) => {
      d.rooms[0]!.pin = { x: 0, z: 0, y: 0, rotationY: 90 };
    });
    const a = placementOf(doc, 'a');
    const b = placementOf(doc, 'b');

    // 90° 旋转后半尺寸必须是精确的 4，而非 3.9999999999999996
    expect(Object.is(a.hx, 4)).toBe(true);
    expect(Object.is(a.hz, 4)).toBe(true);

    // 关键断言：垂直于推进方向的坐标必须是精确 0（且不是 -0）
    expect(Object.is(b.z, 0)).toBe(true);
    expect(b.x).toBeLessThan(0); // 确认真的在西侧，断言没有空跑
  });
});

describe('基础串联', () => {
  /**
   * fixture：a(8×8) 的 north 门 ↔ b(8×8) 的 south 门，墙厚默认 0.2，offset 都是 0。
   * 预期：a 在原点；b 在 a 的正北。
   *   a 的 north 内壁面 z = -4
   *   b 的 south 内壁面 z = -4 - 0.2 = -4.2
   *   b 中心 z = -4.2 - 4 = -8.2
   */
  it('两个房间沿 north/south 正确拼接', () => {
    const doc = makeDoc();
    const a = placementOf(doc, 'a');
    const b = placementOf(doc, 'b');

    expect(a).toMatchObject({ x: 0, z: 0, rotationY: 0, origin: 'anchor' });
    expect(b.rotationY).toBe(0); // south 墙已朝南，无需旋转
    expect(b.x).toBeCloseTo(0, 9);
    expect(b.z).toBeCloseTo(-8.2, 9);
    expect(b.origin).toBe('derived');
  });

  it('墙厚变化会精确反映在间距上', () => {
    const doc = makeDoc((d) => {
      d.meta.wallThickness = 0.5;
    });
    const b = placementOf(doc, 'b');
    expect(b.z).toBeCloseTo(-8.5, 9); // -4 - 0.5 - 4
  });

  it('开口 offset 会横向错开相邻房间', () => {
    // a 的门往东移 2；b 的门仍居中 → b 整体往东移 2
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings[0]!.offset = 2;
    });
    const b = placementOf(doc, 'b');
    expect(b.x).toBeCloseTo(2, 9);
    expect(b.z).toBeCloseTo(-8.2, 9);
  });

  it('两侧 offset 相同时不产生错位', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings[0]!.offset = 2;
      d.rooms[1]!.openings[0]!.offset = 2;
    });
    const b = placementOf(doc, 'b');
    expect(b.x).toBeCloseTo(0, 9);
  });

  it('房间尺寸不同时按各自半尺寸拼接', () => {
    const doc = makeDoc((d) => {
      d.rooms[1]!.size = { w: 6, d: 12, h: 4 };
    });
    const b = placementOf(doc, 'b');
    expect(b.z).toBeCloseTo(-4 - 0.2 - 6, 9); // a 半深 4 + 墙 0.2 + b 半深 6
  });
});

describe('旋转推导（作者不写旋转，求解器算出来）', () => {
  it('north 门接 north 门 → 邻居旋转 180°', () => {
    const doc = makeDoc((d) => {
      d.rooms[1]!.openings[0]!.wall = 'north';
    });
    const b = placementOf(doc, 'b');
    // b 的 north 墙必须朝南才能对上 a 的 north 门 → 旋转 180°
    expect(b.rotationY).toBe(180);
    expect(b.z).toBeCloseTo(-8.2, 9);
  });

  it('north 门接 east 门 → 邻居旋转 270°', () => {
    const doc = makeDoc((d) => {
      d.rooms[1]!.openings[0]!.wall = 'east';
    });
    const b = placementOf(doc, 'b');
    // east 墙需朝南：worldFacing('east', 270) === 'south'
    expect(worldFacing('east', b.rotationY)).toBe('south');
    expect(b.rotationY).toBe(270);
  });

  it('非正方形房间旋转 90° 后世界半尺寸交换', () => {
    const doc = makeDoc((d) => {
      d.rooms[1]!.size = { w: 6, d: 12, h: 4 };
      d.rooms[1]!.openings[0]!.wall = 'east';
    });
    const b = placementOf(doc, 'b');
    expect(b.rotationY).toBe(270);
    expect(b.hx).toBe(6); // 旋转后 X 方向由 d=12 决定 → 半尺寸 6
    expect(b.hz).toBe(3); // Z 方向由 w=6 决定 → 半尺寸 3
  });
});

describe('pin 锚定', () => {
  it('pin 决定锚点位置，邻居据此推导', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.pin = { x: 100, z: 50, y: 0, rotationY: 0 };
    });
    const a = placementOf(doc, 'a');
    const b = placementOf(doc, 'b');
    expect(a).toMatchObject({ x: 100, z: 50, origin: 'pin' });
    expect(b.x).toBeCloseTo(100, 9);
    expect(b.z).toBeCloseTo(50 - 8.2, 9);
  });

  it('pin 带旋转时邻居方向随之改变', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.pin = { x: 0, z: 0, y: 0, rotationY: 90 };
    });
    const a = placementOf(doc, 'a');
    const b = placementOf(doc, 'b');
    expect(a.rotationY).toBe(90);
    // a 的 north 墙旋转 90° 后朝西 → b 落在 a 的正西
    expect(worldFacing('north', 90)).toBe('west');
    expect(b.x).toBeCloseTo(-8.2, 9);
    expect(b.z).toBeCloseTo(0, 9);
  });
});

describe('单向门不影响布局', () => {
  it('oneWay 只影响可达性，不影响物理相邻', () => {
    const doc = makeDoc((d) => {
      d.connections[0]!.oneWay = true;
    });
    const result = solveLayout(doc);
    // 两个房间都必须被定位 —— 单向门后的房间在物理上依然相邻
    expect(result.placements.size).toBe(2);
    expect(result.diagnostics.filter((x) => x.rule === 'R072')).toEqual([]);
  });
});

describe('冲突诊断 R07x', () => {
  it('R072 孤立房间无法定位', () => {
    const doc = makeDoc((d) => {
      d.connections = [];
      d.meta.entryRoom = 'a';
    });
    const result = solveLayout(doc);
    const diag = result.diagnostics.find((x) => x.rule === 'R072');
    expect(diag, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(diag?.message).toContain('b');
    expect(diag?.hint).toBeTruthy();
    expect(result.ok).toBe(false);
  });

  it('R071 pin 与连接推导的位置冲突', () => {
    const doc = makeDoc((d) => {
      // 必须 pin 两个房间才会冲突 —— 只 pin 一个的话整体平移即可自洽
      d.rooms[0]!.pin = { x: 0, z: 0, y: 0, rotationY: 0 };
      d.rooms[1]!.pin = { x: 999, z: 999, y: 0, rotationY: 0 };
    });
    const result = solveLayout(doc);
    const diag = result.diagnostics.find((x) => x.rule === 'R071');
    expect(diag, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(diag?.hint).toContain('pin');
    expect(result.ok).toBe(false);
  });

  it('R071 环路上两条连接的门位不一致', () => {
    // a 与 b 之间开两条平行连接，第二条的 offset 不一致 → 推导冲突
    const doc = makeDoc((d) => {
      d.rooms[0]!.doorCount = 2;
      d.rooms[1]!.doorCount = 2;
      d.rooms[0]!.openings.push({
        id: 'door_n2',
        wall: 'north',
        type: 'door',
        offset: 3,
        size: { w: 1, h: 2.2 },
      });
      d.rooms[1]!.openings.push({
        id: 'door_s2',
        wall: 'south',
        type: 'door',
        offset: -3,
        size: { w: 1, h: 2.2 },
      });
      d.connections.push({ id: 'a_to_b_2', from: 'a.door_n2', to: 'b.door_s2' });
    });
    const result = solveLayout(doc);
    // 第一条连接把 b 放在 x=0，第二条要求 x=6 → 冲突
    expect(result.diagnostics.some((x) => x.rule === 'R071')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('直接重叠会被 R070 抓到', () => {
    // 两个房间都 pin 在同一位置，且无连接
    const doc = makeDoc((d) => {
      d.connections = [];
      d.rooms[0]!.pin = { x: 0, z: 0, y: 0, rotationY: 0 };
      d.rooms[1]!.pin = { x: 1, z: 1, y: 0, rotationY: 0 };
    });
    const result = solveLayout(doc);
    const diag = result.diagnostics.find((x) => x.rule === 'R070');
    expect(diag, JSON.stringify(result.diagnostics)).toBeDefined();
    expect(diag?.message).toMatch(/重叠/);
  });

  it('正常拼接不会被判为重叠（边界相切不算）', () => {
    const result = solveLayout(makeDoc());
    expect(result.diagnostics.filter((x) => x.rule === 'R070')).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('确定性', () => {
  it('同一文档求解两次结果完全一致', () => {
    const doc = makeDoc();
    const first = solveLayout(doc);
    const second = solveLayout(doc);
    expect(JSON.stringify([...second.placements.entries()])).toBe(
      JSON.stringify([...first.placements.entries()]),
    );
  });

  it('bounds 覆盖所有房间', () => {
    const result = solveLayout(makeDoc());
    // a: z ∈ [-4, 4]；b: z ∈ [-12.2, -4.2]
    expect(result.bounds.minZ).toBeCloseTo(-12.2, 9);
    expect(result.bounds.maxZ).toBeCloseTo(4, 9);
    expect(result.bounds.minX).toBeCloseTo(-4, 9);
    expect(result.bounds.maxX).toBeCloseTo(4, 9);
  });
});
