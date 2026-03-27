/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react';

interface ImportMetaEnv {
  /** 设为 0 时关闭前端埋点上报 */
  readonly VITE_ANALYTICS_ENABLED?: string;
  /** 与后端 ANALYTICS_PAYLOAD_SECRET 相同则埋点 JSON 以 AES-256-GCM 封装，Network 中仅见密文 envelope */
  readonly VITE_ANALYTICS_PAYLOAD_SECRET?: string;
  /** package.json version，构建时注入 */
  readonly VITE_APP_VERSION: string;
  /** 构建 UTC 日期 YYYY-MM-DD */
  readonly VITE_APP_BUILD_DATE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Electron `<webview>` — keep loose so non-standard attrs type-check */
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: boolean | string;
        webpreferences?: string;
      };
    }
  }
}
