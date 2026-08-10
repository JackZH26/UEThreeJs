import { describe, expect, it } from 'vitest';
import { ALL_RULES } from '@tjre/core';

/**
 * 规则注册表的自检。
 *
 * 存在原因：规则分散在 7 个文件里，靠人工维护"编号不重复、都注册了"很容易漏。
 * 这几条测试把 docs/CONVENTIONS.md §4.6 的约定变成机器检查。
 */
describe('规则注册表', () => {
  it('编号不重复', () => {
    const ids = ALL_RULES.map((r) => r.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates, `重复编号：${duplicates.join(', ')}`).toEqual([]);
  });

  it('编号格式为 Rnnn', () => {
    for (const rule of ALL_RULES) {
      expect(rule.id, `规则 "${rule.title}" 的编号格式不对`).toMatch(/^R\d{3}$/);
    }
  });

  it('每条规则都有中文标题', () => {
    for (const rule of ALL_RULES) {
      expect(rule.title.length, `规则 ${rule.id} 缺少标题`).toBeGreaterThan(0);
    }
  });

  it('编号按 CONVENTIONS §4.6 的分段归属', () => {
    // 段 → 已使用的编号必须落在该段内；这里只校验分段前缀存在合法归属
    const validSegments = ['R00', 'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07'];
    for (const rule of ALL_RULES) {
      const segment = rule.id.slice(0, 3);
      expect(validSegments, `规则 ${rule.id} 不属于任何已定义分段`).toContain(segment);
    }
  });

  it('注册表按编号升序 —— 保证诊断输出顺序可预测', () => {
    const ids = ALL_RULES.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());
  });
});
