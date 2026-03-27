/** 与 Supabase / JSONL 对齐的归档 */
export const CONVERSATION_SCHEMA = 'rdk.studio.conversation_turn.v4';

export type ConversationOutcome =
  | 'completed'
  | 'cancelled'
  | 'error'
  | 'queued_cancelled';

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
  /** studio | feishu | weixin | autonomy */
  channel: string;
  outcome: ConversationOutcome;
  /** 失败或未完成时的简要原因（可空） */
  errorDetail?: string;
};
