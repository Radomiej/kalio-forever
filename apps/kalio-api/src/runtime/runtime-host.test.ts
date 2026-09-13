import { describe, expect, it } from 'vitest';
import { isEmbeddedUiEnabled, resolveRuntimeHost } from './runtime-host';

describe('runtime host contract', () => {
  it('keeps development default compatibility', () => {
    expect(resolveRuntimeHost({})).toBe('0.0.0.0');
    expect(resolveRuntimeHost({ KALIO_HOST: '127.0.0.1' })).toBe('127.0.0.1');
  });

  it('forces packaged profiles to loopback', () => {
    expect(resolveRuntimeHost({ KALIO_INSTALL_PROFILE: 'runtime' })).toBe('127.0.0.1');
    expect(resolveRuntimeHost({ KALIO_INSTALL_PROFILE: 'desktop', KALIO_HOST: '::1' })).toBe('::1');
    expect(() => resolveRuntimeHost({
      KALIO_INSTALL_PROFILE: 'runtime',
      KALIO_HOST: '0.0.0.0',
    })).toThrow('must bind to loopback');
  });

  it('uses an explicit embedded UI flag', () => {
    expect(isEmbeddedUiEnabled({ KALIO_SERVE_UI: 'true' })).toBe(true);
    expect(isEmbeddedUiEnabled({ KALIO_SERVE_UI: 'false' })).toBe(false);
  });
});
