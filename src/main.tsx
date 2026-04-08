import React from 'react';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './hooks/useAuth';
import { AppProvider } from './hooks/useAppState';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import PromoVideoPage from './components/PromoVideoPage';
import './styles/index.css';
import { startConsoleLogCapture } from './utils/console-log-capture';

function isPromoVideoMode() {
  const q = new URLSearchParams(window.location.search);
  if (q.get('promo') === '1' || q.get('promo') === 'video') return true;
  const h = window.location.hash.replace(/^#/, '');
  return h === 'promo' || h === 'promo-video';
}

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

startConsoleLogCapture();

const promoVideo = isPromoVideoMode();

/**
 * 顺序必须为 AuthProvider → AppProvider → App：
 * - DeviceProvider（在 AppProvider 内）会调用 useAuth()，AuthContext 必须由更外层提供，否则会抛错白屏。
 * - AppProvider 仍在外层包裹 App，使 AppStateContext 覆盖 AuthDailyActiveHost、Suspense fallback、ErrorBoundary 等。
 * - `?promo=1` / `#promo`：全屏宣传短片，不经过登录，便于录屏导出。
 */
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {promoVideo ? (
      <ErrorBoundary>
        <PromoVideoPage />
      </ErrorBoundary>
    ) : (
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    )}
  </React.StrictMode>,
);