import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8')) as { version?: string };
const appVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.PORT?.trim() || '8787';
  const apiTarget = `http://localhost:${apiPort}`;

  return {
    // 默认 cache 在 node_modules/.vite；若该目录曾因 sudo/npm 以 root 写入导致属主为 root，会出现 EACCES unlink。改到仓库根目录下用户可写目录。
    cacheDir: path.join(__dirname, '.vite-cache'),
    // Electron 生产环境用 file:// 加载 dist/index.html，必须用相对路径，否则 /assets/* 会指向盘符根目录导致白屏
    base: './',
    /** 避免多份 react 导致 Context（AppProvider）在懒加载子树中失效 */
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_APP_BUILD_DATE': JSON.stringify(buildDate),
    },
    plugins: [react()],
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/react-dom')) return 'react-dom';
            if (id.includes('node_modules/react/')) return 'react';
          },
        },
      },
    },
  };
});