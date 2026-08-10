import type { BufferGeometry } from 'three';
import { box } from '../parts.js';
import { plasticMaterial } from '../palette.js';
import type { PropPart } from '../propPart.js';
import type { PrefabDef, PropColor } from '@tjre/schema';

/**
 * ============================================================
 *  自动贩卖机
 * ============================================================
 *
 *  参考实物：白灰喷粉机身，左三分之二是深色玻璃货窗（里面五层货架、
 *  柜内打光），右三分之一是黑色操作柱，柱子外沿一圈**发光灯带**，
 *  上面有小屏 + 键盘 + 读卡器；底部一圈黑色底座，取货口在货窗下方。
 *
 *  ── 局部坐标 ────────────────────────────────────────────────
 *  货窗朝 **-Z**（`rotationY = 0` 时面朝北），y = 0 在底面（`anchor: 'base'`）。
 *  原点在机身平面中心，所以**背面贴墙**时把 `at` 放在离墙 0.43m 处即可。
 *
 *  ── 为什么值得做这么多零件 ──────────────────────────────────
 *  它在关卡里的作用是**掩体**，玩家会贴着它蹲、绕着它打，是少数会被近距离
 *  长时间盯着看的道具。而且这间房是暗场，一台自带柜内照明的浅色机器同时还是
 *  路标。整机 40 个零件按材质合并成 8 个 mesh，代价可以接受。
 */

/** 机身外形（不含向前凸出的玻璃与操作柱） */
const W = 1.05;
const D = 0.82;
const H = 1.95;
/** 黑色底座高度 */
const PLINTH_H = 0.12;
/** 前脸零件贴在机身正面（z = -D/2）之外这么多，避免与机身共面 z-fighting */
const FRONT = D / 2 + 0.02;

/** 玻璃货窗（机身左侧三分之二） */
const GLASS_X0 = -0.48;
const GLASS_X1 = 0.14;
const GLASS_Y0 = 0.5;
const GLASS_Y1 = 1.82;

/** 货架层数与每层货品数 */
const SHELVES = 5;
const ITEMS_PER_SHELF = 5;
/** 货品循环用的三个色 —— 三色就够读出"一堆花花绿绿的零食饮料" */
const ITEM_COLORS: readonly PropColor[] = ['red', 'yellow', 'cyan'];

const center = (a: number, b: number): number => (a + b) / 2;

/** 机身 + 底座 */
function cabinet(): { shell: BufferGeometry[]; black: BufferGeometry[] } {
  return {
    shell: [box({ w: W, h: H - PLINTH_H, d: D }, { x: 0, y: PLINTH_H + (H - PLINTH_H) / 2, z: 0 })],
    black: [box({ w: W, h: PLINTH_H, d: D }, { x: 0, y: PLINTH_H / 2, z: 0 })],
  };
}

/** 柜内：背光板 + 五层货架 + 货品（货品按颜色分组返回） */
function interior(): {
  glow: BufferGeometry[];
  black: BufferGeometry[];
  items: BufferGeometry[][];
} {
  const glassW = GLASS_X1 - GLASS_X0;
  const midX = center(GLASS_X0, GLASS_X1);
  // 背光板与货架都退到机身内部，透过深色玻璃看进去
  const glow = [
    box(
      { w: glassW - 0.04, h: GLASS_Y1 - GLASS_Y0 - 0.04, d: 0.02 },
      { x: midX, y: center(GLASS_Y0, GLASS_Y1), z: -0.28 },
    ),
  ];
  const black: BufferGeometry[] = [];
  const items: BufferGeometry[][] = ITEM_COLORS.map(() => []);

  const step = (GLASS_Y1 - GLASS_Y0) / SHELVES;
  for (let s = 0; s < SHELVES; s++) {
    const shelfY = GLASS_Y0 + step * s + 0.03;
    black.push(box({ w: glassW - 0.06, h: 0.025, d: 0.24 }, { x: midX, y: shelfY, z: -0.34 }));
    for (let i = 0; i < ITEMS_PER_SHELF; i++) {
      // 沿货架均分，两端各留半格，看起来是"摆满了"而不是"靠边站"
      const t = (i + 0.5) / ITEMS_PER_SHELF;
      const bucket = items[(s + i) % ITEM_COLORS.length];
      bucket?.push(
        box(
          { w: 0.085, h: 0.15, d: 0.09 },
          { x: GLASS_X0 + 0.03 + t * (glassW - 0.06), y: shelfY + 0.09, z: -0.34 },
        ),
      );
    }
  }
  return { glow, black, items };
}

/** 前脸：玻璃、取货口、操作柱、灯带、小屏 */
function frontFace(): { glass: BufferGeometry[]; black: BufferGeometry[]; glow: BufferGeometry[] } {
  const columnX = 0.33;
  return {
    glass: [
      box(
        { w: GLASS_X1 - GLASS_X0, h: GLASS_Y1 - GLASS_Y0, d: 0.03 },
        { x: center(GLASS_X0, GLASS_X1), y: center(GLASS_Y0, GLASS_Y1), z: -FRONT },
      ),
    ],
    black: [
      // 取货口
      box({ w: 0.36, h: 0.15, d: 0.03 }, { x: -0.25, y: 0.31, z: -FRONT }),
      // 操作柱
      box({ w: 0.36, h: 1.6, d: 0.04 }, { x: columnX, y: 0.99, z: -FRONT - 0.01 }),
      // 键盘（压在操作柱上，略微再凸一点才看得见）
      box({ w: 0.14, h: 0.2, d: 0.02 }, { x: columnX, y: 0.95, z: -FRONT - 0.04 }),
    ],
    glow: [
      // 操作柱外沿的 U 形灯带：左竖 + 上下两横
      box({ w: 0.035, h: 1.6, d: 0.03 }, { x: 0.145, y: 0.99, z: -FRONT - 0.015 }),
      box({ w: 0.4, h: 0.035, d: 0.03 }, { x: 0.33, y: 1.79, z: -FRONT - 0.015 }),
      box({ w: 0.4, h: 0.035, d: 0.03 }, { x: 0.33, y: 0.19, z: -FRONT - 0.015 }),
      // 小屏
      box({ w: 0.16, h: 0.1, d: 0.02 }, { x: columnX, y: 1.32, z: -FRONT - 0.04 }),
    ],
  };
}

export function buildVending(_def: PrefabDef): PropPart[] {
  const body = cabinet();
  const inner = interior();
  const front = frontFace();

  const parts: PropPart[] = [];
  const push = (geometries: readonly BufferGeometry[], materialId: string): void => {
    for (const geometry of geometries) parts.push({ geometry, materialId });
  };

  push(body.shell, 'vending_shell');
  push([...body.black, ...inner.black, ...front.black], 'rubber_black');
  push(front.glass, 'vending_glass');
  push([...inner.glow, ...front.glow], 'vending_glow');
  inner.items.forEach((bucket, i) => {
    const color = ITEM_COLORS[i];
    if (color !== undefined) push(bucket, plasticMaterial(color));
  });

  return parts;
}
