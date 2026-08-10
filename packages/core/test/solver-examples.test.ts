import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument, solveLayout } from '@tjre/core';

const examplesDir = resolve(import.meta.dirname, '../../../examples');

function solveExample(name: string) {
  const text = readFileSync(resolve(examplesDir, name), 'utf8');
  const loaded = parseDocument(text, name);
  if (!loaded.ok) throw new Error(`加载失败：${JSON.stringify(loaded.errors, null, 2)}`);
  return solveLayout(loaded.doc);
}

/**
 * Golden 测试：把示例关卡求解出的坐标写死。
 *
 * 用显式期望值而不是 snapshot —— 数值是**手算可核对**的，
 * 写在这里等于把几何约定文档化；snapshot 只会在改坏时无声地被更新。
 */
describe('two-rooms 布局', () => {
  it('两个 8×8 房间沿 Z 轴串联，间距 = 墙厚 0.2', () => {
    const layout = solveExample('two-rooms.roomgraph.yaml');
    expect(layout.ok).toBe(true);
    expect(layout.diagnostics).toEqual([]);

    // entry 是 entryRoom → 锚点在原点
    expect(layout.placements.get('entry')).toMatchObject({
      x: 0,
      z: 0,
      rotationY: 0,
      hx: 4,
      hz: 4,
      origin: 'anchor',
    });

    // entry 北墙 z = -4；+0.2 墙厚 → store 南墙 z = -4.2；store 半深 3 → 中心 -7.2
    const store = layout.placements.get('store');
    expect(store?.rotationY).toBe(0);
    expect(store?.x).toBeCloseTo(0, 9);
    expect(store?.z).toBeCloseTo(-7.2, 9);
    expect(store?.hz).toBe(3);
  });
});

describe('loft-warehouse 布局', () => {
  it('三房串联，含 offset 6 的夹层门导致的横向错位', () => {
    const layout = solveExample('loft-warehouse.roomgraph.yaml');
    expect(layout.ok).toBe(true);
    expect(layout.diagnostics).toEqual([]);
    expect(layout.placements.size).toBe(3);

    // dock 10×8 是 entryRoom → 原点
    expect(layout.placements.get('dock')).toMatchObject({ x: 0, z: 0, rotationY: 0 });

    // dock 北墙 z=-4；墙厚 0.25 → hall 南墙 z=-4.25；hall 半深 8 → 中心 -12.25
    const hall = layout.placements.get('hall');
    expect(hall?.x).toBeCloseTo(0, 9);
    expect(hall?.z).toBeCloseTo(-12.25, 9);
    expect(hall?.hx).toBe(10);
    expect(hall?.hz).toBe(8);

    // hall 北墙 z=-20.25，门 offset=6 → 洞口世界 x=6
    // catwalk_room 南墙 z=-20.5，其门 offset=-2 → 中心 x = 6+2 = 8, z = -20.5-4 = -24.5
    const catwalk = layout.placements.get('catwalk_room');
    expect(catwalk?.rotationY).toBe(0);
    expect(catwalk?.x).toBeCloseTo(8, 9);
    expect(catwalk?.z).toBeCloseTo(-24.5, 9);
  });

  it('整体范围符合预期', () => {
    const layout = solveExample('loft-warehouse.roomgraph.yaml');
    expect(layout.bounds.minX).toBeCloseTo(-10, 9);
    expect(layout.bounds.maxX).toBeCloseTo(14, 9);
    expect(layout.bounds.minZ).toBeCloseTo(-28.5, 9);
    expect(layout.bounds.maxZ).toBeCloseTo(4, 9);
  });

  it('没有房间重叠', () => {
    const layout = solveExample('loft-warehouse.roomgraph.yaml');
    expect(layout.diagnostics.filter((d) => d.rule === 'R070')).toEqual([]);
  });

  it('求解可重复（同输入 → 逐字节同输出）', () => {
    const first = solveExample('loft-warehouse.roomgraph.yaml');
    const second = solveExample('loft-warehouse.roomgraph.yaml');
    const key = (l: typeof first) =>
      JSON.stringify([...l.placements.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
    expect(key(second)).toBe(key(first));
  });
});
