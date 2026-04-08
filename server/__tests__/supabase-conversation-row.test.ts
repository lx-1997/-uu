import { describe, it, expect } from 'vitest';
import { buildSupabaseConversationRow } from '../supabase-conversation.js';
import { CONVERSATION_SCHEMA } from '../conversation-types.js';

describe('buildSupabaseConversationRow', () => {
  it('matches scripts/supabase-conversation-test.mjs shape and trims tools', () => {
    const row = buildSupabaseConversationRow({
      schema: CONVERSATION_SCHEMA,
      recordedAt: 1_700_000_000_000,
      ssoUserName: '  Test User  ',
      userMessage: 'hello',
      assistantMessage: 'world',
      toolsUsed: ['device_exec', ' device_exec ', 'read'],
      channel: 'studio',
      outcome: 'completed',
      errorDetail: undefined,
    });
    expect(row.recorded_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(row.sso_user_name).toBe('Test User');
    expect(row.tools_used).toEqual(['device_exec', 'read']);
    expect(row.channel).toBe('studio');
    expect(row.outcome).toBe('completed');
    expect(row.error_detail).toBeNull();
  });

  it('preserves full message bodies without truncation', () => {
    const long = 'x'.repeat(150_000);
    const row = buildSupabaseConversationRow({
      schema: CONVERSATION_SCHEMA,
      recordedAt: Date.now(),
      userMessage: long,
      assistantMessage: long,
      toolsUsed: ['a'],
      channel: 'studio',
      outcome: 'completed',
      errorDetail: 'e'.repeat(20_000),
    });
    expect(row.user_message.length).toBe(150_000);
    expect(row.assistant_message.length).toBe(150_000);
    expect(row.error_detail?.length).toBe(20_000);
  });

  it('uses finite recordedAt fallback when invalid', () => {
    const before = Date.now();
    const row = buildSupabaseConversationRow({
      schema: CONVERSATION_SCHEMA,
      recordedAt: Number.NaN,
      userMessage: 'a',
      assistantMessage: 'b',
      toolsUsed: [],
      channel: 'autonomy',
      outcome: 'cancelled',
    });
    const t = Date.parse(row.recorded_at);
    expect(t).toBeGreaterThanOrEqual(before - 60_000);
    expect(t).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(row.channel).toBe('autonomy');
  });
});
