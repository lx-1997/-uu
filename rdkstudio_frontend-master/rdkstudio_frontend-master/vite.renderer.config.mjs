import { defineConfig } from 'vite';
import { pluginExposeRenderer } from './vite.base.config.mjs';
import { fileURLToPath, URL } from 'url';

import vue from '@vitejs/plugin-vue';
import renderer from 'vite-plugin-electron-renderer';

// https://vitejs.dev/config
export default defineConfig((env) => {
  /** @type {import('vite').ConfigEnv<'renderer'>} */
  const forgeEnv = env;
  const { root, mode, forgeConfigSelf } = forgeEnv;
  const name = forgeConfigSelf.name ?? '';

  // 获取 APP_MODE 环境变量，默认为 'prod'
  const appMode = process.env.APP_MODE || 'prod';
  
  /** @type {import('vite').UserConfig} */
  return {
    root,
    mode,
    base: './',
    define: {
      'process.env.APP_MODE': JSON.stringify(appMode)
    },
    build: {
      outDir: `.vite/renderer/${name}`,
      rollupOptions: {
        external: [
          'serialport',
          'sqlite3',
          'lzma-native'
        ]
      }
    },
    plugins: [
      pluginExposeRenderer(name), 
      vue(),
      renderer()
    ],
    optimizeDeps: { 
      exclude: [ "ssh2" ]
    },
    resolve: {
      preserveSymlinks: true,
      alias: [
        {
          find: '@',
          replacement: fileURLToPath(new URL('./src', import.meta.url))
        },
        {
          find: '@hardware',
          replacement: fileURLToPath(new URL('./src/subsystems/resources_management/hardware_resources', import.meta.url))
        },
        {
          find: '@computing',
          replacement: fileURLToPath(new URL('./src/subsystems/resources_management/computing_resources', import.meta.url))
        }
      ],
    },
    clearScreen: false,
  };
});
