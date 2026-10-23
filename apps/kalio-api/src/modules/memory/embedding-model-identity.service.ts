import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { normalizeEmbeddingBaseUrl } from './embedding-identity';

const MAX_RESPONSE_BYTES = 1024 * 1024;

@Injectable()
export class EmbeddingModelIdentityService {
  async resolve(baseUrl: string, model: string, owner: string): Promise<{ modelRevision: string; providerScope: string }> {
    const unresolved = { modelRevision: 'unresolved', providerScope: 'unresolved' };
    let url: URL;
    try { url = new URL(baseUrl); } catch { return unresolved; }
    if (!['http:', 'https:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash) return unresolved;
    const endpoint = normalizeEmbeddingBaseUrl(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(`${endpoint}/api/tags`, { signal: controller.signal, redirect: 'error' });
      if (!response.ok || !response.body) return unresolved;
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) return unresolved;
      reader = response.body.getReader();
      const parts: Uint8Array[] = []; let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_RESPONSE_BYTES) return unresolved;
        parts.push(part.value);
      }
      const input: unknown = JSON.parse(Buffer.concat(parts).toString('utf8'));
      if (!input || typeof input !== 'object' || !('models' in input) || !Array.isArray(input.models)) return unresolved;
      const exact = model.includes(':') ? model : `${model}:latest`;
      const matches = input.models.filter((entry: unknown) => !!entry && typeof entry === 'object'
        && 'name' in entry && entry.name === exact);
      if (matches.length !== 1) return unresolved;
      const entry: unknown = matches[0];
      if (!entry || typeof entry !== 'object' || !('digest' in entry) || typeof entry.digest !== 'string'
        || !/^(?:sha256:)?[a-f0-9]{64}$/.test(entry.digest)) return unresolved;
      return { modelRevision: entry.digest.replace(/^sha256:/, ''),
        providerScope: `scope-${createHash('sha256').update(JSON.stringify([owner, endpoint])).digest('hex')}` };
    } catch (error) {
      // Unavailable metadata cannot establish immutable identity.
      if (!(error instanceof Error)) throw error;
      return unresolved;
    } finally {
      clearTimeout(timer); controller.abort(); reader?.releaseLock();
    }
  }
}
