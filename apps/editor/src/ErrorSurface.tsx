import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * 错误可见化。
 *
 * 编辑器**绝不允许白屏**：React 19 对渲染期未捕获异常的默认行为是卸载整棵树，
 * 结果是一片空白 + 只有浏览器控制台里有线索。对一个要被 AI agent 和人频繁
 * 折腾的工具来说，"白屏"等于"无法诊断"。
 *
 * 这里做两件事：
 *   1. `ErrorBoundary` 捕获渲染期与生命周期异常，就地渲染错误详情
 *   2. `installGlobalErrorSurface()` 捕获逃到 window 的异常与未处理 Promise 拒绝
 *      （典型来源：WebGPU 初始化失败、动画循环里抛错）
 */

const box: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  overflow: 'auto',
  padding: 24,
  background: '#1a1113',
  color: '#ffb4a8',
  font: '12px/1.6 ui-monospace, Consolas, monospace',
  whiteSpace: 'pre-wrap',
};

function renderTo(target: HTMLElement, title: string, detail: string): void {
  const panel = document.createElement('div');
  Object.assign(panel.style, box as Record<string, string>);
  panel.textContent = `${title}\n\n${detail}`;
  target.appendChild(panel);
}

/** 捕获 window 级错误 —— 这些不会被 React 的 ErrorBoundary 接住 */
export function installGlobalErrorSurface(): void {
  const show = (title: string, detail: string): void => {
    renderTo(document.body, title, detail);
  };

  window.addEventListener('error', (event) => {
    show(
      '✗ 未捕获错误（window.onerror）',
      `${event.message}\n  at ${event.filename}:${event.lineno}:${event.colno}\n\n${event.error instanceof Error ? (event.error.stack ?? '') : ''}`,
    );
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    show(
      '✗ 未处理的 Promise 拒绝',
      reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
    );
  });
}

interface Props {
  children: ReactNode;
  /** 出错区域的名字，帮助定位是哪块崩了 */
  label: string;
}

interface State {
  error: Error | null;
  info: string;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: '' };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info: info.componentStack ?? '' });
    console.error(`[${this.props.label}]`, error);
  }

  override render(): ReactNode {
    const { error, info } = this.state;
    if (error === null) return this.props.children;
    return (
      <div style={{ ...box, position: 'absolute' }}>
        {`✗ ${this.props.label} 崩溃\n\n${error.name}: ${error.message}\n\n${error.stack ?? ''}\n${info}`}
      </div>
    );
  }
}
