import { Color, DoubleSide, MeshStandardMaterial } from 'three';
import type { Material } from 'three';

/**
 * 占位材质提供器。
 *
 * 真正的材质预设库是 Phase 4 的内容（`@tjre/presets`）。在那之前，
 * 这里按材质 id 的哈希生成一个**稳定**的颜色 —— 同一个 id 每次都得到
 * 同一种颜色，不同 id 明显不同。这样在 3D 里能一眼看出哪面墙用了哪种材质，
 * 也能立刻发现主题引用写错（颜色突变）。
 *
 * 刻意不做随机色：随机色每次刷新都变，无法用于比对。
 */

/** FNV-1a 32 位哈希 —— 短字符串够用且实现简单 */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 由材质 id 派生颜色。
 *
 * 限定在中低饱和、中等明度的区间：建筑内景的材质大多是灰调，
 * 全饱和的彩色会让人误以为是调试高亮。
 */
function colorFor(materialId: string): Color {
  const h = hash32(materialId);
  const hue = (h % 360) / 360;
  const saturation = 0.12 + ((h >>> 9) % 18) / 100; // 0.12 ~ 0.30
  const lightness = 0.38 + ((h >>> 17) % 26) / 100; // 0.38 ~ 0.64
  return new Color().setHSL(hue, saturation, lightness);
}

export interface MaterialLibraryOptions {
  /** 线框模式，便于核对几何拓扑 */
  wireframe?: boolean;
}

/**
 * 材质缓存。
 *
 * 必须复用：three.js 每个不同的 Material 实例对应一个 shader program，
 * 每面墙都新建材质会让 program 数量随房间数线性增长。
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, MeshStandardMaterial>();

  constructor(private readonly options: MaterialLibraryOptions = {}) {}

  get(materialId: string): MeshStandardMaterial {
    const cached = this.cache.get(materialId);
    if (cached !== undefined) return cached;

    const material = new MeshStandardMaterial({
      color: colorFor(materialId),
      roughness: 0.85,
      metalness: 0.02,
      // 墙体是有厚度的实体，但洞口内壁在某些视角下会看到背面，
      // DoubleSide 避免出现"洞口边缘漏空"的观感
      side: DoubleSide,
      wireframe: this.options.wireframe ?? false,
    });
    material.name = materialId;
    this.cache.set(materialId, material);
    return material;
  }

  /** three.js 的 GPU 资源必须手动释放（核心没有自动回收） */
  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /** 供测试断言用 */
  list(): Material[] {
    return [...this.cache.values()];
  }
}
