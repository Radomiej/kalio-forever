import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { LLMController } from './llm.controller';
import { LLMService } from './llm.service';
import { CredentialsService } from '../credentials/credentials.service';
import { TimeoutSettingsService } from '../credentials/timeout-settings.service';

describe('LLMController', () => {
  let controller: LLMController;
  const mockLLMService = {
    getConfig: vi.fn(),
  };
  const mockCredentials = {
    getContextWindowSize: vi.fn(),
    getMaxToolAttempts: vi.fn(),
  };
  const mockTimeoutSettings = {
    getProviderTimeoutMs: vi.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LLMController],
      providers: [
        { provide: LLMService, useValue: mockLLMService },
        { provide: CredentialsService, useValue: mockCredentials },
        { provide: TimeoutSettingsService, useValue: mockTimeoutSettings },
      ],
    }).compile();

    controller = module.get(LLMController);
    vi.clearAllMocks();
    mockTimeoutSettings.getProviderTimeoutMs.mockResolvedValue(15_000);
  });

  describe('getConfig()', () => {
    it('returns merged config with contextWindowSize', async () => {
      mockLLMService.getConfig.mockResolvedValue({
        provider: 'openai',
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        source: 'db',
      });
      mockCredentials.getContextWindowSize.mockResolvedValue(128000);
      mockCredentials.getMaxToolAttempts.mockResolvedValue(25);

      const result = await controller.getConfig();
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
      expect(result.contextWindowSize).toBe(128000);
      expect(result.maxToolAttempts).toBe(25);
      expect(result.source).toBe('db');
    });

    it('returns env-source config when no DB credential active', async () => {
      mockLLMService.getConfig.mockResolvedValue({
        provider: 'openai',
        apiKey: '',
        baseUrl: '',
        model: '',
        source: 'env',
      });
      mockCredentials.getContextWindowSize.mockResolvedValue(8192);
      mockCredentials.getMaxToolAttempts.mockResolvedValue(8);

      const result = await controller.getConfig();
      expect(result.source).toBe('env');
      expect(result.contextWindowSize).toBe(8192);
      expect(result.maxToolAttempts).toBe(8);
    });
  });

  describe('getModels() — validation', () => {
    it('throws BadRequest when provider is missing', async () => {
      await expect(controller.getModels('', undefined, undefined)).rejects.toThrow(
        HttpException,
      );
    });

    it('throws BadRequest when apiKey missing for non-local provider', async () => {
      // openai requires apiKey
      await expect(controller.getModels('openai', undefined, undefined)).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('helper: isLocalBaseUrl', () => {
    it('passes through for ollama provider (no apiKey needed)', async () => {
      // For ollama, no apiKey is required — it should try to fetch from localhost
      // We mock fetch to simulate unreachable local endpoint
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('connection refused'), { name: 'Error' }));

      try {
        await expect(controller.getModels('ollama', undefined, undefined)).rejects.toThrow(HttpException);
        // Should throw BAD_GATEWAY (not BadRequest) since validation passed
        try {
          await controller.getModels('ollama', undefined, undefined);
        } catch (err) {
          expect((err as HttpException).getStatus()).toBe(HttpStatus.BAD_GATEWAY);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('passes for bitnet provider (no apiKey needed)', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      try {
        await expect(controller.getModels('bitnet', undefined, undefined)).rejects.toThrow(HttpException);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('getModels() — successful fetch', () => {
    it('uses configured remote provider timeout', async () => {
      const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      mockTimeoutSettings.getProviderTimeoutMs.mockResolvedValue(42_000);
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }] }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        await controller.getModels('openai', 'sk-test-key', undefined);
        expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 42_000);
      } finally {
        timeoutSpy.mockRestore();
        globalThis.fetch = originalFetch;
      }
    });

    it('returns model list from provider', async () => {
      mockTimeoutSettings.getProviderTimeoutMs.mockResolvedValue(15_000);
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }, { id: 'gpt-3.5-turbo' }] }),
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mockFetch;

      try {
        const result = await controller.getModels('openai', 'sk-test-key', undefined);
        expect(Array.isArray((result as { data: unknown[] }).data)).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('throws HttpException on non-ok response', async () => {
      mockTimeoutSettings.getProviderTimeoutMs.mockResolvedValue(15_000);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: { message: 'Unauthorized' } })),
      });

      try {
        await expect(controller.getModels('openai', 'bad-key', undefined)).rejects.toThrow(HttpException);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
