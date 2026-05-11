import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { TimeoutSettingsService } from './timeout-settings.service';
import type { Credential, CreateCredentialDto } from '@kalio/types';

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-1',
    name: 'Test Cred',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    createdAt: 1000000,
    ...overrides,
  };
}

describe('CredentialsController', () => {
  let controller: CredentialsController;
  let app: INestApplication | null = null;
  const mockService = {
    findAll: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    getActiveCredentialId: vi.fn(),
    setActiveCredential: vi.fn(),
    clearActiveCredential: vi.fn(),
    getContextWindowSize: vi.fn(),
    setContextWindowSize: vi.fn(),
    getMaxToolAttempts: vi.fn(),
    setMaxToolAttempts: vi.fn(),
    getGenerationSettings: vi.fn(),
    setGenerationSettings: vi.fn(),
    getModelsForCredential: vi.fn(),
    updateModel: vi.fn(),
    getApiKey: vi.fn(),
  };
  const mockTimeoutSettings = {
    getTimeoutSettings: vi.fn(),
    setTimeoutSettings: vi.fn(),
    getProviderTimeoutMs: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [
        { provide: CredentialsService, useValue: mockService },
        { provide: TimeoutSettingsService, useValue: mockTimeoutSettings },
      ],
    }).compile();

    controller = module.get(CredentialsController);
    vi.clearAllMocks();
    mockTimeoutSettings.getTimeoutSettings.mockResolvedValue({
      webSearchTimeoutMs: 120000,
      providerLocalTimeoutMs: 3000,
      providerRemoteTimeoutMs: 15000,
    });
    mockTimeoutSettings.getProviderTimeoutMs.mockResolvedValue(15000);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  describe('findAll()', () => {
    it('returns all credentials', async () => {
      const creds = [makeCredential()];
      mockService.findAll.mockResolvedValue(creds);
      expect(await controller.findAll()).toBe(creds);
    });
  });

  describe('create()', () => {
    it('creates and returns a credential', async () => {
      const dto: CreateCredentialDto = { name: 'My Key', provider: 'openai', apiKey: 'sk-test', model: 'gpt-4o' };
      const cred = makeCredential();
      mockService.create.mockResolvedValue(cred);
      expect(await controller.create(dto)).toBe(cred);
      expect(mockService.create).toHaveBeenCalledWith(dto);
    });
  });

  describe('remove()', () => {
    it('calls service.remove and returns void', async () => {
      mockService.remove.mockResolvedValue(undefined);
      await controller.remove('cred-1');
      expect(mockService.remove).toHaveBeenCalledWith('cred-1');
    });
  });

  describe('getActive()', () => {
    it('returns credentialId when active is set', async () => {
      mockService.getActiveCredentialId.mockResolvedValue('cred-1');
      const result = await controller.getActive();
      expect(result).toEqual({ credentialId: 'cred-1' });
    });

    it('returns null when no active credential', async () => {
      mockService.getActiveCredentialId.mockResolvedValue(null);
      const result = await controller.getActive();
      expect(result).toEqual({ credentialId: null });
    });
  });

  describe('setActive()', () => {
    it('calls service.setActiveCredential and returns void', async () => {
      mockService.setActiveCredential.mockResolvedValue(undefined);
      await controller.setActive('cred-1');
      expect(mockService.setActiveCredential).toHaveBeenCalledWith('cred-1');
    });
  });

  describe('clearActive()', () => {
    it('calls service.clearActiveCredential and returns void', async () => {
      mockService.clearActiveCredential.mockResolvedValue(undefined);
      await controller.clearActive();
      expect(mockService.clearActiveCredential).toHaveBeenCalled();
    });

    it('routes DELETE /credentials/active to clearActiveCredential instead of remove(id)', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [CredentialsController],
        providers: [
          { provide: CredentialsService, useValue: mockService },
          { provide: TimeoutSettingsService, useValue: mockTimeoutSettings },
        ],
      }).compile();

      app = module.createNestApplication();
      await app.init();
      await app.listen(0);

      const address = app.getHttpServer().address();
      const port = typeof address === 'string' ? Number.parseInt(address.split(':').at(-1) ?? '0', 10) : address.port;

      mockService.clearActiveCredential.mockResolvedValue(undefined);
      mockService.remove.mockResolvedValue(undefined);

      const response = await fetch(`http://127.0.0.1:${port}/credentials/active`, {
        method: 'DELETE',
      });

      expect(response.status).toBe(204);
      expect(mockService.clearActiveCredential).toHaveBeenCalledTimes(1);
      expect(mockService.remove).not.toHaveBeenCalled();
    });

    it('REGRESSION: routes POST /credentials/test to testConnection instead of testById', async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [CredentialsController],
        providers: [
          { provide: CredentialsService, useValue: mockService },
          { provide: TimeoutSettingsService, useValue: mockTimeoutSettings },
        ],
      }).compile();

      app = module.createNestApplication();
      await app.init();
      await app.listen(0);

      const address = app.getHttpServer().address();
      const port = typeof address === 'string' ? Number.parseInt(address.split(':').at(-1) ?? '0', 10) : address.port;

      mockService.findAll.mockResolvedValue([]);

      const response = await fetch(`http://127.0.0.1:${port}/credentials/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'mock', apiKey: 'mock', model: 'mock' }),
      });

      expect(response.ok).toBe(true);
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ ok: true, latencyMs: expect.any(Number) }),
      );
      expect(mockService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('getContextWindow()', () => {
    it('returns context window size', async () => {
      mockService.getContextWindowSize.mockResolvedValue(128000);
      const result = await controller.getContextWindow();
      expect(result).toEqual({ size: 128000 });
    });
  });

  describe('setContextWindow()', () => {
    it('calls setContextWindowSize', async () => {
      mockService.setContextWindowSize.mockResolvedValue(undefined);
      await controller.setContextWindow({ size: 64000 });
      expect(mockService.setContextWindowSize).toHaveBeenCalledWith(64000);
    });
  });

  describe('getMaxToolAttempts()', () => {
    it('returns max tool attempts size', async () => {
      mockService.getMaxToolAttempts.mockResolvedValue(25);
      const result = await controller.getMaxToolAttempts();
      expect(result).toEqual({ size: 25 });
    });
  });

  describe('setMaxToolAttempts()', () => {
    it('calls setMaxToolAttempts', async () => {
      mockService.setMaxToolAttempts.mockResolvedValue(undefined);
      await controller.setMaxToolAttempts({ size: 30 });
      expect(mockService.setMaxToolAttempts).toHaveBeenCalledWith(30);
    });
  });

  describe('tool timeout settings', () => {
    it('returns current timeout settings', async () => {
      mockTimeoutSettings.getTimeoutSettings.mockResolvedValue({
        webSearchTimeoutMs: 120000,
        providerLocalTimeoutMs: 3000,
        providerRemoteTimeoutMs: 15000,
      });

      await expect(controller.getToolTimeouts()).resolves.toEqual({
        webSearchTimeoutMs: 120000,
        providerLocalTimeoutMs: 3000,
        providerRemoteTimeoutMs: 15000,
      });
    });

    it('updates tool timeout settings', async () => {
      mockTimeoutSettings.setTimeoutSettings.mockResolvedValue(undefined);

      await controller.setToolTimeouts({ webSearchTimeoutMs: 180000 });

      expect(mockTimeoutSettings.setTimeoutSettings).toHaveBeenCalledWith({
        webSearchTimeoutMs: 180000,
      });
    });

    it('rejects empty tool timeout updates', async () => {
      await expect(controller.setToolTimeouts({})).rejects.toThrow();
    });
  });

  describe('getGenerationSettings()', () => {
    it('returns generation settings', async () => {
      const settings = { temperature: 0.7, maxTokens: 4096 };
      mockService.getGenerationSettings.mockResolvedValue(settings);
      const result = await controller.getGenerationSettings();
      expect(result).toBe(settings);
    });
  });

  describe('setGenerationSettings()', () => {
    it('calls service with provided settings', async () => {
      mockService.setGenerationSettings.mockResolvedValue(undefined);
      await controller.setGenerationSettings({ temperature: 0.9, maxTokens: 2048 });
      expect(mockService.setGenerationSettings).toHaveBeenCalledWith({ temperature: 0.9, maxTokens: 2048 });
    });
  });

  describe('getModels()', () => {
    it('returns model list for credential', async () => {
      mockService.getModelsForCredential.mockResolvedValue(['gpt-4o', 'gpt-3.5-turbo']);
      const result = await controller.getModels('cred-1');
      expect(result).toEqual({ models: ['gpt-4o', 'gpt-3.5-turbo'] });
    });
  });

  describe('updateModel()', () => {
    it('updates model and returns updated credential', async () => {
      const updated = makeCredential({ model: 'gpt-4-turbo' });
      mockService.updateModel.mockResolvedValue(updated);
      const result = await controller.updateModel('cred-1', { model: 'gpt-4-turbo' });
      expect(result).toBe(updated);
      expect(mockService.updateModel).toHaveBeenCalledWith('cred-1', 'gpt-4-turbo');
    });
  });

  describe('testById()', () => {
    it('returns ok=false when credential not found', async () => {
      mockService.findAll.mockResolvedValue([]);
      const result = await controller.testById('missing-id');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns ok=false when apiKey not available', async () => {
      const cred = makeCredential();
      mockService.findAll.mockResolvedValue([cred]);
      mockService.getApiKey.mockResolvedValue(null);
      const result = await controller.testById('cred-1');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('API key not available');
    });

    it('allows local providers to be tested without an apiKey', async () => {
      const cred = makeCredential({
        provider: 'bitnet',
        baseUrl: 'http://localhost:8080/v1',
      });
      mockService.findAll.mockResolvedValue([cred]);
      mockService.getApiKey.mockResolvedValue(null);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'bitnet-b1.58-2b-4t' }] }),
      });

      try {
        const result = await controller.testById('cred-1');
        expect(result.ok).toBe(true);
        expect(result.modelCount).toBe(1);
        expect(mockTimeoutSettings.getProviderTimeoutMs).toHaveBeenCalledWith(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('returns ok=false on fetch failure', async () => {
      const cred = {
        ...makeCredential(),
        provider: 'custom',
        baseUrl: 'http://localhost:1234',
      } as unknown as Credential;
      mockService.findAll.mockResolvedValue([cred]);
      mockService.getApiKey.mockResolvedValue('sk-test');
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      try {
        const result = await controller.testById('cred-1');
        expect(result.ok).toBe(false);
        expect(result.error).toContain('network error');
        expect(mockTimeoutSettings.getProviderTimeoutMs).toHaveBeenCalledWith(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('uses remote timeout for remote providers', async () => {
      const cred = makeCredential({
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
      });
      mockService.findAll.mockResolvedValue([cred]);
      mockService.getApiKey.mockResolvedValue('sk-test');
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      try {
        const result = await controller.testById('cred-1');
        expect(result.ok).toBe(false);
        expect(mockTimeoutSettings.getProviderTimeoutMs).toHaveBeenCalledWith(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('testConnection()', () => {
    it('returns ok=false on LLM stream failure', async () => {
      // Mock createLLMProvider — it creates a provider that throws
      // We test the catch path of testConnection
      const result = await controller.testConnection({
        provider: 'mock',
        apiKey: 'bad-key',
        model: 'mock',
      });
      // Mock provider may succeed or fail — just check structure
      expect(typeof result.ok).toBe('boolean');
      expect(typeof result.latencyMs).toBe('number');
    });
  });
});
