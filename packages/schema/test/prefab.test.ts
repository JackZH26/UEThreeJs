import { describe, expect, it } from 'vitest';
import {
  Id,
  PREFABS,
  PREFAB_IDS,
  PrefabIdSchema,
  PrefabKind,
  Prop,
  prefabDef,
  prefabsOfKind,
} from '../src/index.js';
import { toJsonSchemaFragments } from '../src/jsonSchema.js';

/**
 * prefab 目录的自检。
 *
 * 几何在 `packages/scene`（那边有一条测试断言"声明的 size = 实际包围盒"），
 * 这里只管**数据本身**：命名、冻结、枚举与目录不漂移、以及"写错的 prefab id
 * 必须在 schema 层就被拒"。
 */

/**
 * 从 zod 枚举取，不手写清单 —— 手写的话新增一个种类就得改这里，
 * 而"忘了改"的表现是下面那条"分完不多不少"莫名其妙地失败。
 */
const KINDS = PrefabKind.options;

describe('目录形态', () => {
  it('目录与每个条目都是冻结的 —— 防止某处改坏全局', () => {
    expect(Object.isFrozen(PREFABS)).toBe(true);
    for (const id of PREFAB_IDS) expect(Object.isFrozen(PREFABS[id]), id).toBe(true);
  });

  it('PREFAB_IDS 与目录的键完全一致且无重复', () => {
    expect([...PREFAB_IDS].sort()).toEqual(Object.keys(PREFABS).sort());
    expect(new Set(PREFAB_IDS).size).toBe(PREFAB_IDS.length);
  });

  it('每个 id 都是合法标识符（YAML 里要好读，也便于将来当 UE 资产名）', () => {
    for (const id of PREFAB_IDS) expect(Id.safeParse(id).success, id).toBe(true);
  });

  it('尺寸都是正数，note 都写了', () => {
    for (const id of PREFAB_IDS) {
      const def = prefabDef(id);
      expect(def.size.w, id).toBeGreaterThan(0);
      expect(def.size.d, id).toBeGreaterThan(0);
      expect(def.size.h, id).toBeGreaterThan(0);
      expect(def.note.length, id).toBeGreaterThan(0);
    }
  });

  it('各种类的必填参数都在：车/人有配色、彩灯有 tint、人有 pose', () => {
    for (const id of PREFAB_IDS) {
      const def = prefabDef(id);
      if (def.kind === 'bumper_car' || def.kind === 'toon_car' || def.kind === 'minifig') {
        expect(def.color, `${id} 缺 color`).toBeDefined();
      }
      if (def.kind === 'festoon') expect(def.tint, `${id} 缺 tint`).toBeDefined();
      if (def.kind === 'minifig') expect(def.pose, `${id} 缺 pose`).toBeDefined();
      // 挂载面只对"要往上放另一个道具"的复合件有意义 —— 写实碰碰车要放司机，
      // 卡通碰碰车的假人是内建的，**必须没有** mount，否则作者会照着它再叠一个人
      if (def.kind === 'bumper_car') expect(def.mount, `${id} 缺 mount`).toBeDefined();
      if (def.kind === 'toon_car') expect(def.mount, `${id} 不该有 mount`).toBeUndefined();
    }
  });

  it('prefabsOfKind 分完之后不多不少', () => {
    const total = KINDS.reduce((sum, kind) => sum + prefabsOfKind(kind).length, 0);
    expect(total).toBe(PREFAB_IDS.length);
    for (const kind of KINDS) expect(prefabsOfKind(kind).length, kind).toBeGreaterThan(0);
  });
});

describe('闭合枚举', () => {
  it('目录里的 id 全部接受', () => {
    for (const id of PREFAB_IDS) expect(PrefabIdSchema.safeParse(id).success, id).toBe(true);
  });

  it('不在目录里的 id 被拒 —— 且是在 schema 层，不需要额外的校验规则', () => {
    const parsed = Prop.safeParse({
      id: 'p',
      prefab: 'bumper_car_teal',
      at: { x: 0, y: 0, z: 0 },
    });
    expect(parsed.success).toBe(false);
    // 报错信息里应当列出可选值，作者不用去翻源码
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain('bumper_car_pink');
    }
  });

  it('JSON Schema 里带上了枚举值 —— 这是 agent 发现道具库的通道', () => {
    const room = JSON.stringify(toJsonSchemaFragments().room);
    expect(room).toContain('bumper_car_pink');
    expect(room).toContain('mirror_ball');
  });
});
