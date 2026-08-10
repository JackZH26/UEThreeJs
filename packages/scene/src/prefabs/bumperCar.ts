import type { BufferGeometry } from 'three';
import { ball, box, cyl, ring, strut } from '../parts.js';
import { carPaintMaterial, neonMaterial } from '../palette.js';
import { defColor } from '../propPart.js';
import type { PropPart } from '../propPart.js';
import { bumperSkirt } from './skirt.js';
import type { PrefabDef } from '@tjre/schema';

/**
 * ============================================================
 *  碰碰车
 * ============================================================
 *
 *  参考实物：玻璃钢车壳坐在一圈厚橡胶围裙上，车头低、座椅靠背高，
 *  轮眉是发光圆环，车尾一根短天线。
 *
 *  ── 局部坐标（重要）────────────────────────────────────────
 *  车头朝 **-Z**（`rotationY = 0` 时朝北），原点在**座位中轴**上、y = 0 在地面。
 *
 *  原点刻意不放在车身几何中心：放在座位轴线上以后，"把人放进车里"就是
 *  「同一个 (x,z)、同一个 rotationY、`at.y` 写 `mount.y`」—— 作者不需要按车的
 *  朝向去算座位的世界坐标（那是必写错的三角函数）。代价是围裙前后不对称：
 *  车头在 z = -1.55，车尾在 z = +0.85。
 */

/** 围裙（橡胶保险杠）外缘 */
const HALF_W = 0.75;
const NOSE_Z = -1.55;
const TAIL_Z = 0.85;
const SKIRT_H = 0.22;
/** 围裙壁厚与圆角半径 —— 圆角用整根小圆柱填实，车壳会把内侧全挡住 */
const SKIRT_T = 0.18;
const CORNER_R = 0.25;

/** 车壳底面：坐在围裙上沿略低处，避免出现一道缝 */
const DECK_Y = 0.2;
/** 座垫上表面 = 挂载面 + 这个高度（人的胯部到脚底的距离） */
const SEAT_ABOVE_MOUNT = 0.4;

/** 橡胶围裙 —— 与卡通碰碰车共用（见 skirt.ts） */
function skirt(): BufferGeometry[] {
  return bumperSkirt({
    halfWidth: HALF_W,
    noseZ: NOSE_Z,
    tailZ: TAIL_Z,
    height: SKIRT_H,
    thickness: SKIRT_T,
    cornerRadius: CORNER_R,
  });
}

/** 车壳：两侧船帮 + 脚坑地板 + 车头 + 引擎盖 + 座垫 + 靠背 */
function shell(mountY: number): BufferGeometry[] {
  const seatTop = mountY + SEAT_ABOVE_MOUNT;
  return [
    // 两侧船帮（内缘 0.39 给乐高人的胯部 0.46 留出余量）
    box({ w: 0.36, h: 0.42, d: 1.7 }, { x: 0.57, y: 0.41, z: -0.25 }),
    box({ w: 0.36, h: 0.42, d: 1.7 }, { x: -0.57, y: 0.41, z: -0.25 }),
    // 脚坑地板：上表面**就是** def.mount.y，人的脚踩在这里
    box({ w: 0.9, h: 0.06, d: 0.95 }, { x: 0, y: mountY - 0.03, z: -0.475 }),
    // 车头低块 + 引擎盖（两块错层堆出前低后高的侧面轮廓）
    box({ w: 1.14, h: 0.3, d: 0.45 }, { x: 0, y: 0.35, z: -1.275 }),
    box({ w: 0.86, h: 0.16, d: 0.9 }, { x: 0, y: 0.56, z: -0.75 }),
    // 座垫 + 高靠背
    box({ w: 0.72, h: 0.11, d: 0.55 }, { x: 0, y: seatTop - 0.055, z: 0.225 }),
    box({ w: 1.05, h: 0.82, d: 0.35 }, { x: 0, y: 0.61, z: 0.625 }),
  ];
}

/** 发光件：4 个轮眉圆环（车身色）+ 2 盏车头灯（白） */
function lights(): { arches: BufferGeometry[]; headlights: BufferGeometry[] } {
  const arches: BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    for (const z of [-0.9, 0.3]) {
      // 环面朝左右；半径 + 管径 = 0.745，刚好不超出围裙外缘
      arches.push(ring(0.2, 0.045, { x: sx * 0.7, y: 0.46, z }, 'x'));
    }
  }
  const headlights = [1, -1].map((sx) =>
    cyl(0.11, 0.08, { x: sx * 0.32, y: 0.38, z: -1.5 }, { axis: 'z', segments: 12 }),
  );
  return { arches, headlights };
}

/** 镀铬件：转向柱 + 天线 + 天线球 */
function chromeParts(mountY: number): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const column = strut(
    { x: 0, y: mountY + SEAT_ABOVE_MOUNT, z: -0.34 },
    { x: 0, y: 0.93, z: -0.3 },
    0.05,
  );
  if (column !== null) parts.push(column);
  parts.push(cyl(0.025, 0.8, { x: -0.6, y: 1.02, z: 0.6 }, { segments: 8 }));
  parts.push(ball(0.06, { x: -0.6, y: 1.45, z: 0.6 }, 8));
  return parts;
}

export function buildBumperCar(def: PrefabDef): PropPart[] {
  const color = defColor(def);
  const mountY = def.mount?.y ?? DECK_Y;
  const { arches, headlights } = lights();

  const parts: PropPart[] = [];
  const push = (geometries: BufferGeometry[], materialId: string): void => {
    for (const geometry of geometries) parts.push({ geometry, materialId });
  };

  push(skirt(), 'rubber_black');
  push(shell(mountY), carPaintMaterial(color));
  push(arches, neonMaterial(color));
  // 车头灯恒为白，不随车身色变 —— 实物就是白光，跟着车色变会像玩具
  push(headlights, neonMaterial('white'));
  push(chromeParts(mountY), 'chrome');
  // 方向盘：黑橡胶，微微后倾，正好落在乐高人伸出的手上
  push([ring(0.15, 0.032, { x: 0, y: 0.95, z: -0.3 }, 'z', -0.4)], 'rubber_black');

  return parts;
}
