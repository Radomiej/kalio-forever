import { describe, expect, it } from 'vitest';
import {
  isControlPlaneTokenValid,
  resolveControlPlaneAuthSettings,
} from './control-plane-auth';

const TEST_TOKEN = 'a'.repeat(64);

describe('control-plane authentication settings', () => {
  it('requires a 32-byte token for production and packaged profiles', () => {
    for (const env of [
      { NODE_ENV: 'production', KALIO_CONTROL_PLANE_TOKEN: TEST_TOKEN },
      { NODE_ENV: 'development', KALIO_INSTALL_PROFILE: 'desktop', KALIO_CONTROL_PLANE_TOKEN: TEST_TOKEN },
      { NODE_ENV: 'development', KALIO_INSTALL_PROFILE: 'runtime', KALIO_CONTROL_PLANE_TOKEN: TEST_TOKEN },
    ]) {
      expect(resolveControlPlaneAuthSettings(env).enabled).toBe(true);
    }
  });

  it('rejects missing or malformed tokens in secure profiles', () => {
    expect(() => resolveControlPlaneAuthSettings({ NODE_ENV: 'production' })).toThrow(/64 hexadecimal/);
    expect(() => resolveControlPlaneAuthSettings({
      NODE_ENV: 'production',
      KALIO_CONTROL_PLANE_TOKEN: 'short',
    })).toThrow(/64 hexadecimal/);
    expect(() => resolveControlPlaneAuthSettings({
      NODE_ENV: 'production',
      KALIO_CONTROL_PLANE_AUTH: 'disabled',
    })).toThrow(/forbidden/);
  });

  it('allows an explicit development bypass only on loopback', () => {
    expect(resolveControlPlaneAuthSettings({
      NODE_ENV: 'development',
      KALIO_CONTROL_PLANE_AUTH: 'disabled',
      KALIO_HOST: '127.0.0.1',
    }).enabled).toBe(false);
    expect(() => resolveControlPlaneAuthSettings({
      NODE_ENV: 'development',
      KALIO_CONTROL_PLANE_AUTH: 'disabled',
      KALIO_HOST: '0.0.0.0',
    })).toThrow(/loopback/);
    expect(() => resolveControlPlaneAuthSettings({
      NODE_ENV: 'development',
      KALIO_CONTROL_PLANE_AUTH: 'disabled',
    })).toThrow(/loopback/);
  });
});

describe('control-plane bearer verification', () => {
  const expectedToken = Buffer.from(TEST_TOKEN, 'hex');

  it('accepts only the exact bearer token', () => {
    expect(isControlPlaneTokenValid(`Bearer ${TEST_TOKEN}`, expectedToken)).toBe(true);
    expect(isControlPlaneTokenValid(`Bearer ${'b'.repeat(64)}`, expectedToken)).toBe(false);
    expect(isControlPlaneTokenValid(`Basic ${TEST_TOKEN}`, expectedToken)).toBe(false);
    expect(isControlPlaneTokenValid(`Bearer ${TEST_TOKEN} `, expectedToken)).toBe(false);
    expect(isControlPlaneTokenValid(undefined, expectedToken)).toBe(false);
  });
});
