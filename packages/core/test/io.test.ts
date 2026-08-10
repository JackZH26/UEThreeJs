import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDocument, serializeDocument, validateDocument } from '@tjre/core';
import { makeDoc } from './fixtures.js';

const examplesDir = resolve(import.meta.dirname, '../../../examples');
const EXAMPLES = ['two-rooms.roomgraph.yaml', 'loft-warehouse.roomgraph.yaml'] as const;

describe('示例关卡（CI 回归夹具）', () => {
  for (const name of EXAMPLES) {
    it(`${name} 能被当前 schema 加载且零 error`, () => {
      const text = readFileSync(resolve(examplesDir, name), 'utf8');
      const loaded = parseDocument(text, name);
      expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors, null, 2)).toBe(true);
      if (!loaded.ok) return;

      const result = validateDocument(loaded.doc);
      expect(result.errors, JSON.stringify(result.errors, null, 2)).toEqual([]);
    });

    it(`${name} 在 --strict 下也零 warning`, () => {
      const text = readFileSync(resolve(examplesDir, name), 'utf8');
      const loaded = parseDocument(text, name);
      if (!loaded.ok) throw new Error('加载失败');
      const result = validateDocument(loaded.doc);
      expect(result.warnings, JSON.stringify(result.warnings, null, 2)).toEqual([]);
    });
  }
});

describe('序列化确定性（write-through 的前提）', () => {
  it('同一文档序列化两次逐字节相同', () => {
    const doc = makeDoc();
    expect(serializeDocument(doc)).toBe(serializeDocument(doc));
  });

  it('序列化 → 解析 → 再序列化 结果不变（往返稳定）', () => {
    const doc = makeDoc();
    const first = serializeDocument(doc);
    const reparsed = parseDocument(first);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(serializeDocument(reparsed.doc)).toBe(first);
  });
});

describe('解析错误处理', () => {
  it('strict schema 拒绝未知字段并给出提示', () => {
    const result = parseDocument(`
schemaVersion: 0.1.0
meta:
  name: X
  widht: 8
themes:
  - id: t
    surfaces: { floor: f, ceiling: c, wall: w }
rooms: []
connections: []
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const unknown = result.errors.find((e) => e.hint?.includes('strict'));
    expect(unknown, JSON.stringify(result.errors, null, 2)).toBeDefined();
  });

  it('不支持的 schemaVersion 给出迁移提示而非一堆字段错误', () => {
    const result = parseDocument(`
schemaVersion: 9.9.9
meta: { name: X }
themes: []
rooms: []
connections: []
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.rule).toBe('VERSION');
  });

  it('YAML 语法错误被单独报告', () => {
    const result = parseDocument('meta: [unclosed');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.rule).toBe('PARSE');
  });
});
