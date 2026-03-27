import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, 'package.json'), 'utf-8')) as { version?: string };
const appVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
const buildDate = new Date().toISOString().slice(0, 10);

export default defineConfig({
  // Electron 生产环境用 file:// 加载 dist/index.html，必须用相对路径，否则 /assets/* 会指向盘符根目录导致白屏
  base: './',
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
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
});