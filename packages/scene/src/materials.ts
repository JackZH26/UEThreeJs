import { Color, DoubleSide, MeshStandardMaterial } from 'three';
import type { Material } from 'three';
import { PORTAL_FRAME_MATERIAL, PORTAL_SURFACE_MATERIAL } from './portal.js';
import { surfaceSpec } from './palette.js';

/**
 * 材质提供器 —— 两级：命名调色板优先，未知 id 回落哈希占位色。
 *
 * 1. **命名表**（`palette.ts`）：已知材质 id 的正式配色与质感参数。
 * 2. **哈希兜底**：未知 id 按 id 哈希出一个**稳定**的颜色 —— 同一个 id 每次
 *    都得到同一种颜色，不同 id 明显不同。它的作用不是好看，而是**诊断**：
 *    主题里把材质 id 写错时，颜色会突变成一个明显不属于这套配色的杂色。
 *    所以这一级必须保留，不能给所有 id 都配上正经颜色。
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

    // 传送门是固定样式，不走哈希占位色 —— 它必须在灰调场景里一眼可辨
    if (materialId === PORTAL_SURFACE_MATERIAL || materialId === PORTAL_FRAME_MATERIAL) {
      const portal = this.createPortalMaterial(materialId);
      this.cache.set(materialId, portal);
      return portal;
    }

    // 命名调色板优先；未命中则回落哈希占位色（见类注释）
    const spec = surfaceSpec(materialId);
    const material = new MeshStandardMaterial({
      color: spec === undefined ? colorFor(materialId) : new Color(spec.color),
      // 未知材质保持高粗糙度：哑光更像"未配置"，不会被误认为是有意的抛光面
      roughness: spec?.roughness ?? 0.85,
      metalness: spec?.metalness ?? 0.02,
      // 自发光是可选的：只有彩灯 / 车灯 / 霓虹那几个材质会给。
      // 缺省的 emissive 是黑色，等于不发光，所以这里不需要条件分支。
      ...(spec?.emissive === undefined ? {} : { emissive: new Color(spec.emissive) }),
      ...(spec?.emissiveIntensity === undefined
        ? {}
        : { emissiveIntensity: spec.emissiveIntensity }),
      ...(spec?.flatShading === undefined ? {} : { flatShading: spec.flatShading }),
      // 墙体是有厚度的实体，但洞口内壁在某些视角下会看到背面，
      // DoubleSide 避免出现"洞口边缘漏空"的观感。
      // 这对 SSR 是安全的：DoubleSide 下 TSL 的 `normalView` 会乘 `faceDirection`，
      // 背面片元自动取反，写进法线缓冲的永远是朝向相机的法线
      // （见 three.js/src/nodes/display/FrontFacingNode.js 的 negateOnBackSide）。
      side: DoubleSide,
      wireframe: this.options.wireframe ?? false,
    });
    material.name = materialId;
    this.cache.set(materialId, material);
    return material;
  }

  /**
   * 传送门材质（固定样式，见 portal.ts）。
   *
   * 门面用强自发光的青色，门框用暗金属 —— 组合在混凝土灰调里辨识度最高，
   * 且自发光不受场景光照影响，任何角度都亮。
   */
  private createPortalMaterial(materialId: string): MeshStandardMaterial {
    const isSurface = materialId === PORTAL_SURFACE_MATERIAL;
    const material = new MeshStandardMaterial(
      isSurface
        ? {
            color: new Color(0x0a2a33),
            emissive: new Color(0x38e8ff),
            emissiveIntensity: 1.4,
            roughness: 0.25,
            metalness: 0,
            transparent: true,
            opacity: 0.82,
            side: DoubleSide,
            wireframe: this.options.wireframe ?? false,
          }
        : {
            color: new Color(0x2a3138),
            emissive: new Color(0x1a6b7a),
            emissiveIntensity: 0.5,
            roughness: 0.35,
            metalness: 0.8,
            side: DoubleSide,
            wireframe: this.options.wireframe ?? false,
          },
    );
    material.name = materialId;
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
