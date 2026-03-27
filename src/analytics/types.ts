/**
 * 行为与训练信号事件类型（训练侧需额外合规：脱敏、授权、不采集聊天原文）。
 */
import type { Tab } from '../app-types';

export const ANALYTICS_SCHEMA = 'rdk.studio.analytics.v1';

/** 产品埋点：页面 / Tab */
export type PagePresenceEvent =
  | { type: 'page_enter'; tab: Tab; ts: number }
  | { type: 'page_leave'; tab: Tab; durationMs: number; ts: number }
  | { type: 'app_background'; visibleDurationMs: number; ts: number };

/** 用户显式操作（不含敏感字段） */
export type UiActionEvent = {
  type: 'ui_action';
  name: string;
  /** 短枚举，如 settings_open、flash_start */
  detail?: Record<string, string | number | boolean | null>;
  ts: number;
};

/**
 * 预留：模型训练相关信号（需用户授权后写入；默认不采集用户消息正文）
 * 例：对话轮次长度分布、工具调用成功/失败率（仅元数据）
 */
export type TrainingSignalEvent = {
  type: 'training_signal';
  signal: 'chat_turn_meta' | 'tool_outcome';
  payload: Record<string, string | number | boolean | null>;
  ts: number;
};

export type ConsentSnapshotEvent = {
  type: 'consent_snapshot';
  reason: string;
  trainingDataOptIn: boolean;
  ts: number;
};

export type StudioAnalyticsEvent =
  | PagePresenceEvent
  | UiActionEvent
  | TrainingSignalEvent
  | ConsentSnapshotEvent;
