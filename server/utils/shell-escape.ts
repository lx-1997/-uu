/**
 * Escape a string for safe inclusion in a single-quoted shell argument.
 * Wraps the value in single quotes and escapes any embedded single quotes.
 *
 * Example: shellEscape("it's a test") => "'it'\\''s a test'"
 */
export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Validate that a string looks like a safe model/package name.
 * Only allows alphanumeric, hyphens, underscores, dots, and slashes.
 */
export function isSafeName(s: string): boolean {
  return /^[a-zA-Z0-9._\-/]+$/.test(s);
}
