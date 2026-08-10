import { describe, expect, it } from 'vitest';
import { validateDocument } from '@tjre/core';
import type { Diagnostic } from '@tjre/core';
import { makeDoc } from './fixtures.js';

/** 断言诊断列表里出现了某条规则 */
function expectRule(diagnostics: Diagnostic[], rule: string): Diagnostic {
  const found = diagnostics.find((d) => d.rule === rule);
  expect(
    found,
    `期望触发规则 ${rule}，实际触发：${diagnostics.map((d) => d.rule).join(', ') || '(无)'}`,
  ).toBeDefined();
  // 每条诊断都必须可操作 —— hint 是给 AI agent 自我修正用的
  return found as Diagnostic;
}

describe('基线文档', () => {
  it('最小合法文档不产生任何诊断', () => {
    const result = validateDocument(makeDoc());
    expect(result.all, JSON.stringify(result.all, null, 2)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('身份唯一性 R00x', () => {
  it('R001 房间 id 重复', () => {
    const doc = makeDoc((d) => {
      d.rooms[1]!.id = 'a';
    });
    expectRule(validateDocument(doc).errors, 'R001');
  });

  it('R004 房间内条目 id 跨集合重复', () => {
    const doc = makeDoc((d) => {
      // 与同房间的 opening 撞名
      d.rooms[0]!.markers = [{ id: 'door_n', kind: 'spawn', at: { x: 0, y: 0, z: 0 } }];
    });
    expectRule(validateDocument(doc).errors, 'R004');
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

  it('R011 连接引用不存在的房间', () => {
    const doc = makeDoc((d) => {
      d.connections[0]!.to = 'ghost.door_s';
    });
    expectRule(validateDocument(doc).errors, 'R011');
  });

  it('R012 连接引用不存在的开口', () => {
    const doc = makeDoc((d) => {
      d.connections[0]!.to = 'b.no_such_door';
    });
    expectRule(validateDocument(doc).errors, 'R012');
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
  it('R020 doorCount 与实际门数不符', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.doorCount = 3;
    });
    const diag = expectRule(validateDocument(doc).errors, 'R020');
    expect(diag.hint).toContain('1'); // hint 应给出正确值
  });

  it('R020 window 不计入 doorCount', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings.push({
        id: 'win',
        wall: 'west',
        type: 'window',
        size: { w: 2, h: 1 },
        elevation: 2,
      });
      // doorCount 仍为 1 —— 窗不该被计入
    });
    const errors = validateDocument(doc).errors;
    expect(errors.filter((d) => d.rule === 'R020')).toEqual([]);
  });

  it('R021 开口横向超出墙面', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings[0]!.offset = 3.8; // 8m 墙，半宽 4，门宽 1.5 → 越界
    });
    expectRule(validateDocument(doc).errors, 'R021');
  });

  it('R022 开口顶部超出房间高度', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.openings[0]!.elevation = 3; // 3 + 2.5 = 5.5 > 4
    });
    expectRule(validateDocument(doc).errors, 'R022');
  });

  it('R023 可通行开口未连接 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.doorCount = 2;
      d.rooms[0]!.openings.push({
        id: 'door_e',
        wall: 'east',
        type: 'door',
        size: { w: 1.5, h: 2.5 },
      });
    });
    expectRule(validateDocument(doc).warnings, 'R023');
  });

  it('R024 同一开口被两条连接复用', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.doorCount = 2;
      d.rooms[0]!.openings.push({
        id: 'door_e',
        wall: 'east',
        type: 'door',
        size: { w: 1.5, h: 2.5 },
      });
      d.connections.push({ id: 'dup', from: 'a.door_e', to: 'b.door_s' });
    });
    expectRule(validateDocument(doc).errors, 'R024');
  });
});

describe('连接与拓扑 R03x', () => {
  it('R030 用 window 做连接', () => {
    const doc = makeDoc((d) => {
      d.rooms[1]!.openings[0]!.type = 'window';
      d.rooms[1]!.doorCount = 0;
    });
    expectRule(validateDocument(doc).errors, 'R030');
  });

  it('R031 连接两端 elevation 不一致', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.size = { w: 8, d: 8, h: 8 };
      d.rooms[0]!.openings[0]!.elevation = 4;
      // b 侧仍为 0 → 应报错
    });
    const diag = expectRule(validateDocument(doc).errors, 'R031');
    expect(diag.message).toContain('4');
  });

  it('R032 连接两端洞口尺寸不同 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[1]!.openings[0]!.size = { w: 2.5, h: 2.5 };
    });
    expectRule(validateDocument(doc).warnings, 'R032');
  });

  it('R033 存在不可达房间', () => {
    const doc = makeDoc((d) => {
      d.connections = []; // 断开 → b 不可达
      d.rooms[0]!.doorCount = 1;
      d.rooms[1]!.doorCount = 1;
    });
    expectRule(validateDocument(doc).errors, 'R033');
  });

  it('R033 单向连接不提供反向通路', () => {
    const doc = makeDoc((d) => {
      d.meta.entryRoom = 'b';
      d.connections[0]!.oneWay = true; // 只能 a → b，从 b 出发到不了 a
    });
    expectRule(validateDocument(doc).errors, 'R033');
  });
});

describe('内部结构件 R04x', () => {
  it('R040 结构件超出房间平面', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 6, z: 0, w: 6, d: 4 }, elevation: 2.5 },
      ];
    });
    expectRule(validateDocument(doc).errors, 'R040');
  });

  it('R041 结构件超出房间高度', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 9 },
      ];
    });
    expectRule(validateDocument(doc).errors, 'R041');
  });

  it('R042 平台上方净空不足 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.size = { w: 8, d: 8, h: 5 };
      d.rooms[0]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 4, d: 4 }, elevation: 4 },
      ];
    });
    expectRule(validateDocument(doc).warnings, 'R042');
  });

  it('R044 夹层门缺少同高度平台 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.size = { w: 8, d: 8, h: 10 };
      d.rooms[1]!.size = { w: 8, d: 8, h: 10 };
      d.rooms[0]!.openings[0]!.elevation = 4;
      d.rooms[1]!.openings[0]!.elevation = 4;
      // b 房间给了平台，a 没给 → 只 a 报
      d.rooms[1]!.structures = [
        { id: 'plat', type: 'platform', rect: { x: 0, z: 0, w: 6, d: 6 }, elevation: 4 },
      ];
    });
    const warnings = validateDocument(doc).warnings.filter((w) => w.rule === 'R044');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.path).toContain('rooms[0]');
  });
});

describe('网格与 gameplay R05x / R06x', () => {
  it('R050 尺寸未对齐网格 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.size = { w: 8.3, d: 8, h: 4 };
    });
    const diag = expectRule(validateDocument(doc).warnings, 'R050');
    expect(diag.hint).toContain('8.50');
  });

  it('R060 关卡没有出生点 —— warning', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.markers = [];
    });
    expectRule(validateDocument(doc).warnings, 'R060');
  });

  it('R061 上锁但无钥匙 —— warning', () => {
    const doc = makeDoc((d) => {
      d.connections[0]!.locked = true;
    });
    expectRule(validateDocument(doc).warnings, 'R061');
  });

  it('R062 房间无光且主题无预设 —— warning', () => {
    const doc = makeDoc((d) => {
      delete d.themes[0]!.lightPreset;
    });
    expectRule(validateDocument(doc).warnings, 'R062');
  });
});

describe('诊断质量（规范要求：每条诊断必须可操作）', () => {
  it('所有 error 级诊断都带 hint', () => {
    // 故意堆叠多种错误
    const doc = makeDoc((d) => {
      d.rooms[0]!.theme = 'nope';
      d.rooms[0]!.doorCount = 5;
      d.rooms[0]!.openings[0]!.offset = 9;
      d.connections[0]!.to = 'ghost.x';
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
      d.rooms[0]!.size = { w: 8.3, d: 8, h: 4 }; // warning
      d.rooms[0]!.theme = 'nope'; // error
    });
    const all = validateDocument(doc).all;
    const firstWarning = all.findIndex((d) => d.severity === 'warning');
    const lastError = all.map((d) => d.severity).lastIndexOf('error');
    expect(lastError).toBeLessThan(firstWarning);
  });
});

describe('R046 楼梯落点（与几何生成共用同一套算法）', () => {
  /** 造一个 20×16×10 的高房间，塞进夹层 + 一部楼梯 */
  function withStair(
    stair: Partial<{
      from: { x: number; z: number };
      facing: 'north' | 'south' | 'east' | 'west';
      stepHeight: number;
    }> = {},
    platformRect = { x: 0, z: -5, w: 20, d: 6 },
  ) {
    return makeDoc((d) => {
      d.rooms[0]!.size = { w: 20, d: 16, h: 10 };
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
    const warnings = validateDocument(withStair()).warnings.filter((w) => w.rule === 'R046');
    expect(warnings).toEqual([]);
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
    const ok = validateDocument(withStair({ stepHeight: 0.3 })).warnings.filter(
      (w) => w.rule === 'R046',
    );
    expect(ok).toEqual([]);
  });

  it('爬梯用更宽的容差（贴边往上爬是正常的）', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.size = { w: 20, d: 16, h: 10 };
      d.rooms[0]!.structures = [
        { id: 'mezz', type: 'platform', rect: { x: 0, z: -5, w: 20, d: 6 }, elevation: 4 },
        // 平台南边界在 z=-2，梯脚在 z=-1.4（外侧 0.6m）应被容忍
        { id: 'ld', type: 'ladder', at: { x: 0, z: -1.4 }, to: 'mezz', facing: 'north' },
      ];
    });
    expect(validateDocument(doc).warnings.filter((w) => w.rule === 'R046')).toEqual([]);
  });

  it('爬梯离平台太远仍会报', () => {
    const doc = makeDoc((d) => {
      d.rooms[0]!.size = { w: 20, d: 16, h: 10 };
      d.rooms[0]!.structures = [
        { id: 'mezz', type: 'platform', rect: { x: 0, z: -5, w: 20, d: 6 }, elevation: 4 },
        { id: 'ld', type: 'ladder', at: { x: 0, z: 6 }, to: 'mezz', facing: 'north' },
      ];
    });
    expectRule(validateDocument(doc).warnings, 'R046');
  });
});
