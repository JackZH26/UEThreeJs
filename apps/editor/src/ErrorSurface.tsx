import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * 错误可见化。
 *
 * 编辑器**绝不允许白屏/黑屏**：React 19 对渲染期未捕获异常的默认行为是卸载整棵树，
 * 而模块链接错误连 ErrorBoundary 都接不到。对一个要被 AI agent 和人频繁折腾的
 * 工具来说，"看不到错误"等于"无法诊断"。
 *
 * 两个曾经踩过的坑，已在此处修掉：
 *
 *  1. **每次错误都 append 一个新面板**。若错误每帧都发生（例如渲染循环里抛错），
 *     几千个全屏面板会把浏览器拖死，表现为"整屏变黑且卡住"——
 *     反而掩盖了真正的错误。现在复用**单个**面板并去重、计数。
 *  2. **用 `Object.assign(el.style, obj)` 设样式**。数值型属性（`padding: 24`）
 *     没有单位，赋值会被静默丢弃，面板可能因此错位或不可见。现在用 `cssText`。
 */

const PANEL_CSS = [
  'position:fixed',
  'inset:0',
  'z-index:2147483647',
  'overflow:auto',
  'padding:24px',
  'margin:0',
  'background:#20141a',
  'color:#ffb4a8',
  'font:12px/1.6 ui-monospace,Consolas,monospace',
  'white-space:pre-wrap',
].join(';');

const PANEL_ID = 'tjre-error-surface';

/** 复用单个面板；重复的同一条错误只累加计数 */
function showGlobal(title: string, detail: string): void {
  let panel = document.getElementById(PANEL_ID);
  if (panel === null) {
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = PANEL_CSS;
    document.body.appendChild(panel);
  }

  const key = `${title}\n${detail}`;
  const seen = panel.dataset.keys ?? '';
  if (seen.includes(key)) {
    const count = Number(panel.dataset.count ?? '1') + 1;
    panel.dataset.count = String(count);
    const badge = panel.querySelector('[data-badge]');
    if (badge !== null) badge.textContent = `（同类错误已发生 ${count} 次）`;
    return;
  }

  panel.dataset.keys = `${seen}\n${key}`;
  panel.dataset.count = '1';
  panel.textContent = '';

  const heading = document.createElement('div');
  heading.style.cssText = 'font-weight:700;margin-bottom:8px';
  heading.textContent = title;

  const badge = document.createElement('div');
  badge.setAttribute('data-badge', '');
  badge.style.cssText = 'color:#8b949e;margin-bottom:12px';
  badge.textContent = '（同类错误已发生 1 次）';

  const body = document.createElement('div');
  body.textContent = detail;

  panel.append(heading, badge, body);
}

/** 捕获 window 级错误 —— 这些不会被 React 的 ErrorBoundary 接住 */
export function installGlobalErrorSurface(): void {
  window.addEventListener('error', (event) => {
    // 资源加载失败（<script>/<img>）的 event 没有 message，单独处理
    const detail =
      event.error instanceof Error
        ? (event.error.stack ?? event.error.message)
        : `${event.message}\n  at ${event.filename}:${event.lineno}:${event.colno}`;
    showGlobal('✗ 未捕获错误（window.onerror）', detail);
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    showGlobal(
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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          overflow: 'auto',
          padding: 24,
          background: '#20141a',
          color: '#ffb4a8',
          font: '12px/1.6 ui-monospace, Consolas, monospace',
          whiteSpace: 'pre-wrap',
        }}
      >
        {`✗ ${this.props.label} 崩溃\n\n${error.name}: ${error.message}\n\n${error.stack ?? ''}\n${info}`}
      </div>
    );
  }
}
