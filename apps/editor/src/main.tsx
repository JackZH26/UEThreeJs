import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ErrorBoundary, installGlobalErrorSurface } from './ErrorSurface.js';

installGlobalErrorSurface();

const host = document.getElementById('root');
if (host === null) throw new Error('缺少 #root 挂载点');

createRoot(host).render(
  <StrictMode>
    <ErrorBoundary label="编辑器">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// 通知 index.html 里的启动看门狗：模块图跑通了、React 已挂载。
// 不设这个标志，看门狗会在 3 秒后误报启动超时。
declare global {
  interface Window {
    __tjreBooted?: boolean;
  }
}
window.__tjreBooted = true;
