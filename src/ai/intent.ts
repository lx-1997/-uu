/**
 * AI Orchestrator — Intent Parser
 *
 * Supports both legacy [[intent:xxx|param]] and new skill-based tags:
 *   - [[skill:skill-name/action|{"param":"value"}]]
 *   - [[action:navigate|terminal]]
 *   - [[confirm:skill-name/action|{"param":"value"}]]
 *   - [[intent:xxx|param]] (backward compat)
 */

import type { IntentId, IntentResult, ParsedAIResult, ParsedTag } from './types';
import { matchCapabilityByKeyword } from './capabilities';

const INTENT_TAG_RE = /\[\[intent:([a-z_]+)(?:\|([^\]]*))?\]\]/;
const SKILL_TAG_RE = /\[\[skill:([a-z0-9-]+)\/([a-z0-9-]+)(?:\|([^\]]*))?\]\]/;
const ACTION_TAG_RE = /\[\[action:([a-zA-Z]+)(?:\|([^\]]*))?\]\]/;
const CONFIRM_TAG_RE = /\[\[confirm:([a-z0-9-]+)\/([a-z0-9-]+)(?:\|([^\]]*))?\]\]/;
const ALL_TAGS_RE = /\[\[(intent|skill|action|confirm):[^\]]*\]\]/g;

function tryParseJSON(str: string | undefined): Record<string, unknown> | undefined {
  if (!str) return undefined;
  try {
    const parsed = JSON.parse(str);
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse AI response for skill-based tags (new format).
 * Falls back to legacy intent tags.
 */
export function parseAIResponseV2(raw: string): ParsedAIResult {
  const text = raw.replace(ALL_TAGS_RE, '').trim();

  const skillMatch = raw.match(SKILL_TAG_RE);
  if (skillMatch) {
    return {
      text,
      tag: {
        type: 'skill',
        skill: skillMatch[1],
        action: skillMatch[2],
        params: tryParseJSON(skillMatch[3]),
      },
    };
  }

  const confirmMatch = raw.match(CONFIRM_TAG_RE);
  if (confirmMatch) {
    return {
      text,
      tag: {
        type: 'confirm',
        skill: confirmMatch[1],
        action: confirmMatch[2],
        params: tryParseJSON(confirmMatch[3]),
      },
    };
  }

  const actionMatch = raw.match(ACTION_TAG_RE);
  if (actionMatch) {
    return {
      text,
      tag: {
        type: 'action',
        actionType: actionMatch[1],
        target: actionMatch[2],
      },
    };
  }

  const intentMatch = raw.match(INTENT_TAG_RE);
  if (intentMatch) {
    return {
      text,
      tag: {
        type: 'legacy',
        intent: intentMatch[1] as IntentId,
        param: intentMatch[2] || undefined,
      },
    };
  }

  return { text, tag: { type: 'none' } };
}

/**
 * Parse AI response text and extract intent tag (legacy).
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
 */
export function detectIntentByKeyword(userText: string): IntentResult {
  const { id, param } = matchCapabilityByKeyword(userText);
  return { text: '', intent: id, param };
}
