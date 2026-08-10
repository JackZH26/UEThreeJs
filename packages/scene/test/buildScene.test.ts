import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Box3, MathUtils } from 'three';
import { parseDocument } from '@tjre/core';
import { buildScene } from '@tjre/scene';
import type { RoomGraphDocument } from '@tjre/schema';

const examplesDir = resolve(import.meta.dirname, '../../../examples');
const P = 4; // Float32 顶点精度，见 shell.test.ts

function loadExample(name: string): RoomGraphDocument {
  const loaded = parseDocument(readFileSync(resolve(examplesDir, name), 'utf8'), name);
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors, null, 2));
  return loaded.doc;
}

describe('buildScene 与求解器一致', () => {
  it('每个房间 Group 的世界变换等于求解结果', () => {
    const doc = loadExample('loft-warehouse.roomgraph.yaml');
    const built = buildScene(doc);

    expect(built.stats.rooms).toBe(3);

    for (const [roomId, group] of built.roomGroups) {
      const placement = built.layout.placements.get(roomId);
      expect(placement, `${roomId} 缺少 placement`).toBeDefined();
      if (placement === undefined) continue;

      expect(group.position.x).toBeCloseTo(placement.x, P);
      expect(group.position.y).toBeCloseTo(placement.y, P);
      expect(group.position.z).toBeCloseTo(placement.z, P);
      expect(group.rotation.y).toBeCloseTo(MathUtils.degToRad(placement.rotationY), P);
    }

    built.dispose();
  });

  it('每个房间产出 6 个外壳 mesh（4 墙 + 地 + 顶）', () => {
    const doc = loadExample('loft-warehouse.roomgraph.yaml');
    const built = buildScene(doc);
    expect(built.stats.meshes).toBe(3 * 6);
    for (const group of built.roomGroups.values()) {
      expect(group.children).toHaveLength(6);
    }
    built.dispose();
  });

  it('洞口总数等于文档里 openings 的总数', () => {
    const doc = loadExample('loft-warehouse.roomgraph.yaml');
    const expected = doc.rooms.reduce((sum, r) => sum + r.openings.length, 0);
    const built = buildScene(doc);
    expect(built.stats.openings).toBe(expected);
    built.dispose();
  });

  it('场景整体包围盒与求解 bounds 吻合（差值仅来自墙厚外扩）', () => {
    const doc = loadExample('loft-warehouse.roomgraph.yaml');
    const built = buildScene(doc);
    const box = new Box3().setFromObject(built.root);
    const b = built.layout.bounds;
    const t = doc.meta.wallThickness / 2;

    // 求解 bounds 用的是内部尺寸；场景多出半个墙厚
    expect(box.min.x).toBeCloseTo(b.minX - t, P);
    expect(box.max.x).toBeCloseTo(b.maxX + t, P);
    expect(box.min.z).toBeCloseTo(b.minZ - t, P);
    expect(box.max.z).toBeCloseTo(b.maxZ + t, P);
    // 最矮房间的地板底 = -t；最高房间是 10m 的 hall，天花顶 = 10 + t
    expect(box.min.y).toBeCloseTo(-t, P);
    expect(box.max.y).toBeCloseTo(10 + t, P);

    built.dispose();
  });

  it('材质按 id 复用，不是每面墙新建一个', () => {
    const doc = loadExample('loft-warehouse.roomgraph.yaml');
    const built = buildScene(doc);
    // 两个主题 × 三种表面 = 至多 6 种材质，远少于 18 个 mesh
    expect(built.materials.size).toBeLessThanOrEqual(6);
    expect(built.materials.size).toBeGreaterThan(0);
    built.dispose();
  });

  it('同一材质 id 每次得到相同颜色（占位色必须稳定）', () => {
    const doc = loadExample('two-rooms.roomgraph.yaml');
    const a = buildScene(doc);
    const b = buildScene(doc);
    const colorOf = (r: ReturnType<typeof buildScene>): string => {
      const first = r.materials.list()[0];
      if (first === undefined || !('color' in first)) throw new Error('无材质');
      return String((first as { color: { getHexString: () => string } }).color.getHexString());
    };
    expect(colorOf(b)).toBe(colorOf(a));
    a.dispose();
    b.dispose();
  });

  it('dispose 后房间分组被清空', () => {
    const built = buildScene(loadExample('two-rooms.roomgraph.yaml'));
    expect(built.roomGroups.size).toBe(2);
    built.dispose();
    expect(built.roomGroups.size).toBe(0);
    expect(built.root.children).toHaveLength(0);
  });

  it('未被定位的房间不会进入场景（不叠加噪声）', () => {
    // 制造一个孤立房间：删掉全部连接
    const doc = loadExample('two-rooms.roomgraph.yaml');
    const stripped: RoomGraphDocument = { ...doc, connections: [] };
    const built = buildScene(stripped);
    // 只有锚点房间被定位
    expect(built.stats.rooms).toBe(1);
    expect(built.layout.diagnostics.some((d) => d.rule === 'R072')).toBe(true);
    built.dispose();
  });
});
