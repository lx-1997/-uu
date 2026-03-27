/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react';

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
