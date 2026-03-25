import { describe, it, expect } from 'vitest';
import { sanitizeSecrets, containsSecrets } from '../secret-sanitizer.js';

describe('sanitizeSecrets', () => {
  it('masks OpenAI keys', () => {
    const input = 'Using key sk-abcdefghijklmnopqrstuvwxyz1234567890 for API';
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result).toContain('***');
    expect(result).toContain('Using key');
    expect(result).toContain('for API');
  });

  it('masks Anthropic keys', () => {
    const input = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
    expect(result).toContain('***');
  });

  it('masks Groq keys', () => {
    const input = 'api_key: gsk_1234567890abcdefghijklmnop';
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('gsk_1234567890abcdefghijklmnop');
  });

  it('masks GitHub tokens', () => {
    const input = 'token: ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd';
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd');
  });

  it('masks AWS access keys', () => {
    const input = 'AKIAIOSFODNN7EXAMPLE';
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('***');
  });

  it('masks JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = sanitizeSecrets(jwt);
    expect(result).not.toContain(jwt);
    expect(result).toContain('***');
  });

  it('masks credential assignments in quotes', () => {
    const input = 'password="my-super-secret-password"';
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('my-super-secret-password');
    expect(result).toContain('***');
  });

  it('masks credential assignments with single quotes', () => {
    const input = "api_key='sk-test-secret-value-12345'";
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('sk-test-secret-value-12345');
  });

  it('handles multiple secrets in the same text', () => {
    const input = 'keys: sk-abc123def456ghi789jkl012mno and ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd';
    const result = sanitizeSecrets(input);
    expect(result).not.toContain('sk-abc123def456ghi789jkl012mno');
    expect(result).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234567890abcd');
  });

  it('preserves non-secret text unchanged', () => {
    const input = 'Hello world, this is a normal message with no secrets.';
    expect(sanitizeSecrets(input)).toBe(input);
  });

  it('handles empty/null input gracefully', () => {
    expect(sanitizeSecrets('')).toBe('');
    expect(sanitizeSecrets(null as unknown as string)).toBe('');
    expect(sanitizeSecrets(undefined as unknown as string)).toBe('');
  });

  it('retains partial visibility for masked values', () => {
    const input = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
    const result = sanitizeSecrets(input);
    expect(result).toMatch(/^sk-a.*\*\*\*.*90$/);
  });
});

describe('containsSecrets', () => {
  it('returns true for OpenAI key', () => {
    expect(containsSecrets('my key is sk-abcdefghijklmnopqrstuvwxyz1234567890')).toBe(true);
  });

  it('returns true for JWT', () => {
    expect(containsSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toBe(true);
  });

  it('returns false for normal text', () => {
    expect(containsSecrets('Hello world')).toBe(false);
  });

  it('returns false for empty input', () => {
    expect(containsSecrets('')).toBe(false);
    expect(containsSecrets(null as unknown as string)).toBe(false);
  });
});
