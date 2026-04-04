import type { ChannelSource } from './types.js';

export function queueChannelDisplayName(ch: string): string {
  switch (ch) {
    case 'feishu':
      return '飞书';
    case 'weixin':
      return '微信';
    case 'studio':
      return '工作台';
    case 'autonomy':
      return '定时任务';
    default:
      return ch.trim() || '其他渠道';
  }
}

/**
 * 各渠道共用的队列提示文案（IM 可直接发送；Studio 可作 summary 兜底以统一口径）。
 */
export function formatQueueStatusUserHint(params: {
  position: number;
  currentTask: string;
  currentChannel: string;
}): string {
  const pos = Math.max(0, Number(params.position) || 0);
  const current = String(params.currentTask || '').trim();
  const ch = queueChannelDisplayName(String(params.currentChannel || ''));
  if (pos > 0) {
    return current
      ? `当前设备正在处理「${ch}」任务（${current}），你的请求排在第 ${pos} 位，请稍候…`
      : `当前设备正在处理「${ch}」任务，你的请求排在第 ${pos} 位，请稍候…`;
  }
  return '正在排队中，请稍候…';
}

export function buildQueueStatusPayload(args: {
  deviceLane: string;
  position: number;
  currentTask: string;
  currentChannel: ChannelSource;
  /** 当前占用设备的 run（若已上报） */
  runningRunId?: string;
}): Record<string, unknown> {
  const userHint = formatQueueStatusUserHint({
    position: args.position,
    currentTask: args.currentTask,
    currentChannel: args.currentChannel,
  });
  return {
    position: args.position,
    currentTask: args.currentTask,
    currentChannel: args.currentChannel,
    deviceLane: args.deviceLane,
    userHint,
    channelLabel: queueChannelDisplayName(args.currentChannel),
    ...(args.runningRunId ? { runningRunId: args.runningRunId } : {}),
  };
}
