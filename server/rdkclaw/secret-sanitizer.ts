const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(sk-[a-zA-Z0-9]{20,})\b/g, label: 'OpenAI key' },
  { pattern: /\b(sk-ant-[a-zA-Z0-9-]{20,})\b/g, label: 'Anthropic key' },
  { pattern: /\b(gsk_[a-zA-Z0-9]{20,})\b/g, label: 'Groq key' },
  { pattern: /\b(xai-[a-zA-Z0-9]{20,})\b/g, label: 'xAI key' },
  { pattern: /\b(AIza[a-zA-Z0-9_-]{30,})\b/g, label: 'Google key' },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,})\b/g, label: 'GitHub token' },
  { pattern: /\b(glpat-[a-zA-Z0-9_-]{20,})\b/g, label: 'GitLab token' },
  { pattern: /\b(AKIA[A-Z0-9]{16})\b/g, label: 'AWS access key' },
  { pattern: /(eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,})/g, label: 'JWT' },
  { pattern: /(?:password|passwd|pwd|secret|token|apikey|api_key|api-key|access_key)\s*[:=]\s*['"]([^'"]{8,})['"]/gi, label: 'credential value' },
];

export function sanitizeSecrets(text: string): string {
  let result = text;
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match) => {
      if (match.length <= 10) return match;
      const visible = Math.min(6, Math.floor(match.length * 0.2));
      return match.slice(0, visible) + '***' + match.slice(-3);
    });
  }
  return result;
}

export function containsSecrets(text: string): boolean {
  for (const { pattern } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
