import { describe, expect, it } from 'vitest';
import { basename, resolve, sep } from 'node:path';
import { OUT_DIR, resolveInOutDir, safeGlbName } from '../vite-plugin-export.js';
import { EXPORT_ROUTE, REVEAL_ROUTE } from '../exportRoutes.js';
import { glbFileName } from '../src/exportRoom.js';

/**
 * 导出桥是编辑器里**唯一会写文件、会起子进程**的东西，
 * 所以路径消毒必须有测试钉住 —— 这不是"锦上添花的单测"，
 * 是这个功能能存在的前提。
 */

describe('文件名消毒', () => {
  it('正常名字原样通过', () => {
    expect(safeGlbName('etc-l-atrium.atrium.glb')).toBe('etc-l-atrium.atrium.glb');
  });

  it('缺后缀时补上 .glb', () => {
    expect(safeGlbName('atrium')).toBe('atrium.glb');
    // 已有后缀不重复追加（大小写不敏感）
    expect(safeGlbName('atrium.GLB')).toBe('atrium.GLB');
  });

  it('空 / null 回落到 room.glb', () => {
    expect(safeGlbName(null)).toBe('room.glb');
    expect(safeGlbName(undefined)).toBe('room.glb');
    expect(safeGlbName('')).toBe('room.glb');
    // 全是非法字符时不能产出一串下划线以外的东西，但至少必须是合法名
    expect(safeGlbName('///')).toBe('___.glb');
  });

  it('路径分隔符与遍历序列被消掉', () => {
    for (const attempt of [
      '../../../etc/passwd',
      '..\\..\\windows\\system32\\evil',
      '/absolute/path',
      'C:\\Windows\\evil',
      'a/b/c',
      './hidden',
      '....//....//x',
    ]) {
      const safe = safeGlbName(attempt);
      expect(safe, attempt).not.toContain('/');
      expect(safe, attempt).not.toContain('\\');
      expect(safe.startsWith('.'), attempt).toBe(false);
      // 而且解析后必须仍在 out/ 里
      expect(resolveInOutDir(safe), attempt).not.toBeNull();
    }
  });

  it('剥掉可能被 shell 或文件系统特殊解读的字符', () => {
    expect(safeGlbName('a b;rm -rf /.glb')).toBe('a_b_rm_-rf__.glb');
    expect(safeGlbName('x\u0000y')).toBe('x_y.glb');
    expect(safeGlbName('$(whoami)')).toBe('__whoami_.glb');
  });

  it('超长名字被截断', () => {
    const safe = safeGlbName('a'.repeat(500));
    expect(safe.length).toBeLessThanOrEqual(200);
    expect(safe.endsWith('.glb')).toBe(true);
  });
});

describe('目录包含断言', () => {
  it('合法名解析进 out/', () => {
    const target = resolveInOutDir('atrium.glb');
    expect(target).not.toBeNull();
    expect(target as string).toBe(resolve(OUT_DIR, 'atrium.glb'));
    expect(basename(target as string)).toBe('atrium.glb');
  });

  it('即便消毒被绕过，越界路径也会被拦住', () => {
    // 直接喂未消毒的输入，模拟"以后有人改坏了 safeGlbName"
    expect(resolveInOutDir('../escaped.glb')).toBeNull();
    expect(resolveInOutDir(`..${sep}escaped.glb`)).toBeNull();
    expect(resolveInOutDir('../out-sibling/x.glb')).toBeNull();
  });

  it('OUT_DIR 就是仓库根的 out/', () => {
    expect(basename(OUT_DIR)).toBe('out');
    expect(resolve(OUT_DIR, '..')).toBe(resolve(import.meta.dirname, '../../..'));
  });
});

describe('路由常量只有一份定义', () => {
  it('两端共用 exportRoutes.ts', () => {
    expect(EXPORT_ROUTE).toBe('/__tjre/export');
    expect(REVEAL_ROUTE).toBe('/__tjre/reveal');
  });
});

/**
 * 编辑器按钮与 CLI 落在同一个 out/ 目录，命名规则必须一致 ——
 * 否则同一个房间会在同一个目录里留下两个不同名的文件。
 * 这里独立复现 CLI 的表达式（`apps/cli/src/commands/export.ts`）来比对。
 */
describe('默认文件名与 CLI 一致', () => {
  it('<关卡文件名去后缀>.<房间 id>.glb', () => {
    const cases: [string, string][] = [
      ['etc-s-piston-floor.roomgraph.yaml', 'piston_floor'],
      ['etc-m-catwalk-gallery.roomgraph.yaml', 'catwalk_gallery'],
      ['etc-l-atrium.roomgraph.yaml', 'atrium'],
    ];
    for (const [file, roomId] of cases) {
      const cliName = `${basename(file).replace(/\.roomgraph\.ya?ml$/i, '')}.${roomId}.glb`;
      const stem = basename(file).replace(/\.roomgraph\.ya?ml$/i, '');
      expect(glbFileName(stem, roomId)).toBe(cliName);
    }
  });
});
