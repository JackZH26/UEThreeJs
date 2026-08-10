import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument } from '@tjre/core';
import { MaterialLibrary, PALETTE, paletteIds, surfaceSpec } from '@tjre/scene';
import { PORTAL_FRAME_MATERIAL, PORTAL_SURFACE_MATERIAL } from '../src/portal.js';

const examplesDir = resolve(import.meta.dirname, '../../../examples');

describe('命名调色板', () => {
  it('已知 id 拿到命名参数', () => {
    const spec = surfaceSpec('concrete_floor_polished');
    expect(spec).toBeDefined();
    expect(spec?.roughness).toBeLessThan(0.3); // 抛光面必须够光滑才反射得起来
  });

  it('未知 id 返回 undefined（由 MaterialLibrary 回落哈希）', () => {
    expect(surfaceSpec('no_such_material')).toBeUndefined();
  });

  it('表是冻结的 —— 防止某处改坏全局配色', () => {
    expect(Object.isFrozen(PALETTE)).toBe(true);
    expect(Object.isFrozen(PALETTE['steel_grate'])).toBe(true);
  });

  it('所有参数都在合法区间内', () => {
    for (const id of paletteIds()) {
      const spec = PALETTE[id];
      expect(spec, id).toBeDefined();
      if (spec === undefined) continue;
      expect(spec.color, id).toBeGreaterThanOrEqual(0);
      expect(spec.color, id).toBeLessThanOrEqual(0xffffff);
      expect(spec.roughness, id).toBeGreaterThan(0);
      expect(spec.roughness, id).toBeLessThanOrEqual(1);
      expect(spec.metalness, id).toBeGreaterThanOrEqual(0);
      expect(spec.metalness, id).toBeLessThanOrEqual(1);
    }
  });

  /**
   * 这条是防止"加了新示例却忘了配色"——漏配不会报错，只会静默变成哈希杂色，
   * 而杂色在灰调场景里其实挺显眼但容易被当成"就是这个设计"。
   */
  it('示例关卡用到的每个材质 id 都在表里', () => {
    const files = [
      'etc-s-piston-floor.roomgraph.yaml',
      'etc-m-catwalk-gallery.roomgraph.yaml',
      'etc-l-atrium.roomgraph.yaml',
    ];
    const missing: string[] = [];
    for (const file of files) {
      const loaded = parseDocument(readFileSync(resolve(examplesDir, file), 'utf8'), file);
      if (!loaded.ok) throw new Error(`${file} 解析失败`);
      for (const theme of loaded.doc.themes) {
        for (const id of Object.values(theme.surfaces)) {
          if (id !== undefined && surfaceSpec(id) === undefined) missing.push(`${file}: ${id}`);
        }
      }
      for (const room of loaded.doc.rooms) {
        for (const s of room.structures) {
          if (s.material !== undefined && surfaceSpec(s.material) === undefined) {
            missing.push(`${file}: ${s.material}`);
          }
        }
      }
    }
    expect(missing, `未配色的材质 id：\n${missing.join('\n')}`).toEqual([]);
  });
});

describe('MaterialLibrary 的两级回落', () => {
  it('命名 id 用表里的参数，不用哈希色', () => {
    const lib = new MaterialLibrary();
    const spec = surfaceSpec('steel_grate');
    expect(spec).toBeDefined();
    if (spec === undefined) return;

    const material = lib.get('steel_grate');
    expect(material.roughness).toBe(spec.roughness);
    expect(material.metalness).toBe(spec.metalness);
    // 颜色经 sRGB → 线性工作空间转换，所以比对 hex 要转回来
    expect(material.color.getHex()).toBe(spec.color);
    lib.dispose();
  });

  it('未知 id 仍得到**稳定**的哈希色（同 id 两次同色）', () => {
    const a = new MaterialLibrary();
    const b = new MaterialLibrary();
    expect(a.get('mystery_surface').color.getHex()).toBe(b.get('mystery_surface').color.getHex());
    // 且必须保持哑光 —— 哑光更像"未配置"，不会被误读成有意的抛光面
    expect(a.get('mystery_surface').roughness).toBeGreaterThan(0.8);
    a.dispose();
    b.dispose();
  });

  it('不同的未知 id 得到不同颜色（这才能看出主题引用写错）', () => {
    const lib = new MaterialLibrary();
    const one = lib.get('typo_wall_a').color.getHex();
    const two = lib.get('typo_wall_b').color.getHex();
    expect(one).not.toBe(two);
    lib.dispose();
  });

  it('传送门材质走专用分支，不受调色板影响', () => {
    const lib = new MaterialLibrary();
    const surface = lib.get(PORTAL_SURFACE_MATERIAL);
    expect(surface.emissiveIntensity).toBeGreaterThan(1); // 自发光才能在灰调里跳出来
    expect(lib.get(PORTAL_FRAME_MATERIAL).metalness).toBeGreaterThan(0.5);
    lib.dispose();
  });

  it('同一 id 复用同一个材质实例（每个实例 = 一个 shader program）', () => {
    const lib = new MaterialLibrary();
    expect(lib.get('concrete_wall_panel')).toBe(lib.get('concrete_wall_panel'));
    expect(lib.size).toBe(1);
    lib.dispose();
  });
});
