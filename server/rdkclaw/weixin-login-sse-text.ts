import type { Request } from 'express';

/** 与设置页 EventSource 上的 `locale` / `lang` 查询参数对齐 */
export function isWeixinLoginSseEnglish(request: Request): boolean {
  const q = request.query as Record<string, string | undefined>;
  const locale = String(q.locale || q.lang || '').toLowerCase();
  return locale === 'en' || locale === 'en-us';
}

export function wxLoginFetchingQr(en: boolean): string {
  return en ? 'Fetching QR code…' : '正在获取二维码...';
}

export function wxLoginQrHttpFail(en: boolean, status: number): string {
  return en ? `Failed to fetch QR code: HTTP ${status}` : `获取二维码失败: HTTP ${status}`;
}

export function wxLoginQrMissingField(en: boolean): string {
  return en ? 'Failed to fetch QR code: response missing qrcode' : '获取二维码失败: 响应中缺少 qrcode';
}

export function wxLoginScanHint(en: boolean): string {
  return en ? 'Scan the QR code with WeChat' : '请用微信扫描二维码';
}

export function wxLoginPollHttpErr(en: boolean, status: number): string {
  return en ? `Poll error: HTTP ${status}` : `轮询状态异常: HTTP ${status}`;
}

export function wxLoginRedirectNode(en: boolean): string {
  return en ? 'Switching to the nearest node…' : '正在切换至就近节点…';
}

export function wxLoginQrExpired(en: boolean): string {
  return en ? 'QR code expired, refreshing…' : '二维码已过期，正在刷新...';
}

export function wxLoginQrRefreshed(en: boolean): string {
  return en ? 'A new QR code is ready — scan again' : '新二维码已生成，请重新扫描';
}

export function wxLoginRefreshFail(en: boolean): string {
  return en ? 'Failed to refresh QR code' : '刷新二维码失败';
}

export function wxLoginRefreshFailDetail(en: boolean, detail: string): string {
  const d = detail || '';
  return en ? `Failed to refresh QR code: ${d}` : `刷新二维码失败: ${d}`;
}

export function wxLoginPollErr(en: boolean, detail: string): string {
  const d = detail || '';
  return en ? `Poll error: ${d}` : `轮询出错: ${d}`;
}

export function wxLoginTimeout(en: boolean): string {
  return en ? 'Login timed out — please try again' : '登录超时，请重试';
}

export function wxLoginStartFail(en: boolean, detail: string): string {
  const d = detail || '';
  return en ? (d || 'Failed to start login') : (d || '启动登录流程失败');
}
