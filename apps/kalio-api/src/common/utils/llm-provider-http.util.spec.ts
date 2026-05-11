import { describe, it, expect } from 'vitest';
import {
  buildProviderCompatHeaders,
  resolveLlmProviderBaseUrl,
} from './llm-provider-http.util';

describe('llm-provider-http.util', () => {
  it('resolves default provider base URLs and trims trailing slashes from overrides', () => {
    expect(resolveLlmProviderBaseUrl('openai')).toBe('https://api.openai.com/v1');
    expect(resolveLlmProviderBaseUrl('openai', 'https://example.test/v1/')).toBe('https://example.test/v1');
  });

  it('adds Xiaomi compatibility headers together with authorization', () => {
    expect(buildProviderCompatHeaders('xiaomimimo', 'secret-token')).toEqual({
      Authorization: 'Bearer secret-token',
      'HTTP-Referer': 'https://github.com/RooVetGit/Roo-Cline',
      'X-Title': 'Roo Code',
      'User-Agent': 'RooCode/3.17.0',
    });
  });

  it('returns empty headers for standard providers when no api key is supplied', () => {
    expect(buildProviderCompatHeaders('openai')).toEqual({});
  });
});