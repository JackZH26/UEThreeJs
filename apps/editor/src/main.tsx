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
