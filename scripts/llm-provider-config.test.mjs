import test from 'node:test';
import assert from 'node:assert/strict';

import {
  allowGenericProviderFallbacks,
  resolveProviderSetting,
} from './llm-provider-config.mjs';

test('generic provider fallbacks are allowed only when explicit and configured providers match', () => {
  assert.equal(allowGenericProviderFallbacks({ explicitProvider: undefined, configuredProvider: 'xiaomimimo' }), true);
  assert.equal(allowGenericProviderFallbacks({ explicitProvider: 'openrouter', configuredProvider: undefined }), true);
  assert.equal(allowGenericProviderFallbacks({ explicitProvider: 'OpenRouter', configuredProvider: 'openrouter' }), true);
  assert.equal(allowGenericProviderFallbacks({ explicitProvider: 'openrouter', configuredProvider: 'xiaomimimo' }), false);
});

test('provider setting resolution ignores generic env values when provider fallback is disallowed', () => {
  assert.equal(resolveProviderSetting({
    allowGenericFallback: false,
    envValue: 'mimo-v2.5-pro',
    fileEnvValue: 'mimo-v2.5',
    providerDefault: 'cohere/north-mini-code:free',
  }), 'cohere/north-mini-code:free');
  assert.equal(resolveProviderSetting({
    allowGenericFallback: true,
    envValue: 'env-value',
    fileEnvValue: 'file-value',
    providerDefault: 'provider-default',
  }), 'env-value');
});
