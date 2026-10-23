import { describe, expect, it } from 'vitest';
import { buildEmbeddingSpace, isEmbeddingGemma2, normalizeEmbeddingBaseUrl, preparePinnedEmbeddingTexts,
  validateEmbeddingVectors, verifyEmbeddingSpaceIdentity, GEMMA2_EMBEDDING_PROMPT_VERSION } from './embedding-identity';

const identity = { provider: 'ollama', providerScope: 'deployment-a', model: 'embeddinggemma2', modelRevision: 'unresolved', dimensions: 2,
  backend: '', baseUrl: 'http://localhost:11434', promptVersion: 'raw-v1',
  documentPromptVersion: 'raw-document-v1', queryPromptVersion: 'raw-query-v1',
  codeQueryPromptVersion: 'raw-code-query-v1', normalizationVersion: 'provider-native-no-client-normalization-v1' };

describe('canonical embedding identity', () => {
  it.each(['provider', 'providerScope', 'model', 'modelRevision', 'dimensions', 'backend', 'baseUrl', 'promptVersion',
    'documentPromptVersion', 'queryPromptVersion', 'codeQueryPromptVersion', 'normalizationVersion'] as const)(
    'binds exact %s', key => {
      const changed = { ...identity, [key]: key === 'dimensions' ? 3
        : key === 'baseUrl' ? 'http://localhost:11434/different' : `${identity[key]}-changed` };
      expect(buildEmbeddingSpace(changed).id).not.toBe(buildEmbeddingSpace(identity).id);
    });
  it('normalizes endpoint host/default port/trailing slash but preserves path case', () => {
    expect(normalizeEmbeddingBaseUrl('HTTP://LOCALHOST:80/v1///?token=x#secret')).toBe('http://localhost/v1');
    expect(buildEmbeddingSpace({ ...identity, baseUrl: 'http://localhost:11434/V1' }).id)
      .not.toBe(buildEmbeddingSpace({ ...identity, baseUrl: 'http://localhost:11434/v1' }).id);
  });
  it('hashes a deterministic canonical tuple and returns no raw endpoint/credentials', () => {
    const space = buildEmbeddingSpace(identity);
    expect(space).toEqual(buildEmbeddingSpace({ ...identity }));
    expect(Object.keys(space).sort()).toEqual(['backend', 'codeQueryPromptVersion', 'dimensions', 'documentPromptVersion', 'endpointFingerprint', 'id',
      'model', 'modelRevision', 'normalizationVersion', 'promptVersion', 'provider', 'providerScope', 'queryPromptVersion']);
    expect(Object.isFrozen(space)).toBe(true);
  });
  it('verifies the exact ID using only the serialized public descriptor', () => {
    const space = JSON.parse(JSON.stringify(buildEmbeddingSpace(identity))) as unknown;
    expect(verifyEmbeddingSpaceIdentity(space)).toBe(true);
    const original = buildEmbeddingSpace(identity);
    for (const field of Object.keys(original)) {
      expect(verifyEmbeddingSpaceIdentity({ ...original, [field]: field === 'dimensions' ? 3 : 'tampered' })).toBe(false);
    }
    expect(verifyEmbeddingSpaceIdentity({ ...original, extra: true })).toBe(false);
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid dimensions %s', dimensions => {
    expect(() => buildEmbeddingSpace({ ...identity, dimensions })).toThrow('EMBEDDING_SPACE_INVALID');
  });
  it.each(['not a url', 'file:///secret', 'ftp://host'])('rejects invalid endpoint %s', baseUrl => {
    expect(() => buildEmbeddingSpace({ ...identity, baseUrl })).toThrow('EMBEDDING_ENDPOINT_INVALID');
  });
  it.each(['gemma2', 'google/gemma-2-2b', 'embeddinggemma', 'embeddinggemma2ish', 'foo/other'])('does not prompt unrelated model %s', model => {
    expect(isEmbeddingGemma2(model)).toBe(false);
  });
  it.each(['embeddinggemma2', 'embeddinggemma2:latest', 'google/embeddinggemma2-1b', 'embeddinggemma-2:270m', 'google/embeddinggemma-2'])('recognizes exact family %s', model => {
    expect(isEmbeddingGemma2(model)).toBe(true);
  });
  it('never transforms caller input in place and preserves raw text for other models', () => {
    const input = ['text'];
    const raw = buildEmbeddingSpace(identity);
    expect(preparePinnedEmbeddingTexts(raw, input, 'query')).toEqual(input);
    preparePinnedEmbeddingTexts({ ...raw, promptVersion: GEMMA2_EMBEDDING_PROMPT_VERSION }, input, 'query');
    expect(input).toEqual(['text']);
  });
  it('rejects sparse vectors instead of treating missing values as valid', () => {
    expect(() => validateEmbeddingVectors([new Array<number>(2)], 1, 2)).toThrow('EMBEDDING_VECTORS_INVALID');
  });
  it('rejects sparse texts before sending null input to a provider', () => {
    expect(() => preparePinnedEmbeddingTexts(buildEmbeddingSpace(identity), new Array<string>(1), 'document'))
      .toThrow('EMBEDDING_INPUT_INVALID');
  });
});
