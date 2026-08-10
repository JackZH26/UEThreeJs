import { describe, expect, it } from 'vitest';
import { AmbientLight, MathUtils, PointLight, RectAreaLight, SpotLight } from 'three';
import type { Vector3 } from 'three';
import { Room } from '@tjre/schema';
import type { Light } from '@tjre/schema';
import { buildLight, buildLights } from '@tjre/scene';

/**
 * `room.lights` 在 v0.2 之前是个死字段（写了不渲染）。这些测试锁死映射关系，
 * 免得它再次悄悄失效 —— 那种失效不报错，只是房间变黑。
 */

function light(overrides: Partial<Light> & Pick<Light, 'id' | 'type'>): Light {
  return Room.parse({
    id: 'r',
    spec: 'S',
    theme: 't',
    lights: [{ at: { x: 0, y: 0, z: 0 }, ...overrides }],
  }).lights[0] as Light;
}

describe('灯型映射', () => {
  it('point → PointLight，range 映射到 distance', () => {
    const built = buildLight(
      light({ id: 'p', type: 'point', at: { x: 1, y: 2, z: 3 }, intensity: 700, range: 18 }),
    );
    expect(built).not.toBeNull();
    expect(built?.light).toBeInstanceOf(PointLight);
    const l = built?.light as PointLight;
    expect(l.intensity).toBe(700);
    expect(l.distance).toBe(18);
    expect(l.decay).toBe(2); // 物理平方反比
    expect(l.position.toArray()).toEqual([1, 2, 3]);
  });

  it('spot → SpotLight，coneAngle 转弧度映射到 angle', () => {
    const built = buildLight(light({ id: 's', type: 'spot', coneAngle: 24, range: 30 }));
    const l = built?.light as SpotLight;
    expect(l).toBeInstanceOf(SpotLight);
    expect(l.angle).toBeCloseTo(MathUtils.degToRad(24), 6);
    expect(l.distance).toBe(30);
    expect(l.penumbra).toBeGreaterThan(0); // 硬边聚光在建筑内景里很假
  });

  it('area → RectAreaLight，size 映射到宽高', () => {
    const built = buildLight(light({ id: 'a', type: 'area', size: { w: 6, h: 3 } }));
    const l = built?.light as RectAreaLight;
    expect(l).toBeInstanceOf(RectAreaLight);
    expect(l.width).toBe(6);
    expect(l.height).toBe(3);
  });

  it('ambient → AmbientLight，忽略位置', () => {
    const built = buildLight(
      light({ id: 'amb', type: 'ambient', at: { x: 9, y: 9, z: 9 }, intensity: 0.4 }),
    );
    const l = built?.light as AmbientLight;
    expect(l).toBeInstanceOf(AmbientLight);
    expect(l.intensity).toBe(0.4);
  });

  it('color 覆盖生效，未指定则为白', () => {
    const tinted = buildLight(light({ id: 'p', type: 'point', color: '#ff8800' }));
    expect((tinted?.light as PointLight).color.getHexString()).toBe('ff8800');
    const plain = buildLight(light({ id: 'p2', type: 'point' }));
    expect((plain?.light as PointLight).color.getHexString()).toBe('ffffff');
  });
});

describe('朝向', () => {
  /** spot 用 target 表达朝向；这里从 position→target 反推方向向量 */
  function spotDirection(rotationY: number, tiltX: number): Vector3 {
    const built = buildLight(
      light({ id: 's', type: 'spot', at: { x: 0, y: 10, z: 0 }, rotationY, tiltX }),
    );
    const l = built?.light as SpotLight;
    return l.target.position.clone().sub(l.position).normalize();
  }

  it('tiltX = 0 → 正下方（天花板灯是最常见的情形，所以是默认）', () => {
    const dir = spotDirection(0, 0);
    expect(dir.x).toBeCloseTo(0, 5);
    expect(dir.y).toBeCloseTo(-1, 5);
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it('tiltX = 90 → 水平，rotationY = 0 时朝北(-Z)', () => {
    const dir = spotDirection(0, 90);
    expect(dir.y).toBeCloseTo(0, 5);
    expect(dir.z).toBeCloseTo(-1, 5);
  });

  it('rotationY = 90 且水平 → 朝东(+X)，与 schema 的坐标约定一致', () => {
    const dir = spotDirection(90, 90);
    expect(dir.x).toBeCloseTo(1, 5);
    expect(dir.z).toBeCloseTo(0, 5);
  });

  it('spot 带回 target —— 调用方必须把它也加进场景图', () => {
    const built = buildLight(light({ id: 's', type: 'spot' }));
    expect(built?.target).not.toBeNull();
    // 其余灯型没有 target
    expect(buildLight(light({ id: 'p', type: 'point' }))?.target).toBeNull();
  });
});

describe('阴影', () => {
  it('castShadow 被尊重', () => {
    expect(
      (buildLight(light({ id: 'p', type: 'point', castShadow: true }))?.light as PointLight)
        .castShadow,
    ).toBe(true);
    expect(
      (buildLight(light({ id: 'p', type: 'point', castShadow: false }))?.light as PointLight)
        .castShadow,
    ).toBe(false);
  });

  it('点光的阴影贴图刻意压小 —— cube shadow map 是 6 面，很贵', () => {
    const l = buildLight(light({ id: 'p', type: 'point', castShadow: true }))?.light as PointLight;
    expect(l.shadow.mapSize.width).toBeLessThanOrEqual(512);
  });

  it('buildLights 统计投影灯数', () => {
    const room = Room.parse({
      id: 'r',
      spec: 'M',
      theme: 't',
      lights: [
        { id: 'a', type: 'point', at: { x: 0, y: 5, z: 0 }, castShadow: true },
        { id: 'b', type: 'point', at: { x: 5, y: 5, z: 0 }, castShadow: false },
        { id: 'c', type: 'ambient', at: { x: 0, y: 0, z: 0 } },
      ],
    });
    const built = buildLights(room);
    expect(built.lights).toHaveLength(3);
    expect(built.shadowCasters).toBe(1);
  });

  it('没有灯时返回空结果，不抛错', () => {
    const built = buildLights(Room.parse({ id: 'r', spec: 'S', theme: 't' }));
    expect(built.lights).toEqual([]);
    expect(built.shadowCasters).toBe(0);
  });
});
