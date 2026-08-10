import {
  AmbientLight,
  Color,
  MathUtils,
  PointLight,
  RectAreaLight,
  SpotLight,
  Vector3,
} from 'three';
import type { Light as ThreeLight, Object3D } from 'three';
import type { Light, Room } from '@tjre/schema';

/**
 * ============================================================
 *  房间灯光 —— schema 的 Light → three.js 灯光实例
 * ============================================================
 *
 *  在此之前 `room.lights` 是个**死字段**：YAML 里写了灯，几何照样生成，
 *  但渲染时一盏都没有 —— 视口里的光全部来自编辑器硬编码的那两盏。
 *  于是"给房间布光"这件事在编辑器里根本不可见。这个模块把它接上。
 *
 *  ── 单位约定 ────────────────────────────────────────────
 *  three.js 自 r155 起默认物理光照单位：
 *    · point / spot → 坎德拉（candela）
 *    · area         → 尼特（nit）
 *    · ambient      → 无量纲倍数
 *  与 schema 的注释一致。**这些数值与 UE 的换算表要到 Phase 5 用标定场实测**，
 *  现在的数量级是目视调出来的，不要当成最终值。
 *
 *  ── 朝向 ────────────────────────────────────────────────
 *  `rotationY`（绕 Y，度）+ `tiltX`（俯仰，度）只对 spot / area 有意义。
 *  spot 用 `target` 表达朝向，所以这里把方向向量转成一个目标点；
 *  area 直接用 `lookAt`。tiltX 为 0 时默认朝下 —— 天花板灯是最常见的情形，
 *  让"不写朝向"落在最有用的默认上。
 *
 *  ── 产出坐标系 ──────────────────────────────────────────
 *  灯光位于**房间局部坐标系**（原点 = 地面矩形中心），与 shell / structures 一致。
 *  房间永远在原点不旋转，所以局部坐标即世界坐标。
 */

/** spot / area 的目标点距光源多远 —— 只用于表达方向，数值本身不影响衰减 */
const AIM_DISTANCE = 10;

/**
 * 由 `rotationY` / `tiltX` 求朝向单位向量。
 *
 * `tiltX = 0` → 正下方（0, -1, 0）；`tiltX = 90` → 水平。
 * `rotationY` 决定水平朝向（0 = 朝北即 -Z，与 schema 的坐标约定一致）。
 */
function aimDirection(rotationY: number, tiltX: number): Vector3 {
  const yaw = MathUtils.degToRad(rotationY);
  const tilt = MathUtils.degToRad(tiltX);
  // tilt=0 → 竖直向下；tilt=90 → 水平
  const horizontal = Math.sin(tilt);
  const vertical = -Math.cos(tilt);
  return new Vector3(horizontal * Math.sin(yaw), vertical, -horizontal * Math.cos(yaw)).normalize();
}

export interface BuiltLight {
  lightId: string;
  light: ThreeLight;
  /**
   * spot 的 `target` 是一个独立 Object3D，**必须一起加进场景图**，
   * 否则它的世界矩阵不更新、朝向不生效。其余灯型为 null。
   */
  target: Object3D | null;
}

/** 把一个 schema Light 变成 three 灯光。返回 null 表示该类型暂不支持。 */
export function buildLight(light: Light): BuiltLight | null {
  const color = new Color(light.color ?? 0xffffff);

  switch (light.type) {
    case 'ambient': {
      // ambient 忽略 at / 朝向；强度按倍数而非坎德拉
      const l = new AmbientLight(color, light.intensity ?? 0.3);
      l.name = `light:${light.id}`;
      return { lightId: light.id, light: l, target: null };
    }

    case 'point': {
      const l = new PointLight(color, light.intensity ?? 500, light.range ?? 0, 2);
      l.position.set(light.at.x, light.at.y, light.at.z);
      l.castShadow = light.castShadow;
      // 点光是 cube shadow map（6 面），比方向光贵得多 —— 分辨率压低。
      // 房间尺度下 512 足够：点光多用于氛围补光，不承担主要造型阴影。
      l.shadow.mapSize.set(512, 512);
      l.shadow.bias = -0.002;
      l.shadow.normalBias = 0.05;
      l.name = `light:${light.id}`;
      return { lightId: light.id, light: l, target: null };
    }

    case 'spot': {
      const l = new SpotLight(
        color,
        light.intensity ?? 800,
        light.range ?? 0,
        MathUtils.degToRad(light.coneAngle ?? 30),
        0.35, // penumbra：硬边聚光在建筑内景里很假，给一点软边
        2,
      );
      l.position.set(light.at.x, light.at.y, light.at.z);
      const dir = aimDirection(light.rotationY, light.tiltX);
      l.target.position.copy(l.position).addScaledVector(dir, AIM_DISTANCE);
      l.castShadow = light.castShadow;
      l.shadow.mapSize.set(1024, 1024);
      l.shadow.bias = -0.001;
      l.shadow.normalBias = 0.03;
      l.name = `light:${light.id}`;
      return { lightId: light.id, light: l, target: l.target };
    }

    case 'area': {
      // RectAreaLight 不投影（three 不支持），castShadow 对它无效
      const size = light.size ?? { w: 4, h: 4 };
      const l = new RectAreaLight(color, light.intensity ?? 20, size.w, size.h);
      l.position.set(light.at.x, light.at.y, light.at.z);
      const dir = aimDirection(light.rotationY, light.tiltX);
      l.lookAt(l.position.x + dir.x, l.position.y + dir.y, l.position.z + dir.z);
      l.name = `light:${light.id}`;
      return { lightId: light.id, light: l, target: null };
    }
  }
}

export interface BuiltLights {
  lights: BuiltLight[];
  /** 实际开启阴影的灯数 —— 便于在面板上暴露开销 */
  shadowCasters: number;
}

/** 构建房间的全部灯光 */
export function buildLights(room: Room): BuiltLights {
  const lights: BuiltLight[] = [];
  let shadowCasters = 0;
  for (const light of room.lights) {
    const built = buildLight(light);
    if (built === null) continue;
    lights.push(built);
    if ((built.light as { castShadow?: boolean }).castShadow === true) shadowCasters++;
  }
  return { lights, shadowCasters };
}
