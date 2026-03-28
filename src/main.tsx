import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './hooks/useAuth';
import { AppProvider } from './hooks/useAppState';
import App from './App';
import './styles/index.css';

/** 开发态下仅屏蔽 React 的 DevTools 下载提示，不改动其它 console 行为 */
if (import.meta.env.DEV) {
  const stripReactDevToolsBanner = (orig: typeof console.log) => {
    return (...args: unknown[]) => {
      const m = args[0];
      if (typeof m === 'string' && m.includes('Download the React DevTools')) return;
      orig.apply(console, args as []);
    };
  };
  console.log = stripReactDevToolsBanner(console.log);
  console.info = stripReactDevToolsBanner(console.info);
}

/**
 * 顺序必须为 AuthProvider → AppProvider → App：
 * - DeviceProvider（在 AppProvider 内）会调用 useAuth()，AuthContext 必须由更外层提供，否则会抛错白屏。
 * - AppProvider 仍在外层包裹 App，使 AppStateContext 覆盖 AuthDailyActiveHost、Suspense fallback、ErrorBoundary 等。
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <AppProvider>
        <App />
      </AppProvider>
    </AuthProvider>
  </React.StrictMode>,
);