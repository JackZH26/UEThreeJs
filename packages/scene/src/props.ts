import { MathUtils } from 'three';
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { PrefabDef, PrefabId, PrefabKind, Prop } from '@tjre/schema';
import { prefabDef } from '@tjre/schema';
import { surfaceSpec } from './palette.js';
import type { PrefabBuilder, PropPart } from './propPart.js';
import { buildBumperCar } from './prefabs/bumperCar.js';
import { buildToonCar } from './prefabs/toonCar.js';
import { buildMinifig } from './prefabs/minifig.js';
import { buildBench, buildFestoon, buildMirrorBall } from './prefabs/arena.js';
import { buildVending } from './prefabs/vending.js';

/**
 * ============================================================
 *  道具几何 —— Prop → 一组（几何 + 材质）
 * ============================================================
 *
 *  在此之前 `room.props` 是个**死字段**：YAML 里写了道具，几何一个都不生成
 *  （与 v0.2 之前的 `room.lights` 一模一样的处境）。这个模块把它接上。
 *
 *  ── 与 Structure 的分工 ─────────────────────────────────────
 *  Structure 带碰撞与导航语义（可站立 / 可攀爬 / 可阻挡），Prop 只是摆放物：
 *  **不进 `walkables`**。所以碰碰车不能站上去，但第一人称下会挡住去路
 *  （水平碰撞检测打的是整棵子树）—— 这正是想要的效果。
 *
 *  ── 为什么按材质合并而不是按道具合并 ────────────────────────
 *  一辆碰碰车 24 个零件、5 种材质。three 的一个 Mesh 只能有一种材质，
 *  所以按材质分组后合并成 5 个 Mesh —— 而不是 24 个。
 *  跨道具再合并能进一步降到 5 个（全场共用），但那样就没有 per-prop 的
 *  `userData.propId` 了，拾取与调试都会变难，得不偿失。
 */

const BUILDERS: Readonly<Record<PrefabKind, PrefabBuilder>> = Object.freeze({
  bumper_car: buildBumperCar,
  toon_car: buildToonCar,
  minifig: buildMinifig,
  festoon: buildFestoon,
  mirror_ball: buildMirrorBall,
  bench: buildBench,
  vending: buildVending,
});

/** 一个道具里"同材质的全部零件"合并后的结果 */
export interface PropMeshPart {
  geometry: BufferGeometry;
  materialId: string;
  /**
   * 该材质是否自发光。自发光面投影只会在地上留一块莫名的黑影
   * （与传送门同理），所以调用方应当关掉它的阴影。
   * 由调色板反查得出，不由构造器逐个零件声明 —— 免得两边不一致。
   */
  emissive: boolean;
}

export interface PropGeometryResult {
  propId: string;
  prefab: PrefabId;
  kind: PrefabKind;
  /** 已按材质合并；顺序与构造器里第一次用到该材质的顺序一致（确定性） */
  parts: PropMeshPart[];
  /** 合并前的零件数 —— 面板/测试用来确认构造器真的产出了东西 */
  partCount: number;
}

/** 按材质分组，保持首次出现顺序（确定性输出，便于逐字节比对导出产物） */
function groupByMaterial(parts: readonly PropPart[]): Map<string, BufferGeometry[]> {
  const groups = new Map<string, BufferGeometry[]>();
  for (const part of parts) {
    const existing = groups.get(part.materialId);
    if (existing === undefined) groups.set(part.materialId, [part.geometry]);
    else existing.push(part.geometry);
  }
  return groups;
}

/**
 * 生成一个道具的几何。
 *
 * 变换顺序是 **缩放 → 绕 Y 旋转 → 平移**，在合并之后统一施加。
 *
 * ⚠️ 旋转取**负号**：`rotationY = 0` 表示朝北（-Z）、增大转向东（+X），
 * 与 `lights.ts` 的 `aimDirection()` 是同一套朝向约定。而 three 的
 * `rotateY(+θ)` 会把 -Z 转到 -X（西），正好相反。有测试钉住这一点。
 */
export function buildPropGeometry(prop: Prop): PropGeometryResult | null {
  const def: PrefabDef = prefabDef(prop.prefab);
  const raw = BUILDERS[def.kind](def);
  if (raw.length === 0) return null;

  const yaw = -MathUtils.degToRad(prop.rotationY);
  const parts: PropMeshPart[] = [];

  for (const [materialId, geometries] of groupByMaterial(raw)) {
    const first = geometries[0];
    if (first === undefined) continue;
    const merged = geometries.length === 1 ? first : mergeGeometries(geometries, false);
    if (merged === null) continue;
    if (geometries.length > 1) for (const geometry of geometries) geometry.dispose();

    if (prop.scale !== 1) merged.scale(prop.scale, prop.scale, prop.scale);
    if (yaw !== 0) merged.rotateY(yaw);
    merged.translate(prop.at.x, prop.at.y, prop.at.z);
    merged.name = `prop_${prop.id}_${materialId}`;

    parts.push({
      geometry: merged,
      materialId,
      emissive: surfaceSpec(materialId)?.emissive !== undefined,
    });
  }

  if (parts.length === 0) return null;
  return { propId: prop.id, prefab: prop.prefab, kind: def.kind, parts, partCount: raw.length };
}

/**
 * 一个 prefab 会用到哪些材质 id。
 *
 * 给测试用：调色板有一条"示例关卡用到的材质都必须在表里"的覆盖检查，
 * 道具材质不像主题那样写在 YAML 里，只能这样问出来。
 */
export function prefabMaterialIds(prefab: PrefabId): string[] {
  const def = prefabDef(prefab);
  const parts = BUILDERS[def.kind](def);
  const ids = [...new Set(parts.map((part) => part.materialId))];
  for (const part of parts) part.geometry.dispose();
  return ids;
}
