import { describe, it, expect } from 'vitest';
import {
  buildProviderCompatHeaders,
  readEnvBooleanFlag,
  resolveLlmProviderBaseUrl,
  XIAOMI_BASE_URL,
  XIAOMI_CROSS_BORDER_HEADER,
  XIAOMI_COMPAT_HEADERS,
} from './llm-provider-http.util';

describe('llm-provider-http.util', () => {
  it('resolves default provider base URLs and trims trailing slashes from overrides', () => {
    expect(resolveLlmProviderBaseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(resolveLlmProviderBaseUrl('xiaomimimo')).toBe(XIAOMI_BASE_URL);
    expect(resolveLlmProviderBaseUrl('openai', 'https://example.test/v1/')).toBe('https://example.test/v1');
  });

  it('REGRESSION: falls back safely when provider is not a string or baseUrl is only whitespace', () => {
    expect(resolveLlmProviderBaseUrl(undefined as unknown as string, '   ')).toBe('https://api.openai.com/v1');
    expect(resolveLlmProviderBaseUrl({ provider: 'openai' } as unknown as string)).toBe('https://api.openai.com/v1');
  });

  it('adds Xiaomi compatibility headers together with authorization', () => {
    expect(buildProviderCompatHeaders('xiaomimimo', 'secret-token')).toEqual({
      Authorization: 'Bearer secret-token',
      ...XIAOMI_COMPAT_HEADERS,
      [XIAOMI_CROSS_BORDER_HEADER]: 'true',
    });
  });

  it('returns empty headers for standard providers when no api key is supplied', () => {
    expect(buildProviderCompatHeaders('openai')).toEqual({});
  });

  it('REGRESSION: returns Xiaomi compatibility headers without crashing when provider is non-string', () => {
    expect(buildProviderCompatHeaders('xiaomimimo')).toEqual({
      ...XIAOMI_COMPAT_HEADERS,
      [XIAOMI_CROSS_BORDER_HEADER]: 'true',
    });
    expect(buildProviderCompatHeaders(undefined as unknown as string)).toEqual({});
  });

  it('REGRESSION: sends Xiaomi MiFE cross-border access header by default and allows disabling it', () => {
    const original = process.env.XIAOMI_MIFE_ALLOW_CROSS_BORDER_ACCESS;
    try {
      delete process.env.XIAOMI_MIFE_ALLOW_CROSS_BORDER_ACCESS;
      expect(buildProviderCompatHeaders('xiaomimimo')).toMatchObject({
        [XIAOMI_CROSS_BORDER_HEADER]: 'true',
      });

      process.env.XIAOMI_MIFE_ALLOW_CROSS_BORDER_ACCESS = 'false';
      expect(buildProviderCompatHeaders('xiaomimimo')).not.toHaveProperty(XIAOMI_CROSS_BORDER_HEADER);
    } finally {
      if (original === undefined) {
        delete process.env.XIAOMI_MIFE_ALLOW_CROSS_BORDER_ACCESS;
      } else {
        process.env.XIAOMI_MIFE_ALLOW_CROSS_BORDER_ACCESS = original;
      }
    }
  });

  it('exposes a single shared Xiaomi compatibility identity for base URL and headers', () => {
    expect(XIAOMI_BASE_URL).toBe('https://token-plan-ams.xiaomimimo.com/v1');
    expect(XIAOMI_COMPAT_HEADERS).toMatchObject({
      'X-AI-Code-Tool': 'Roo Code',
      'X-Client-Source': 'roo-code',
    });
  });

  it('parses explicit boolean env flags without changing the default fallback', () => {
    expect(readEnvBooleanFlag(undefined, true)).toBe(true);
    expect(readEnvBooleanFlag(undefined, false)).toBe(false);
    expect(readEnvBooleanFlag('true', false)).toBe(true);
    expect(readEnvBooleanFlag('false', true)).toBe(false);
    expect(readEnvBooleanFlag('  false  ', true)).toBe(false);
  });
});
