import React from 'react';
import ReactDOM from 'react-dom/client';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);