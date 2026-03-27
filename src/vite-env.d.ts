/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react';

interface ImportMetaEnv {
  /** 设为 0 时关闭前端埋点上报 */
  readonly VITE_ANALYTICS_ENABLED?: string;
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
