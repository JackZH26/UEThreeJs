/**
 * ============================================================
 *  材质调色板 —— ENTER THE CUBE 的冷灰工业方向
 * ============================================================
 *
 *  影调参考 three.js 的 `webgpu_postprocessing_ssr_denoise` 示例：
 *  统一的半光泽表面（示例全场景 `roughness = 0.3`）+ AgX 色调映射 +
 *  屏幕空间反射。**但配色不跟它走** —— 那是暖砂岩地牢，我们是冷灰混凝土。
 *  这里借的是它的**质感处理**，不是它的色相。
 *
 *  ── 为什么粗糙度这么低 ──────────────────────────────────
 *  旧值是 0.85（全哑光），在有 IBL 与 SSR 的管线下会把反射全部糊掉，
 *  等于白付了后处理的代价。0.2~0.45 才落在 SSR 的有效区间：
 *  抛光地面最低（承载主要反射），墙面略高，粗糙水泥最高。
 *
 *  ── 与哈希占位色的关系 ──────────────────────────────────
 *  本表**只覆盖已知 id**。未知 id 仍然走 `materials.ts` 里的 FNV-1a 哈希色，
 *  这是刻意保留的：主题里把材质 id 写错时颜色会突变成一个明显不属于
 *  这套配色的杂色，一眼就能看出来。若给所有 id 都配上正经颜色，
 *  这个诊断能力就没了。
 *
 *  ── 与 Phase 4 的关系 ───────────────────────────────────
 *  这是 `@tjre/presets` 材质预设库的**种子**。Phase 4 抽包时把这张表搬过去，
 *  并补上贴图 / UV / UE 父材质映射。现在刻意只存三个标量，不引入贴图，
 *  免得在没有 UV 生成器之前就欠下技术债。
 */

/** 一种表面的着色参数。颜色是 sRGB 十六进制（three 的 ColorManagement 会转到线性工作空间）。 */
export interface SurfaceSpec {
  /** sRGB 十六进制颜色 */
  color: number;
  /** 0 = 镜面，1 = 全漫反射 */
  roughness: number;
  /** 0 = 绝缘体，1 = 金属 */
  metalness: number;
}

/**
 * 命名材质表。
 *
 * 色相刻意压在偏蓝的低饱和灰里（混凝土在冷光下的实感），
 * 靠灯光的暖色去制造冷暖对比，而不是把材质本身调暖。
 */
export const PALETTE: Readonly<Record<string, Readonly<SurfaceSpec>>> = Object.freeze({
  // ── 地面 ──────────────────────────────────────────────
  // 抛光地面是反射的主要承载面，粗糙度取全场最低
  concrete_floor_polished: Object.freeze({ color: 0x41454a, roughness: 0.22, metalness: 0.04 }),
  // 磨损地面：更粗、更暗，反射被打散
  concrete_floor_worn: Object.freeze({ color: 0x3a3d40, roughness: 0.42, metalness: 0.02 }),

  // ── 墙面 ──────────────────────────────────────────────
  concrete_wall_panel: Object.freeze({ color: 0x4a4f55, roughness: 0.38, metalness: 0.02 }),
  concrete_wall_ribbed: Object.freeze({ color: 0x454a50, roughness: 0.34, metalness: 0.02 }),
  concrete_wall_board: Object.freeze({ color: 0x50555b, roughness: 0.4, metalness: 0.02 }),

  // ── 天花 ──────────────────────────────────────────────
  // 天花在编辑器里默认关闭，只在第一人称时出现，取最暗以免抢视线
  concrete_ceiling: Object.freeze({ color: 0x33373b, roughness: 0.46, metalness: 0.02 }),
  concrete_coffer: Object.freeze({ color: 0x363a3f, roughness: 0.44, metalness: 0.02 }),
  steel_deck_ceiling: Object.freeze({ color: 0x3d4247, roughness: 0.3, metalness: 0.6 }),

  // ── 结构件（钢） ──────────────────────────────────────
  // 金属度高 + 粗糙度低 = 明确的镜面反射，让廊桥/楼梯从混凝土里跳出来
  steel_grate: Object.freeze({ color: 0x5a6068, roughness: 0.3, metalness: 0.85 }),
  steel_grate_dark: Object.freeze({ color: 0x474d54, roughness: 0.34, metalness: 0.82 }),
});

/** 查表；未命中返回 `undefined`，由调用方回落到哈希占位色 */
export function surfaceSpec(materialId: string): Readonly<SurfaceSpec> | undefined {
  return PALETTE[materialId];
}

/** 表里已定义的全部材质 id（供测试核对示例覆盖率） */
export function paletteIds(): string[] {
  return Object.keys(PALETTE);
}
