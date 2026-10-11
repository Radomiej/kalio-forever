import { createHash } from 'node:crypto';
import type { EmbeddingSpace } from '@kalio/types';

export type EmbeddingPurpose = 'document' | 'query' | 'code_query';
export const RAW_EMBEDDING_PROMPT_VERSION = 'raw-v1';
export const GEMMA2_EMBEDDING_PROMPT_VERSION = 'embeddinggemma2-task-v1';
export const EMBEDDING_NORMALIZATION_VERSION = 'provider-native-no-client-normalization-v1';

export function embeddingPromptVersions(promptVersion: string): Pick<EmbeddingSpace,
  'documentPromptVersion' | 'queryPromptVersion' | 'codeQueryPromptVersion' | 'normalizationVersion'> {
  const gemma = promptVersion === GEMMA2_EMBEDDING_PROMPT_VERSION;
  return { documentPromptVersion: gemma ? 'embeddinggemma2-document-v1' : 'raw-document-v1',
    queryPromptVersion: gemma ? 'embeddinggemma2-query-v1' : 'raw-query-v1',
    codeQueryPromptVersion: gemma ? 'embeddinggemma2-code-query-v1' : 'raw-code-query-v1',
    normalizationVersion: EMBEDDING_NORMALIZATION_VERSION };
}

/** Only the EmbeddingGemma2 family, not generative Gemma2 or EmbeddingGemma1. */
export function isEmbeddingGemma2(model: string): boolean {
  return /^(?:[^/]+\/)?embeddinggemma-?2(?:$|[:@-])/.test(model.toLowerCase());
}

/** Endpoint identity contains no authentication material, query or fragment. */
export function normalizeEmbeddingBaseUrl(baseUrl: string): string {
  if (baseUrl === 'mock' || baseUrl === '') return baseUrl;
  if (baseUrl.startsWith('local-cache:')) return baseUrl.split('#')[0]!.replace(/\\/g, '/').replace(/\/+$/, '');
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch { throw new Error('EMBEDDING_ENDPOINT_INVALID'); }
}

function embeddingSpaceId(descriptor: Omit<EmbeddingSpace, 'id'>): string {
  const { provider, providerScope, backend, endpointFingerprint, model, modelRevision, dimensions, promptVersion,
    documentPromptVersion, queryPromptVersion, codeQueryPromptVersion, normalizationVersion } = descriptor;
  const canonical = JSON.stringify({ provider, providerScope, backend, endpointFingerprint, model, modelRevision,
    dimensions, promptVersion, documentPromptVersion, queryPromptVersion, codeQueryPromptVersion, normalizationVersion });
  return `${provider}-${createHash('sha256').update(canonical).digest('hex')}`;
}

/** Integrity check only: an internally valid descriptor is not producer trust or immutable weights. */
export function verifyEmbeddingSpaceIdentity(value: unknown): value is EmbeddingSpace {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = ['id', 'provider', 'providerScope', 'backend', 'endpointFingerprint', 'model', 'modelRevision', 'dimensions',
    'promptVersion', 'documentPromptVersion', 'queryPromptVersion', 'codeQueryPromptVersion', 'normalizationVersion'];
  if (Reflect.ownKeys(value).length !== keys.length || keys.some(key => !descriptors[key]?.enumerable
    || !Object.hasOwn(descriptors[key]!, 'value'))) return false;
  const space = value as EmbeddingSpace;
  if (keys.filter(key => key !== 'dimensions').some(key => typeof descriptors[key]!.value !== 'string')
    || !Number.isSafeInteger(space.dimensions) || space.dimensions <= 0
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(space.provider)
    || !/^[a-zA-Z0-9._-]{1,128}$/.test(space.providerScope)
    || !/^[a-f0-9]{64}$/.test(space.endpointFingerprint)
    || keys.filter(key => key !== 'dimensions' && key !== 'backend').some(key => !String(descriptors[key]!.value).trim())) return false;
  return space.id === embeddingSpaceId(space);
}

export function buildEmbeddingSpace(input: Omit<EmbeddingSpace, 'id' | 'endpointFingerprint'> & { baseUrl: string }): EmbeddingSpace {
  if (!Number.isSafeInteger(input.dimensions) || input.dimensions <= 0 || !input.model || !input.provider) {
    throw new Error('EMBEDDING_SPACE_INVALID');
  }
  const { provider, providerScope, model, modelRevision, dimensions, promptVersion,
    documentPromptVersion, queryPromptVersion, codeQueryPromptVersion, normalizationVersion } = input;
  if (typeof providerScope !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(providerScope)
    || [modelRevision, promptVersion, documentPromptVersion, queryPromptVersion, codeQueryPromptVersion, normalizationVersion]
      .some(value => typeof value !== 'string' || !value.trim())) throw new Error('EMBEDDING_SPACE_INVALID');
  const endpointFingerprint = createHash('sha256').update(normalizeEmbeddingBaseUrl(input.baseUrl)).digest('hex');
  const descriptor = { provider, providerScope, backend: input.backend, endpointFingerprint, model, modelRevision, dimensions, promptVersion,
    documentPromptVersion, queryPromptVersion, codeQueryPromptVersion, normalizationVersion };
  const space = { id: embeddingSpaceId(descriptor), ...descriptor };
  if (!verifyEmbeddingSpaceIdentity(space)) throw new Error('EMBEDDING_SPACE_INVALID');
  return Object.freeze(space);
}

export function preparePinnedEmbeddingTexts(space: EmbeddingSpace, texts: string[], purpose: EmbeddingPurpose): string[] {
  if (!['document', 'query', 'code_query'].includes(purpose) || !Array.isArray(texts)
    || texts.some(text => typeof text !== 'string')) throw new Error('EMBEDDING_INPUT_INVALID');
  for (let index = 0; index < texts.length; index++) {
    if (typeof texts[index] !== 'string') throw new Error('EMBEDDING_INPUT_INVALID');
  }
  if (space.promptVersion !== GEMMA2_EMBEDDING_PROMPT_VERSION) return [...texts];
  const prefix = purpose === 'document' ? 'title: none | text: '
    : purpose === 'query' ? 'task: search result | query: ' : 'task: code retrieval | query: ';
  return texts.map(text => prefix + text);
}

export function validateEmbeddingVectors(vectors: unknown, count: number, dimensions: number): asserts vectors is number[][] {
  if (!Array.isArray(vectors) || vectors.length !== count) throw new Error('EMBEDDING_VECTORS_INVALID');
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimensions) throw new Error('EMBEDDING_VECTORS_INVALID');
    for (let index = 0; index < dimensions; index++) {
      if (typeof vector[index] !== 'number' || !Number.isFinite(vector[index])) throw new Error('EMBEDDING_VECTORS_INVALID');
    }
  }
}
