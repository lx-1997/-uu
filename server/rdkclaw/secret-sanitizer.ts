const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string; groupIdx?: number }> = [
  { pattern: /\b(sk-[a-zA-Z0-9_-]{20,})\b/g, label: 'OpenAI key' },
  { pattern: /\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/g, label: 'Anthropic key' },
  { pattern: /\b(gsk_[a-zA-Z0-9]{20,})\b/g, label: 'Groq key' },
  { pattern: /\b(xai-[a-zA-Z0-9]{20,})\b/g, label: 'xAI key' },
  { pattern: /\b(AIza[a-zA-Z0-9_-]{30,})\b/g, label: 'Google key' },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,})\b/g, label: 'GitHub token' },
  { pattern: /\b(github_pat_[a-zA-Z0-9_]{20,})\b/g, label: 'GitHub fine-grained token' },
  { pattern: /\b(glpat-[a-zA-Z0-9_-]{20,})\b/g, label: 'GitLab token' },
  { pattern: /\b(AKIA[A-Z0-9]{16})\b/g, label: 'AWS access key' },
  { pattern: /\b(sk_live_[a-zA-Z0-9]{20,})\b/g, label: 'Stripe live key' },
  { pattern: /\b(sk_test_[a-zA-Z0-9]{20,})\b/g, label: 'Stripe test key' },
  { pattern: /\b(xoxb-[a-zA-Z0-9-]{20,})\b/g, label: 'Slack bot token' },
  { pattern: /(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_=+-]{10,})/g, label: 'JWT' },
  {
    pattern: /(?:password|passwd|pwd|secret|token|apikey|api_key|api-key|access_key)\s*[:=]\s*['"]([^'"]{6,})['"]/gi,
    label: 'credential value',
    groupIdx: 1,
  },
];

function maskValue(value: string): string {
  if (value.length <= 4) return '***';
  const visible = Math.min(4, Math.floor(value.length * 0.15));
  return value.slice(0, visible) + '***' + value.slice(-2);
}

export function sanitizeSecrets(text: string): string {
  if (!text || typeof text !== 'string') return text ?? '';
  let result = text;
  for (const { pattern, groupIdx } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (groupIdx !== undefined) {
      result = result.replace(pattern, (...args) => {
        const full: string = args[0];
        const captured: string = args[groupIdx];
        if (!captured) return full;
        return full.replace(captured, maskValue(captured));
      });
    } else {
      result = result.replace(pattern, (match) => maskValue(match));
    }
  }
  return result;
}

export function containsSecrets(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
