import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_RESOURCE_READER, type EmbeddingSpace } from '@kalio/types';
import { DecisionAuthService } from '../../common/decision-auth.service';
import { EmbeddingService } from './embedding.service';
import { ProjectResourceAuthGuard } from './project-resource-auth.guard';
import { ProjectResourceIndexController } from './project-resource-index.controller';
import { ProjectResourceIndexService } from './project-resource-index.service';
import { buildEmbeddingSpace } from './embedding-identity';
import { ProjectContextSettingsService } from './project-context-settings.service';
import { DrizzleService } from '../../database/drizzle.service';
import { AppSettingsService } from '../../database/app-settings.service';
import { ProjectContextSettingsController } from './project-context-settings.controller';
import { ProjectContextSettingsGuard } from './project-context-settings.guard';

describe('resource HTTP to real SQLite', () => {
  let app: INestApplication; let root: string; let url: string;
  let currentSpace: EmbeddingSpace;
  let embeddingFailure: Error | undefined;
  const token = 'ac'.repeat(32);
  const space: EmbeddingSpace = buildEmbeddingSpace({ provider: 'mock', providerScope: 'test', backend: '', baseUrl: 'mock', model: 'fixture', modelRevision: '1', dimensions: 2,
    promptVersion: '1', documentPromptVersion: '1', queryPromptVersion: '1', codeQueryPromptVersion: '1', normalizationVersion: '1' });
  beforeEach(async () => {
    currentSpace = space;
    embeddingFailure = undefined;
    root = mkdtempSync(join(tmpdir(), 'kalio-resource-http-'));
    const authEnv = { PORT: '0', KALIO_CONTROL_PLANE_TOKEN: token, KALIO_DECISION_FRONTEND_ORIGINS: 'http://localhost:5288' };
    const values = new Map([['project_context_settings', JSON.stringify({ enabled: true, modelRevision: '1', providerScope: 'test' })]]);
    const module = await Test.createTestingModule({ controllers: [ProjectResourceIndexController, ProjectContextSettingsController], providers: [ProjectResourceIndexService, ProjectResourceAuthGuard, ProjectContextSettingsService, ProjectContextSettingsGuard,
      { provide: ConfigService, useValue: new ConfigService({ MEMORY_DB_PATH: root }) },
      { provide: AppSettingsService, useValue: { get: async (key: string) => values.get(key) ?? null,
        set: async (key: string, value: string) => { values.set(key, value); } } },
      { provide: DrizzleService, useValue: {} },
      { provide: DecisionAuthService, useValue: new DecisionAuthService(authEnv) },
      { provide: EmbeddingService, useValue: { ensureCurrentIdentity: async () => ({ modelRevision: currentSpace.modelRevision, providerScope: currentSpace.providerScope }), captureSpace: () => currentSpace, getStatus: () => ({ configured: true, provider: 'mock' }),
        getDocumentSizer: async () => undefined,
        embedPinned: async (_space: EmbeddingSpace, texts: string[]) => { if (embeddingFailure) throw embeddingFailure; return texts.map(() => [1, 0]); } } },
      { provide: PROJECT_RESOURCE_READER, useValue: { readProject: async (projectId: string) => ({ projectId, complete: true, skipped: [], files: [
        { path: 'src/build.ts', sizeBytes: 20, content: Buffer.from('export function compileAssets() {}') },
      ] }) } },
    ] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1'); url = await app.getUrl();
    authEnv.PORT = new URL(url).port;
  });
  afterEach(async () => { await app?.close(); if (root) rmSync(root, { recursive: true, force: true }); });
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  it('returns explicit 409 for mutable Ollama inference while status and settings expose metadata only', async () => {
    currentSpace = buildEmbeddingSpace({ provider: 'ollama', providerScope: 'test', backend: '', baseUrl: 'http://localhost:11434',
      model: 'model:latest', modelRevision: 'a'.repeat(64), dimensions: 2, promptVersion: '1', documentPromptVersion: '1',
      queryPromptVersion: '1', codeQueryPromptVersion: '1', normalizationVersion: '1' });
    expect(await (await fetch(`${url}/api/memory/project-context/settings`, { headers })).json())
      .toEqual({ enabled: true, modelRevision: 'a'.repeat(64), providerScope: 'test' });
    expect(await (await fetch(`${url}/api/memory/project-resources/p/status`, { headers })).json())
      .toMatchObject({ space: { provider: 'ollama' }, indexedChunks: 0 });
    for (const action of ['index', 'search']) {
      const response = await fetch(`${url}/api/memory/project-resources/p/${action}`, { method: 'PUT', headers,
        body: JSON.stringify(action === 'search' ? { query: 'compileAssets' } : {}) });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ code: 'EMBEDDING_IMMUTABLE_INFERENCE_REQUIRED' });
    }
  });
  it('protects settings GET/PUT and disables index/search through persisted policy', async () => {
    const route = `${url}/api/memory/project-context/settings`;
    expect((await fetch(route)).status).toBe(403);
    expect((await fetch(route, { method: 'PUT', headers, body: '{"enabled":false}' })).status).toBe(200);
    const settings = { enabled: false, modelRevision: '', providerScope: 'local-user' };
    const updated = await fetch(route, { method: 'PUT', headers, body: JSON.stringify(settings) });
    const derived = { enabled: false, modelRevision: '1', providerScope: 'test' };
    expect(updated.status).toBe(200); expect(await updated.json()).toEqual(derived);
    expect(await (await fetch(route, { headers })).json()).toEqual(derived);
    for (const action of ['index', 'search']) {
      const response = await fetch(`${url}/api/memory/project-resources/p/${action}`, { method: 'PUT', headers,
        body: JSON.stringify(action === 'search' ? { query: 'compileAssets' } : {}) });
      expect(response.status).toBe(403); expect(await response.json()).toEqual({ code: 'PROJECT_CONTEXT_DISABLED' });
    }
  });
  it('indexes then searches a registered-source fixture through actual HTTP', async () => {
    const indexed = await fetch(`${url}/api/memory/project-resources/p/index`, { method: 'PUT', headers, body: '{}' });
    expect(indexed.status).toBe(200); expect(await indexed.json()).toMatchObject({ indexedFiles: 1, indexedChunks: 1 });
    const found = await fetch(`${url}/api/memory/project-resources/p/search`, { method: 'PUT', headers, body: JSON.stringify({ query: 'compileAssets', mode: 'fts' }) });
    expect(found.status).toBe(200); expect(await found.json()).toMatchObject([{ path: 'src/build.ts', resourceType: 'code' }]);
  });
  it('returns a bounded query error without replacing the current index', async () => {
    expect((await fetch(`${url}/api/memory/project-resources/p/index`, { method: 'PUT', headers, body: '{}' })).status).toBe(200);
    embeddingFailure = new Error('EMBEDDING_INPUT_TOO_LONG');
    const found = await fetch(`${url}/api/memory/project-resources/p/search`, { method: 'PUT', headers,
      body: JSON.stringify({ query: 'too long', mode: 'vector' }) });
    expect(found.status).toBe(400);
    expect(await found.json()).toEqual({ code: 'EMBEDDING_INPUT_TOO_LONG' });
    expect(await (await fetch(`${url}/api/memory/project-resources/p/status`, { headers })).json()).toMatchObject({ indexedChunks: 1 });
  });
  it('rejects unauthenticated access and malformed consent without index mutation', async () => {
    expect((await fetch(`${url}/api/memory/project-resources/p/status`)).status).toBe(403);
    expect((await fetch(`${url}/api/memory/project-resources/p/index`, { method: 'PUT', headers, body: '{"allowRemoteProcessing":"true"}' })).status).toBe(400);
    const status = await fetch(`${url}/api/memory/project-resources/p/status`, { headers });
    expect(await status.json()).toMatchObject({ indexedChunks: 0 });
  });
});
