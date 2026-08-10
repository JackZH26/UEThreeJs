import type { BufferGeometry } from 'three';
import { ball, box, cyl, strut } from '../parts.js';
import { neonMaterial } from '../palette.js';
import type { PropPart } from '../propPart.js';
import type { PrefabDef, PropColor } from '@tjre/schema';

/**
 * ============================================================
 *  场馆装饰：吊顶彩灯串 / 镜面球 / 观众长椅
 * ============================================================
 *
 *  彩灯串与镜面球是**吊挂**道具（`anchor: 'top'`）：几何全部在 y ≤ 0，
 *  于是 `Prop.at` 直接写吊点（桁架底面）的高度，不用自己减去道具长度。
 */

/** 彩灯串：跨度、灯泡数、中央下垂量 */
const SPAN = 12;
const BULBS = 13;
const SAG = 0.7;
const BULB_R = 0.11;
/** 灯泡吊在电缆节点之下这么多 */
const BULB_DROP = 0.16;
const CABLE_T = 0.03;

/** 三种配色方案循环取色 —— party 是杂色，warm / cool 各两色交替 */
const FESTOON_COLORS: Readonly<Record<string, readonly PropColor[]>> = Object.freeze({
  party: ['pink', 'cyan', 'yellow', 'lime', 'purple', 'orange'],
  warm: ['yellow', 'orange'],
  cool: ['cyan', 'white'],
});

/** 抛物线下垂：两端为 0，中央为 -SAG */
function cableY(t: number): number {
  return -SAG * 4 * t * (1 - t);
}

export function buildFestoon(def: PrefabDef): PropPart[] {
  const colors = FESTOON_COLORS[def.tint ?? 'party'] ?? FESTOON_COLORS.party ?? ['white'];
  const parts: PropPart[] = [];

  const nodeAt = (i: number): { x: number; y: number; z: number } => {
    const t = i / (BULBS - 1);
    return { x: -SPAN / 2 + t * SPAN, y: cableY(t), z: 0 };
  };

  for (let i = 0; i < BULBS - 1; i++) {
    const segment = strut(nodeAt(i), nodeAt(i + 1), CABLE_T);
    if (segment !== null) parts.push({ geometry: segment, materialId: 'rubber_black' });
  }

  for (let i = 0; i < BULBS; i++) {
    const node = nodeAt(i);
    parts.push({
      geometry: box({ w: 0.05, h: 0.08, d: 0.05 }, { x: node.x, y: node.y - 0.04, z: 0 }),
      materialId: 'rubber_black',
    });
    const color = colors[i % colors.length] ?? 'white';
    parts.push({
      geometry: ball(BULB_R, { x: node.x, y: node.y - BULB_DROP, z: 0 }, 8),
      materialId: neonMaterial(color),
    });
  }

  return parts;
}

/**
 * 镜面球。
 *
 * 低多边形 + `flatShading`（材质 `mirror_facet`）= 每个刻面各自反射，
 * 金属度 1 让它成为场景里最强的 SSR 反射体 —— 碰碰车场的中心装饰就该是它。
 */
export function buildMirrorBall(_def: PrefabDef): PropPart[] {
  return [
    { geometry: cyl(0.03, 0.5, { x: 0, y: -0.25, z: 0 }, { segments: 8 }), materialId: 'chrome' },
    { geometry: ball(0.55, { x: 0, y: -1.05, z: 0 }, 14), materialId: 'mirror_facet' },
  ];
}

/** 观众长椅：三人座，靠背在 +Z（坐者朝 -Z，与所有道具的 forward 一致） */
export function buildBench(_def: PrefabDef): PropPart[] {
  const slate: BufferGeometry[] = [
    box({ w: 2.4, h: 0.08, d: 0.46 }, { x: 0, y: 0.46, z: 0 }),
    box({ w: 2.4, h: 0.34, d: 0.07 }, { x: 0, y: 0.67, z: 0.215 }),
  ];
  const legs: BufferGeometry[] = [1, -1].map((sx) =>
    box({ w: 0.1, h: 0.42, d: 0.42 }, { x: sx * 1.05, y: 0.21, z: 0 }),
  );
  return [
    ...slate.map((geometry) => ({ geometry, materialId: 'plastic_slate' })),
    ...legs.map((geometry) => ({ geometry, materialId: 'steel_grate_dark' })),
  ];
}
