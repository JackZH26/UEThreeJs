import { PROP_COLORS } from '@tjre/schema';
import type { PropColor } from '@tjre/schema';

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
  /**
   * 自发光色。彩灯泡、车灯、霓虹轮眉靠它在暗场里发亮。
   *
   * ⚠️ 自发光**不照亮**别的东西（three 里 emissive 只影响自身像素），
   * 房间的实际照明仍然来自 `room.lights`。但它会进颜色缓冲，
   * 于是能被 SSR 反射到地面上 —— 那正是参考照片里湿亮地板的观感来源。
   */
  emissive?: number;
  emissiveIntensity?: number;
  /** 平面着色（低多边形镜面球靠它出刻面感） */
  flatShading?: boolean;
}

/**
 * 道具配色的**色值**表。
 *
 * 颜色**名**是 schema 的受控词表（`PROP_COLORS`，prefab 目录用它），
 * 色值只在这里 —— 名字属于数据模型，色值属于渲染，两边各归其位。
 * 这些是饱和的游乐场颜色，与房间的冷灰工业调**故意**唱反调：
 * 碰碰车就该是场馆里唯一鲜艳的东西。
 */
const PROP_COLOR_HEX: Readonly<Record<PropColor, number>> = Object.freeze({
  pink: 0xff5fa2,
  red: 0xe03a2f,
  orange: 0xff8a34,
  yellow: 0xf7c62e,
  lime: 0xa8e04a,
  mint: 0x47d9b2,
  cyan: 0x38c8ff,
  blue: 0x2f6fe0,
  purple: 0x8b5cf6,
  white: 0xeef2f6,
});

/**
 * 材质 id 的拼装规则 —— 构造器与调色板**共用这三个函数**。
 * 两边各自拼字符串的话，改一处就会静默回落成哈希色。
 */
export function carPaintMaterial(color: PropColor): string {
  return `car_paint_${color}`;
}
export function plasticMaterial(color: PropColor): string {
  return `plastic_${color}`;
}
export function neonMaterial(color: PropColor): string {
  return `neon_${color}`;
}

/** 三个配色族：车漆（半金属高光）/ 塑料（乐高哑光）/ 霓虹（自发光） */
function propColorMaterials(): Record<string, Readonly<SurfaceSpec>> {
  const out: Record<string, Readonly<SurfaceSpec>> = {};
  for (const color of PROP_COLORS) {
    const hex = PROP_COLOR_HEX[color];
    // 车漆：金属度中等 + 粗糙度很低 = 糖果漆，SSR 下能把彩灯与地面都映出来
    out[carPaintMaterial(color)] = Object.freeze({
      color: hex,
      roughness: 0.16,
      metalness: 0.35,
    });
    // 乐高塑料：ABS 是哑光的，给高光反而不像玩具
    out[plasticMaterial(color)] = Object.freeze({ color: hex, roughness: 0.42, metalness: 0.02 });
    out[neonMaterial(color)] = Object.freeze({
      color: hex,
      roughness: 0.35,
      metalness: 0,
      emissive: hex,
      emissiveIntensity: 2.2,
    });
  }
  return out;
}

/**
 * 命名材质表。
 *
 * 色相刻意压在偏蓝的低饱和灰里（混凝土在冷光下的实感），
 * 靠灯光的暖色去制造冷暖对比，而不是把材质本身调暖。
 * 道具材质是例外：游乐场馆的彩车与彩灯必须是饱和色，见 `PROP_COLOR_HEX`。
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

  // ── 游乐场馆（碰碰车场）───────────────────────────────
  // 抛光环氧地坪：**全场最低**的粗糙度。碰碰车场的看点就是彩车与彩灯映在地上，
  // 这块地面是整个房间的反射承载面，比抛光混凝土还要再光一档。
  arena_floor_gloss: Object.freeze({ color: 0x232831, roughness: 0.1, metalness: 0.06 }),
  // 深色墙面：把彩灯的颜色衬出来。墙一旦发亮，霓虹就没有对比度了
  arena_wall_dark: Object.freeze({ color: 0x2f333c, roughness: 0.36, metalness: 0.04 }),

  // ── 道具的固定材质（与配色无关的那些）─────────────────
  rubber_black: Object.freeze({ color: 0x1b1d21, roughness: 0.72, metalness: 0.02 }),
  chrome: Object.freeze({ color: 0xb9c2cc, roughness: 0.12, metalness: 1 }),
  // 镜面球：金属度拉满 + 平面着色 → 每个刻面各自反射，SSR 的最佳展示体
  mirror_facet: Object.freeze({
    color: 0xd8dee6,
    roughness: 0.08,
    metalness: 1,
    flatShading: true,
  }),
  // 经典乐高黄（头与手恒用它，不随衣裤配色变）
  minifig_skin: Object.freeze({ color: 0xf2cd2f, roughness: 0.34, metalness: 0.02 }),
  // 假人壳体：碰撞测试假人那种哑光米灰。**故意不给它配色**——
  // 假人是道具而不是角色，一旦鲜艳就会跟车抢主体
  mannequin_shell: Object.freeze({ color: 0xb9b3a8, roughness: 0.52, metalness: 0.02 }),
  // 卡通车的虹膜：深海蓝 + 很低的粗糙度。眼睛是这套造型的全部重点，
  // 必须比车漆还亮一档才能在暗场里读出眼神
  toon_iris: Object.freeze({ color: 0x1d4e8c, roughness: 0.08, metalness: 0.1 }),
  // 观众长椅的板材
  plastic_slate: Object.freeze({ color: 0x545c66, roughness: 0.44, metalness: 0.04 }),

  // ── 自动贩卖机 ────────────────────────────────────────
  // 机身：喷粉白灰钢板。**全场唯一的浅色实体** —— 它就是靠这一点在暗场里
  // 当路标兼掩体，所以刻意比墙面亮一大截
  vending_shell: Object.freeze({ color: 0xd7dae0, roughness: 0.34, metalness: 0.18 }),
  // 货窗玻璃：本项目没有透明材质（外壳全是 DoubleSide 不透明），
  // 所以用**很深 + 很光**来演玻璃 —— SSR 会在上面映出场地，观感就成立了
  vending_glass: Object.freeze({ color: 0x14171c, roughness: 0.05, metalness: 0.25 }),
  // 柜内照明与小屏：比霓虹弱得多（neon_* 是 2.2），否则整台机器糊成一片白
  vending_glow: Object.freeze({
    color: 0xf2f6ff,
    roughness: 0.4,
    metalness: 0,
    emissive: 0xdfe9ff,
    emissiveIntensity: 0.85,
  }),

  // ── 道具配色族（按 PROP_COLORS 循环生成，见下）────────
  ...propColorMaterials(),
});

/** 查表；未命中返回 `undefined`，由调用方回落到哈希占位色 */
export function surfaceSpec(materialId: string): Readonly<SurfaceSpec> | undefined {
  return PALETTE[materialId];
}

/** 表里已定义的全部材质 id（供测试核对示例覆盖率） */
export function paletteIds(): string[] {
  return Object.keys(PALETTE);
}
