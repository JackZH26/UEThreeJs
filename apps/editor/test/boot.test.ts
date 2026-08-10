// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

/**
 * 启动冒烟测试。
 *
 * 存在理由：编辑器曾出现"整页只剩背景色、没有任何错误提示"的故障 ——
 * 根因是模块图在**链接阶段**就失败了，写在模块里的错误处理器根本没机会执行。
 * 这个测试在 jsdom 里真正加载一遍模块图，把那类失败变成 CI 能抓到的测试错误，
 * 而不是要靠人在浏览器里刷新才发现。
 *
 * WebGPU 在 jsdom 下不可用，所以这里**只验证模块能加载 + 组件是函数**，
 * 不做渲染。渲染正确性由 packages/scene 的几何测试保证。
 */
describe('编辑器模块图', () => {
  it('App 能被加载', async () => {
    const mod = await import('../src/App.js');
    expect(typeof mod.App).toBe('function');
  });

  it('Viewport 能被加载（含 three/webgpu 与 addons）', async () => {
    const mod = await import('../src/Viewport.js');
    expect(typeof mod.Viewport).toBe('function');
  });

  it('FirstPersonController 能被加载', async () => {
    const mod = await import('../src/FirstPersonController.js');
    expect(typeof mod.FirstPersonController).toBe('function');
  });

  it('ErrorSurface 能被加载', async () => {
    const mod = await import('../src/ErrorSurface.js');
    expect(typeof mod.ErrorBoundary).toBe('function');
    expect(typeof mod.installGlobalErrorSurface).toBe('function');
  });
});
