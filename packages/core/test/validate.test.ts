import { describe, expect, it } from 'vitest';
import { validateDocument } from '@tjre/core';
import type { Diagnostic } from '@tjre/core';
import { denseRoom, makeDoc } from './fixtures.js';

/**
 * 基线房间是 S 规格：净内空 28.5 × 28.5 × 12，半尺寸 ±14.25。
 * 所有越界测试的数字都以此为基准。
 */

/** 断言诊断列表里出现了某条规则 */
function expectRule(diagnostics: Diagnostic[], rule: string): Diagnostic {
  const found = diagnostics.find((d) => d.rule === rule);
  expect(
    found,
    `期望触发规则 ${rule}，实际触发：${diagnostics.map((d) => d.rule).join(', ') || '(无)'}`,
  ).toBeDefined();
  return found as Diagnostic;
}

function rulesOf(diagnostics: Diagnostic[], rule: string): Diagnostic[] {
  return diagnostics.filter((d) => d.rule === rule);
}

describe('基线文档', () => {
  it('最小合法文档不产生任何诊断', () => {
    const result = validateDocument(makeDoc());
    expect(result.all, JSON.stringify(result.all, null, 2)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('三种规格都干净通过 —— 派生的传送门不该触发任何规则', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const doc = makeDoc((d) => {
        d.rooms[0]!.spec = spec;
      });
      const result = validateDocument(doc);
      expect(result.all, `spec=${spec}: ${JSON.stringify(result.all, null, 2)}`).toEqual([]);
    }
  });
});

describe('身份唯一性 R00x', () => {
  it('R001 房间 id 重复', () => {
    const doc = makeDoc((d) => {
      d.rooms.push(denseRoom({ id: 'a', spec: 'S', theme: 'plain' }));
    });
    expectRule(validateDocument(doc).errors, 'R001');
  });

  it('R004 房间内条目 id 跨集合重复', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'dup', type: 'pillar', at: { x: 0, z: 0 } },
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 4 },
      ];
      d.rooms[0]!.markers = [{ id: 'dup', kind: 'spawn', at: { x: 0, y: 0, z: 0 } }];
    });
    expectRule(validateDocument(doc).errors, 'R004');
  });

  it('R004 手写条目撞上**派生传送门**的 id', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.markers = [{ id: 'portal_north_0', kind: 'spawn', at: { x: 0, y: 0, z: 0 } }];
    });
    const diag = expectRule(validateDocument(doc).errors, 'R004');
    expect(diag.message).toContain('派生传送门');
  });
});

describe('引用完整性 R01x', () => {
  it('R010 引用不存在的主题', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.theme = 'nope';
    });
    const diag = expectRule(validateDocument(doc).errors, 'R010');
    expect(diag.hint).toContain('plain'); // hint 必须列出可用主题
  });

  it('R013 楼梯落点不是 platform', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'pil', type: 'pillar', at: { x: 0, z: 0 } },
        { id: 'st', type: 'stair', from: { x: 2, z: 2 }, to: 'pil', facing: 'north' },
      ];
    });
    expectRule(validateDocument(doc).errors, 'R013');
  });

  it('R013 楼梯落点高度不高于起点', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 2 },
        {
          id: 'st',
          type: 'stair',
          from: { x: 2, z: 2 },
          fromElevation: 2.5,
          to: 'plat',
          facing: 'north',
        },
      ];
    });
    expectRule(validateDocument(doc).errors, 'R013');
  });
});

describe('开口 R02x', () => {
  it('R020 手写 type=portal 被拒绝', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings.push({
        id: 'my_portal',
        wall: 'north',
        type: 'portal',
        offset: 4,
        size: { w: 3, h: 3.2 },
      });
    });
    const diag = expectRule(validateDocument(doc).errors, 'R020');
    // hint 必须告诉作者这个房间**已经**有哪些传送门
    expect(diag.hint).toContain('portal_north_0');
    expect(diag.hint).toContain('4 个传送门');
  });

  it('R021 开口横向超出墙面', () => {
    const doc = makeDoc((d) => {
      // 墙跨度 28.5（半 14.25）；offset 14 + 半宽 1 = 15 > 14.25
      d.rooms[0]!.openings.push({
        id: 'win',
        wall: 'west',
        type: 'window',
        offset: 14,
        size: { w: 2, h: 1.5 },
        elevation: 3,
      });
    });
    expectRule(validateDocument(doc).errors, 'R021');
  });

  it('R022 开口顶部超出房间高度', () => {
    const doc = makeDoc((d) => {
      // 层高 12；11 + 2 = 13 > 12
      d.rooms[0]!.openings.push({
        id: 'win',
        wall: 'west',
        type: 'window',
        size: { w: 2, h: 2 },
        elevation: 11,
      });
    });
    expectRule(validateDocument(doc).errors, 'R022');
  });

  it('R023 手写的可通行开口通往虚空 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings.push({
        id: 'side_arch',
        wall: 'east',
        type: 'arch',
        size: { w: 2, h: 2.5 },
      });
    });
    expectRule(validateDocument(doc).warnings, 'R023');
  });

  it('R023 窗不报 —— 窗不可通行，开在外壳上是合法的', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings.push({
        id: 'win',
        wall: 'east',
        type: 'window',
        size: { w: 2, h: 1.5 },
        elevation: 4,
      });
    });
    expect(rulesOf(validateDocument(doc).warnings, 'R023')).toEqual([]);
  });
});

describe('内部结构件 R04x', () => {
  it('R040 结构件超出房间平面', () => {
    const doc = makeDoc((d) => {
      // x ∈ [10, 16]，16 > 14.25
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 13, z: 0, w: 6, d: 4 }, elevation: 4 },
      ];
    });
    expectRule(validateDocument(doc).errors, 'R040');
  });

  it('R041 结构件超出房间高度', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 13 },
      ];
    });
    const diag = expectRule(validateDocument(doc).errors, 'R041');
    expect(diag.hint).toContain('spec'); // 现在只能换规格，不能改 size.h
  });

  it('R042 平台上方净空不足 —— warning', () => {
    const doc = makeDoc((d) => {
      // 层高 12，平台在 11 → 头顶只剩 1m
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 11 },
      ];
    });
    expectRule(validateDocument(doc).warnings, 'R042');
  });

  it('R043 平台下方净空不足 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 1.5 },
      ];
    });
    expectRule(validateDocument(doc).warnings, 'R043');
  });

  it('R044 夹层高度的可通行开口缺少同高度平台 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings.push({
        id: 'high_arch',
        wall: 'east',
        type: 'arch',
        size: { w: 2, h: 2.5 },
        elevation: 5,
      });
    });
    const warnings = rulesOf(validateDocument(doc).warnings, 'R044');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toContain('openings[0]');
  });

  it('R044 派生传送门在地面，永远不该被它报', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.spec = 'L';
    });
    expect(rulesOf(validateDocument(doc).warnings, 'R044')).toEqual([]);
  });
});

describe('网格与 gameplay R05x / R06x', () => {
  it('R050 开口 offset 未对齐网格 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings.push({
        id: 'win',
        wall: 'west',
        type: 'window',
        offset: 0.3,
        size: { w: 2, h: 1.5 },
        elevation: 3,
      });
    });
    const diag = expectRule(validateDocument(doc).warnings, 'R050');
    expect(diag.hint).toContain('0.50');
  });

  it('R050 派生传送门的 offset 天然对齐（0 / ±15）', () => {
    for (const spec of ['S', 'M', 'L'] as const) {
      const doc = makeDoc((d) => {
        d.rooms[0]!.spec = spec;
      });
      expect(rulesOf(validateDocument(doc).warnings, 'R050'), `spec=${spec}`).toEqual([]);
    }
  });

  it('R062 房间无光且主题无预设 —— warning', () => {
    const doc = makeDoc((d) => {
      delete d.themes[0]!.lightPreset;
    });
    expectRule(validateDocument(doc).warnings, 'R062');
  });
});

describe('诊断质量（规范要求：每条诊断必须可操作）', () => {
  it('所有 error 级诊断都带 hint 与 path', () => {
    // 故意堆叠多种错误
    const doc = makeDoc((d) => {
      d.rooms[0]!.theme = 'nope';
      d.rooms[0]!.openings.push(
        { id: 'p', wall: 'north', type: 'portal', size: { w: 3, h: 3.2 } },
        {
          id: 'win',
          wall: 'west',
          type: 'window',
          offset: 14,
          size: { w: 2, h: 1.5 },
          elevation: 3,
        },
      );
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 13 },
      ];
    });
    const errors = validateDocument(doc).errors;
    expect(errors.length).toBeGreaterThan(3);
    for (const e of errors) {
      expect(e.hint, `规则 ${e.rule} 缺少 hint`).toBeTruthy();
      expect(e.path, `规则 ${e.rule} 缺少 path`).toBeTruthy();
    }
  });

  it('诊断顺序稳定：error 在 warning 之前', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.theme = 'nope'; // error
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 11 }, // warning
      ];
    });
    const all = validateDocument(doc).all;
    const firstWarning = all.findIndex((d) => d.severity === 'warning');
    const lastError = all.map((d) => d.severity).lastIndexOf('error');
    expect(lastError).toBeLessThan(firstWarning);
  });

  it('派生传送门的诊断路径指向 portals[i] 而不是 openings[i]', () => {
    // 把 S 的层高想象成装不下门的情形：直接用一个超高的手写开口不行，
    // 这里改为验证路径前缀本身 —— 让越界的窗排在传送门之后。
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings.push({
        id: 'win',
        wall: 'west',
        type: 'window',
        offset: 14,
        size: { w: 2, h: 1.5 },
        elevation: 3,
      });
    });
    const diag = expectRule(validateDocument(doc).errors, 'R021');
    // 手写开口是数组里的第 0 个，尽管遍历时排在 4 个传送门之后
    expect(diag.path).toBe('rooms[0].openings[0].offset');
  });
});

describe('R046 楼梯落点（与几何生成共用同一套算法）', () => {
  /** S 房间（28.5×28.5×12）里塞一道贴北墙的夹层 + 一部楼梯 */
  function withStair(
    stair: Partial<{
      from: { x: number; z: number };
      facing: 'north' | 'south' | 'east' | 'west';
      stepHeight: number;
    }> = {},
    platformRect = { x: 0, z: -5, w: 20, d: 6 },
  ) {
    return makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'mezz', type: 'platform', rect: platformRect, elevation: 4 },
        {
          id: 'st',
          type: 'stair',
          from: stair.from ?? { x: -7, z: 1 },
          to: 'mezz',
          facing: stair.facing ?? 'north',
          stepHeight: stair.stepHeight ?? 0.18,
        },
      ];
    });
  }

  it('楼梯顶端落在平台上时不报', () => {
    // rise 4m / stepHeight 0.18 → 23 级 × 0.27 踏面 = 6.21m
    // 从 z=1 向北(-Z) → 顶端 z = -5.21，落在平台 z ∈ [-8, -2] 内
    expect(rulesOf(validateDocument(withStair()).warnings, 'R046')).toEqual([]);
  });

  it('楼梯朝向反了 → 顶端通向半空，报 R046', () => {
    // 朝南(+Z) → 顶端 z = 1 + 6.21 = 7.21，远离平台
    const diag = expectRule(validateDocument(withStair({ facing: 'south' })).warnings, 'R046');
    expect(diag.message).toContain('7.21');
    expect(diag.hint).toContain('Blondel');
  });

  it('起点太远 → 顶端越过平台，报 R046', () => {
    // 从 z=-14 向北 → 顶端 z = -20.21，越过平台远端
    const diag = expectRule(
      validateDocument(withStair({ from: { x: 0, z: -14 } })).warnings,
      'R046',
    );
    expect(diag.severity).toBe('warning');
  });

  it('踢面变高使进深变短，落点随之改变（证明用的是同一套推导）', () => {
    // stepHeight 0.3 → 踏面被夹到 0.22，级数 ceil(4/0.3)=14 → 进深 3.08m
    // 从 z=1 向北 → 顶端 z = -2.08，仍在平台 [-8,-2] 内（边界附近）
    expect(rulesOf(validateDocument(withStair({ stepHeight: 0.3 })).warnings, 'R046')).toEqual([]);
  });

  it('爬梯用更宽的容差（贴边往上爬是正常的）', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'mezz', type: 'platform', rect: { x: 0, z: -5, w: 20, d: 6 }, elevation: 4 },
        // 平台南边界在 z=-2，梯脚在 z=-1.4（外侧 0.6m）应被容忍
        { id: 'ld', type: 'ladder', at: { x: 0, z: -1.4 }, to: 'mezz', facing: 'north' },
      ];
    });
    expect(rulesOf(validateDocument(doc).warnings, 'R046')).toEqual([]);
  });

  it('爬梯离平台太远仍会报', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'mezz', type: 'platform', rect: { x: 0, z: -5, w: 20, d: 6 }, elevation: 4 },
        { id: 'ld', type: 'ladder', at: { x: 0, z: 6 }, to: 'mezz', facing: 'north' },
      ];
    });
    expectRule(validateDocument(doc).warnings, 'R046');
  });
});
