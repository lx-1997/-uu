/**
 * 按渠道调整流式输出节奏（RDKClaw SSE 文本 smoother、OpenClaw 网关 chat delta 限流）。
 * 渠道差异：IM / 弱网略降频、工作台略偏响应；定时任务合并输出减少推送次数。
 */

import type { ChannelSource } from './rdkclaw/types.js';

export type StreamChannel = ChannelSource | 'openclaw' | 'default';

export function normalizeStreamChannel(raw: string | undefined | null): StreamChannel {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'weixin' || s === 'feishu' || s === 'studio' || s === 'autonomy' || s === 'openclaw') {
    return s;
  }
  return 'default';
}

/** RDKClaw TextDeltaSmoother：tickMs / minPerTick */
export function getRdkclawTextSmootherOpts(
  channel: StreamChannel,
  studioQuick: boolean,
): { tickMs: number; minPerTick: number } {
  if (studioQuick) {
    return { tickMs: 7, minPerTick: 2 };
  }
  switch (channel) {
    case 'studio':
      return { tickMs: 9, minPerTick: 1 };
    case 'weixin':
      return { tickMs: 16, minPerTick: 2 };
    case 'feishu':
      return { tickMs: 14, minPerTick: 2 };
    case 'autonomy':
      return { tickMs: 22, minPerTick: 3 };
    default:
      return { tickMs: 11, minPerTick: 1 };
  }
}

/** 网关 chat.send message_delta → chat 广播：节流间隔与字符触发 flush */
export function getGatewayChatDeltaProfile(channel: StreamChannel): {
  throttleMs: number;
  charFlush: number;
} {
  switch (channel) {
    case 'studio':
      return { throttleMs: 85, charFlush: 52 };
    case 'weixin':
      return { throttleMs: 200, charFlush: 44 };
    case 'feishu':
      return { throttleMs: 170, charFlush: 48 };
    case 'autonomy':
      return { throttleMs: 240, charFlush: 96 };
    default:
      return { throttleMs: 120, charFlush: 56 };
  }
}
