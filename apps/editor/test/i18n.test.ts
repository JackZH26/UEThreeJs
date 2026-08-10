import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_LABEL, MESSAGE_TABLE } from '../src/i18n.js';

/**
 * 字典一致性自检。
 *
 * 手写双语字典最常见的故障是「加了中文忘了英文」——
 * 缺 key 时 `t()` 会返回 undefined，界面上出现空白，而且不报错。
 * 这几条把它变成 CI 能抓到的失败。
 */
describe('i18n 字典', () => {
  it('每个 locale 都有 label', () => {
    for (const code of LOCALES) expect(LOCALE_LABEL[code].length).toBeGreaterThan(0);
  });

  it('两种语言的键集完全一致', () => {
    const zh = Object.keys(MESSAGE_TABLE.zh).sort();
    const en = Object.keys(MESSAGE_TABLE.en).sort();
    const missingInEn = zh.filter((k) => !en.includes(k));
    const missingInZh = en.filter((k) => !zh.includes(k));
    expect(missingInEn, `en 缺少: ${missingInEn.join(', ')}`).toEqual([]);
    expect(missingInZh, `zh 缺少: ${missingInZh.join(', ')}`).toEqual([]);
  });

  it('没有空文案', () => {
    for (const code of LOCALES) {
      for (const [key, value] of Object.entries(MESSAGE_TABLE[code])) {
        expect(String(value).trim().length, `${code}.${key} 为空`).toBeGreaterThan(0);
      }
    }
  });

  it('带占位符的文案两种语言都保留了同样的占位符', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
    for (const key of Object.keys(MESSAGE_TABLE.zh) as (keyof typeof MESSAGE_TABLE.zh)[]) {
      expect(placeholders(MESSAGE_TABLE.en[key]), `占位符不一致: ${key}`).toEqual(
        placeholders(MESSAGE_TABLE.zh[key]),
      );
    }
  });
});
