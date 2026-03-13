/**
 * AI Orchestrator — Intent Parser
 *
 * Two-layer intent detection:
 *   Layer 1: Parse [[intent:xxx|param]] tag from AI response
 *   Layer 2: Keyword fallback via capability registry
 */

import type { IntentId, IntentResult } from './types';
import { matchCapabilityByKeyword } from './capabilities';

const INTENT_TAG_RE = /\[\[intent:([a-z_]+)(?:\|([^\]]*))?\]\]/;

/**
 * Parse AI response text and extract intent tag.
 * Returns clean display text + intent + optional param.
 */
export function parseAIResponse(raw: string): IntentResult {
  const match = raw.match(INTENT_TAG_RE);
  const text = raw.replace(/\[\[intent:[^\]]*\]\]/g, '').trim();

  if (match) {
    return {
      text,
      intent: match[1] as IntentId,
      param: match[2] || undefined,
    };
  }

  return { text, intent: 'general' };
}

/**
 * Detect intent from user text via keyword matching.
 * Used as fallback when AI API fails.
 */
export function detectIntentByKeyword(userText: string): IntentResult {
  const { id, param } = matchCapabilityByKeyword(userText);
  return { text: '', intent: id, param };
}
