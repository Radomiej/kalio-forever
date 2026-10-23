import { describe, expect, it } from 'vitest';
import { sanitizeJevState } from './jev-state-sanitizer';

describe('sanitizeJevState', () => {
  it('keeps the default 2000-character limit for existing callers', () => {
    const input = { nested: { content: 'x'.repeat(3_000) }, items: ['y'.repeat(3_000)] };
    expect(sanitizeJevState(input)).toEqual({ nested: { content: 'x'.repeat(2_000) }, items: ['y'.repeat(2_000)] });
    expect(sanitizeJevState(input, 12_000)).toEqual(sanitizeJevState(input));
  });

  it('preserves complete safe long strings with an explicit bounded limit throughout recursion', () => {
    const content = 'safe source '.repeat(400);
    const input = { nested: { content }, items: [content] };
    expect(sanitizeJevState(input, 12_000, { maxStringCharacters: 6_000 })).toEqual(input);
  });

  it('redacts a secret crossing 2000 on the full text before slicing', () => {
    const prefix = 'x'.repeat(1_990) + ' ';
    const secret = 'sk-' + 'a'.repeat(60);
    const content = prefix + secret + ' safe ending';
    const explicit = sanitizeJevState({ content }, 12_000, { maxStringCharacters: 4_000 });
    expect(explicit).toEqual({ content: prefix + '[REDACTED] safe ending' });
    expect(sanitizeJevState({ content })).toEqual({ content: (prefix + '[REDACTED] safe ending').slice(0, 2_000) });
  });

  it.each([0, -1, 65_537, 1.5, NaN, Infinity, -Infinity])('rejects invalid string limit %s with a static error', (maxStringCharacters) => {
    expect(() => sanitizeJevState({ content: 'SECRET' }, 12_000, { maxStringCharacters })).toThrow(/^Invalid Jev sanitizer limits\.$/);
  });

  it('accepts both inclusive string-limit boundaries', () => {
    expect(sanitizeJevState({ content: 'safe' }, 12_000, { maxStringCharacters: 1 })).toEqual({ content: 's' });
    const content = 'x'.repeat(65_536);
    expect(sanitizeJevState({ content }, 70_000, { maxStringCharacters: 65_536 })).toEqual({ content });
  });

  it('retains the whole payload budget despite an expanded string limit', () => {
    const result = sanitizeJevState({ content: 'x'.repeat(6_000) }, 500, { maxStringCharacters: 6_000 });
    expect(result).toHaveProperty('truncatedState');
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(500);
  });

  it('does not expand the depth or entry limits', () => {
    const input = { rows: Array.from({ length: 51 }, () => 'safe'), nested: { a: { b: { c: { d: { content: 'safe' } } } } } };
    const result = sanitizeJevState(input, 12_000, { maxStringCharacters: 65_536 });
    expect(result.rows).toHaveLength(50);
    expect(result.nested).toEqual({ a: { b: { c: { d: { content: '[TRUNCATED]' } } } } });
  });
  it('redacts sensitive fields and common secrets embedded in command strings', () => {
    const state = sanitizeJevState({
      operation: {
        apiKey: 'do-not-send',
        command: 'curl --token hidden-token -H "Authorization: Bearer hidden-bearer" https://user:password@host.test',
        environment: 'OPENAI_API_KEY=hidden-api-key',
        nested: { refreshToken: 'hidden-refresh-token' },
      },
    });
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain('do-not-send');
    expect(serialized).not.toContain('hidden-token');
    expect(serialized).not.toContain('hidden-bearer');
    expect(serialized).not.toContain('user:password');
    expect(serialized).not.toContain('hidden-api-key');
    expect(serialized).not.toContain('hidden-refresh-token');
    expect(serialized).toContain('curl');
  });

  it('bounds cyclic and oversized state while retaining safe context', () => {
    const cycle: Record<string, unknown> = { label: 'safe operation' };
    cycle['self'] = cycle;
    const state = sanitizeJevState({ cycle, detail: 'x'.repeat(2_000) }, 500);

    expect(JSON.stringify(state).length).toBeLessThanOrEqual(500);
    expect(JSON.stringify(state)).toContain('safe operation');
    expect(JSON.stringify(state)).toContain('truncatedState');
  });

  it('redacts common cloud access IDs, JWTs, and fine-grained GitHub tokens in free text', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart1234567890';
    const state = sanitizeJevState({
      command: `deploy --access-id AKIAIOSFODNN7EXAMPLE --session ${jwt} github_pat_123456789012345678901234567890`,
    });
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(serialized).not.toContain(jwt);
    expect(serialized).not.toContain('github_pat_123456789012345678901234567890');
  });

  it('redacts private and access keys, including PEM blocks in otherwise safe fields', () => {
    const privateKey = 'private-key-material';
    const accessKey = 'access-key-material';
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nssh-private-material\n-----END OPENSSH PRIVATE KEY-----';
    const state = sanitizeJevState({
      privateKey,
      accessKey,
      command: `cloud sync --secret-access-key hidden-cloud-secret\nssh-add <<'KEY'\n${pem}\nKEY`,
    });
    const serialized = JSON.stringify(state);

    expect(serialized).not.toContain(privateKey);
    expect(serialized).not.toContain(accessKey);
    expect(serialized).not.toContain('hidden-cloud-secret');
    expect(serialized).not.toContain('ssh-private-material');
    expect(serialized).toContain('[REDACTED]');
  });
});
