import { describe, expect, it } from 'vitest';
import { sanitizeJevState } from './jev-state-sanitizer';

describe('sanitizeJevState', () => {
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
