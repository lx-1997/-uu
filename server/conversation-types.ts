/** 与 Supabase / JSONL / 飞书多维表格对齐的极简归档（仅 5 类信息） */
export const CONVERSATION_SCHEMA = 'rdk.studio.conversation_turn.v3';

export type ConversationTurnRecord = {
  schema: typeof CONVERSATION_SCHEMA;
  /** 毫秒时间戳，本轮结束时刻 */
  recordedAt: number;
  /** SSO 展示名；未登录为空 */
  ssoUserName?: string;
  userMessage: string;
  assistantMessage: string;
  /** 本轮实际调用过的工具名（去重，顺序大致为调用顺序） */
  toolsUsed: string[];
};
