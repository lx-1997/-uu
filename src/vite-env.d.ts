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
  /** 仅 Vite 开发构建注入：Socket.IO 直连后端 origin，空串表示走页面同源 */
  readonly VITE_SOCKET_URL?: string;
  /** 覆盖默认 RoboGo 飞书介绍页 URL（与 RDK_STUDIO_ROBOGO_DOC_URL 对齐） */
  readonly VITE_ROBOGO_DOC_URL?: string;
  /** 覆盖默认 RDK Studio 飞书介绍页 URL（与 RDK_STUDIO_DOC_URL 对齐） */
  readonly VITE_RDK_STUDIO_DOC_URL?: string;
  /** 覆盖默认 RDK 开发者手册 / 官网文档 URL（与 RDK_DEVELOPER_DOC_URL 对齐） */
  readonly VITE_RDK_DEVELOPER_DOC_URL?: string;
  /**
   * 是否允许未登录访客进入工作台（默认不允许；dev/prod 一致）。
   * 仅内网/自动化等场景设为 `true`，且常与后端 SSO_REQUIRED=0 同用。
   */
  readonly VITE_ALLOW_ANONYMOUS?: string;
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
