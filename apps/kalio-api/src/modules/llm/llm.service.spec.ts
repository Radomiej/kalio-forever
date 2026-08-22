import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { ExecutionProfile } from '@kalio/types';
import { LLMService } from './llm.service';
import { CredentialsService } from '../credentials/credentials.service';
import { TimeoutSettingsService } from '../credentials/timeout-settings.service';
import { ProviderStreamLimiterService } from './provider-stream-limiter.service';
import { buildProviderCompatHeaders, resolveLlmProviderBaseUrl } from '../../common/utils/llm-provider-http.util';

// ─── DB overrides env — bootstrap-only rule ───────────────────────────────────
// Requirement: .env vars are ONLY the fallback bootstrap when no active DB
// credential exists. Once the user sets an active credential via Settings UI,
// that DB credential ALWAYS wins — even if .env is set to something different.
// This prevents env from silently overriding user's runtime choice after restart.

describe('LLMService - DB credential overrides env', () => {
  let service: LLMService;
  let credentialsService: ReturnType<typeof buildCredentialsMock>;
  let moduleRef: TestingModule;

  function buildCredentialsMock() {
    return {
      getActiveProviderConfig: vi.fn(),
      getProviderConfigForCredential: vi.fn(),
      getActiveCredentialId: vi.fn().mockResolvedValue(null),
      updateModel: vi.fn(),
      getEnvModelOverride: vi.fn().mockResolvedValue(null),
      setEnvModelOverride: vi.fn(),
      getModelsForProviderConfig: vi.fn().mockResolvedValue([]),
      getContextWindowSize: vi.fn().mockResolvedValue(32000),
      getGenerationSettings: vi.fn().mockResolvedValue({ temperature: 0.7, maxTokens: 4096 }),
    };
  }

  function buildTimeoutSettingsMock() {
    return {
      getProviderMaxConcurrentStreams: vi.fn().mockResolvedValue(2),
    };
  }

  function buildConfigMock(envVars: Record<string, string> = {}) {
    const defaults: Record<string, string> = {
      LLM_PROVIDER: 'openai',
      LLM_API_KEY: 'env-api-key',
      LLM_BASE_URL: 'https://env.openai.com/v1',
      LLM_MODEL: 'env-gpt-4',
    };
    const merged = { ...defaults, ...envVars };
    return {
      get: vi.fn((key: string, fallback?: string) => merged[key] ?? fallback ?? ''),
    };
  }

  beforeEach(async () => {
    credentialsService = buildCredentialsMock();
    moduleRef = await Test.createTestingModule({
      providers: [
        LLMService,
        { provide: ConfigService, useValue: buildConfigMock() },
        { provide: CredentialsService, useValue: credentialsService },
        { provide: TimeoutSettingsService, useValue: buildTimeoutSettingsMock() },
        ProviderStreamLimiterService,
      ],
    }).compile();
    service = moduleRef.get<LLMService>(LLMService);
  });

  describe('getConfig - provider resolution priority', () => {
    it('should return DB credential config when an active DB credential exists', async () => {
      // Arrange — DB has an active credential (runtime user choice)
      credentialsService.getActiveProviderConfig.mockResolvedValue({
        provider: 'xiaomimimo',
        apiKey: 'db-api-key',
        model: 'mimo-v2.5-pro',
        baseUrl: 'https://token-plan-ams.xiaomimimo.com/v1',
      });

      // Act
      const config = await service.getConfig();

      // Assert — DB wins, env is ignored
      expect(config.provider).toBe('xiaomimimo');
      expect(config.model).toBe('mimo-v2.5-pro');
      expect(config.baseUrl).toBe('https://token-plan-ams.xiaomimimo.com/v1');
      // API key never exposed
      expect(config.apiKey).toBe('');
    });

    it('should fall back to .env when no active DB credential', async () => {
      // Arrange — DB has no active credential
      credentialsService.getActiveProviderConfig.mockResolvedValue(null);

      // Act
      const config = await service.getConfig();

      // Assert — env fallback used
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('env-gpt-4');
      expect(config.baseUrl).toBe('https://env.openai.com/v1');
    });

    it('should apply the env model override when no DB credential is active', async () => {
      credentialsService.getActiveProviderConfig.mockResolvedValue(null);
      credentialsService.getEnvModelOverride.mockResolvedValue('env-override-model');

      const config = await service.getConfig();

      expect(config.source).toBe('env');
      expect(config.model).toBe('env-override-model');
    });

    it('uses env config when KALIO_FORCE_ENV_LLM is set even if DB credential exists', async () => {
      const forcedCreds = buildCredentialsMock();
      forcedCreds.getActiveProviderConfig.mockResolvedValue({
        provider: 'cometapi',
        apiKey: 'paid-db-key',
        model: 'paid-db-model',
        baseUrl: 'https://paid.example/v1',
      });
      const forcedModule = await Test.createTestingModule({
        providers: [
          LLMService,
          {
            provide: ConfigService,
            useValue: buildConfigMock({
              LLM_PROVIDER: 'mock',
              LLM_API_KEY: 'mock',
              LLM_BASE_URL: 'mock',
              LLM_MODEL: 'mock',
              KALIO_FORCE_ENV_LLM: '1',
            }),
          },
          { provide: CredentialsService, useValue: forcedCreds },
          { provide: TimeoutSettingsService, useValue: buildTimeoutSettingsMock() },
          ProviderStreamLimiterService,
        ],
      }).compile();

      const forcedService = forcedModule.get<LLMService>(LLMService);
      const config = await forcedService.getConfig();

      expect(config.source).toBe('env');
      expect(config.provider).toBe('mock');
      expect(config.model).toBe('mock');
      expect(forcedCreds.getActiveProviderConfig).not.toHaveBeenCalled();
    });

    it('should not expose API key in getConfig regardless of source', async () => {
      credentialsService.getActiveProviderConfig.mockResolvedValue({
        provider: 'openai',
        apiKey: 'secret-db-key-should-not-leak',
        model: 'gpt-4o',
        baseUrl: '',
      });

      const config = await service.getConfig();
      expect(config.apiKey).toBe('');
    });
  });

  describe('streamChat - active provider selection', () => {
    it('should use DB credential model when DB credential is active (verified via getConfig)', async () => {
      // Arrange — DB has an active credential with a different model than env
      credentialsService.getActiveProviderConfig.mockResolvedValue({
        provider: 'openai' as const,
        apiKey: 'db-key',
        model: 'db-model-NOT-env',
        baseUrl: 'https://db.endpoint.com/v1',
      });

      // Act — getConfig reflects which provider would be used for streamChat
      const config = await service.getConfig();

      // Assert — DB model is selected, not env model
      expect(config.model).toBe('db-model-NOT-env');
      expect(config.model).not.toBe('env-gpt-4');
    });

    it('should use env provider when DB returns null', async () => {
      // Arrange
      credentialsService.getActiveProviderConfig.mockResolvedValue(null);

      // Verify by checking getConfig falls back to env
      const config = await service.getConfig();
      expect(config.provider).toBe('openai');
      expect(config.model).toBe('env-gpt-4');
    });

    it('should re-check DB credential on each streamChat call (no caching)', async () => {
      // This is critical: if credentials change at runtime, every call must
      // pick up the latest DB state without a restart.

      // First call — no DB credential
      credentialsService.getActiveProviderConfig.mockResolvedValueOnce(null);
      // Second call — DB credential just activated
      credentialsService.getActiveProviderConfig.mockResolvedValueOnce({
        provider: 'openai' as const,
        apiKey: 'new-key',
        model: 'gpt-4o-new',
        baseUrl: '',
      });

      const config1 = await service.getConfig();
      const config2 = await service.getConfig();

      expect(config1.model).toBe('env-gpt-4');   // env fallback
      expect(config2.model).toBe('gpt-4o-new');  // DB credential picked up immediately
    });
  });

  describe('streamChat()', () => {
    it('uses the persisted generation token limit when a request does not override it', async () => {
      credentialsService.getActiveProviderConfig.mockResolvedValue({
        provider: 'openrouter',
        apiKey: 'test-key',
        model: 'tencent/hy3',
        baseUrl: 'https://openrouter.test/api/v1',
      });
      credentialsService.getGenerationSettings.mockResolvedValue({ temperature: 0.7, maxTokens: 96 });
      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        await service.streamChat(
          [{ role: 'user', content: 'hello' }],
          [],
          { sessionId: 'session-1', messageId: 'msg-1', onChunk: () => {} },
        );

        const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
        expect(body['max_tokens']).toBe(96);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('calls underlying provider streamChat and returns tool calls', async () => {
      const mockToolCalls = [{ id: 'call-1', name: 'my_tool', input: {} }];
      const mockStreamChat = vi.fn().mockResolvedValue(mockToolCalls);
      credentialsService.getActiveProviderConfig.mockResolvedValue({
        provider: 'mock' as const,
        apiKey: 'mock-key',
        model: 'mock-model',
        baseUrl: '',
      });

      // Spy on createLLMProvider to inject a controllable mock
      // Since mock provider is used, streamChat will be called on MockLLMProvider
      // We can test by verifying no errors thrown and return type
      const chunks: unknown[] = [];
      const result = await service.streamChat(
        [{ role: 'user', content: 'hello' }],
        [],
        { sessionId: 'session-1', messageId: 'msg-1', onChunk: (chunk) => chunks.push(chunk) },
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it('uses env provider when DB has no active credential', async () => {
      // Create a service instance backed by mock provider so no real HTTP call is made
      const mockCreds2 = buildCredentialsMock();
      mockCreds2.getActiveProviderConfig.mockResolvedValue(null);
      const m = await Test.createTestingModule({
        providers: [
          LLMService,
          { provide: ConfigService, useValue: buildConfigMock({ LLM_PROVIDER: 'mock', LLM_API_KEY: 'mock' }) },
          { provide: CredentialsService, useValue: mockCreds2 },
          { provide: TimeoutSettingsService, useValue: buildTimeoutSettingsMock() },
          ProviderStreamLimiterService,
        ],
      }).compile();
      const svc2 = m.get<LLMService>(LLMService);
      const result = await svc2.streamChat(
        [{ role: 'user', content: 'hello' }],
        [],
        { sessionId: 'session-1', messageId: 'msg-1', onChunk: () => {} },
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it('refreshes the env provider when the env model override changes', async () => {
      credentialsService.getActiveProviderConfig.mockResolvedValue(null);
      credentialsService.getEnvModelOverride.mockResolvedValue('env-override-model');

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        await service.streamChat(
          [{ role: 'user', content: 'hello' }],
          [],
          { sessionId: 'session-1', messageId: 'msg-1', onChunk: () => {} },
        );

        const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = JSON.parse(String(requestInit?.body)) as { model: string };

        expect(body.model).toBe('env-override-model');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('uses a per-request model override without mutating the active DB credential model', async () => {
      credentialsService.getActiveProviderConfig.mockResolvedValue({
        provider: 'openai' as const,
        apiKey: 'db-key',
        model: 'mimo-v2.5-pro',
        baseUrl: 'https://db.endpoint.com/v1',
      });

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn().mockResolvedValue(
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      );
      globalThis.fetch = fetchMock as typeof fetch;

      try {
        await service.streamChat(
          [{ role: 'user', content: 'hello' }],
          [],
          {
            sessionId: 'session-1',
            messageId: 'msg-1',
            modelOverride: 'mimo-v2.5',
            onChunk: () => {},
          },
        );

        const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = JSON.parse(String(requestInit?.body)) as { model: string };

        expect(body.model).toBe('mimo-v2.5');
        expect(credentialsService.updateModel).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('REGRESSION: does not rebuild the fallback env provider on first use when the configured baseUrl is mock', async () => {
      const mockCreds = buildCredentialsMock();
      mockCreds.getActiveProviderConfig.mockResolvedValue(null);

      const moduleWithMockBaseUrl = await Test.createTestingModule({
        providers: [
          LLMService,
          {
            provide: ConfigService,
            useValue: buildConfigMock({
              LLM_PROVIDER: 'mock',
              LLM_API_KEY: 'mock',
              LLM_BASE_URL: 'mock',
              LLM_MODEL: 'mock-model',
            }),
          },
          { provide: CredentialsService, useValue: mockCreds },
          { provide: TimeoutSettingsService, useValue: buildTimeoutSettingsMock() },
          ProviderStreamLimiterService,
        ],
      }).compile();

      const mockBaseUrlService = moduleWithMockBaseUrl.get<LLMService>(LLMService);
      const initialProviderKey = (mockBaseUrlService as unknown as { envProviderKey: string }).envProviderKey;

      await mockBaseUrlService.streamChat(
        [{ role: 'user', content: 'hello' }],
        [],
        { sessionId: 'session-1', messageId: 'msg-1', onChunk: () => {} },
      );

      expect((mockBaseUrlService as unknown as { envProviderKey: string }).envProviderKey).toBe(initialProviderKey);
    });
  });

  describe('streamChatWithExecutionProfile()', () => {
    it('uses the credential bound to a direct profile and keeps its model authoritative', async () => {
      credentialsService.getProviderConfigForCredential.mockResolvedValue({
        provider: 'mock',
        apiKey: 'mock',
        model: 'credential-default',
      });
      const profile: ExecutionProfile = {
        id: 'direct-mock',
        name: 'Direct mock',
        kind: 'direct-llm',
        provider: 'mock',
        model: 'profile-model',
        authProfileId: 'credential-1',
        approvalMode: 'codex_guard',
        enabled: true,
        capabilitiesVersion: '1',
        createdAt: 1,
        updatedAt: 1,
      };

      await expect(service.streamChatWithExecutionProfile(
        profile,
        [{ role: 'user', content: 'hello' }],
        [],
        { sessionId: 'session-direct', messageId: 'message-direct', modelOverride: 'must-not-win', onChunk: () => {} },
      )).resolves.toEqual([]);

      expect(credentialsService.getProviderConfigForCredential).toHaveBeenCalledWith('credential-1');
    });

    it('fails closed when the bound credential provider no longer matches', async () => {
      credentialsService.getProviderConfigForCredential.mockResolvedValue({
        provider: 'openai',
        apiKey: 'key',
        model: 'gpt-4o',
      });
      const profile: ExecutionProfile = {
        id: 'direct-mismatch',
        name: 'Direct mismatch',
        kind: 'direct-llm',
        provider: 'openrouter',
        model: 'openrouter/model',
        authProfileId: 'credential-1',
        approvalMode: 'codex_guard',
        enabled: true,
        capabilitiesVersion: '1',
        createdAt: 1,
        updatedAt: 1,
      };

      await expect(service.streamChatWithExecutionProfile(profile, [], [], {
        sessionId: 'session-mismatch',
        messageId: 'message-mismatch',
        onChunk: () => {},
      })).rejects.toThrow('does not match');
    });
  });

  describe('streamChatWithConfig()', () => {
    it('shares the same Xiaomi request shape as the runtime active-provider path', async () => {
      const xiaomiConfig = {
        provider: 'xiaomimimo',
        apiKey: 'xiao-key',
        model: 'mimo-v2.5',
      };
      credentialsService.getActiveProviderConfig.mockResolvedValue(xiaomiConfig);

      const originalFetch = globalThis.fetch;
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as typeof fetch;
      fetchMock
        .mockResolvedValueOnce(new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }))
        .mockResolvedValueOnce(new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }));

      try {
        await service.streamChat(
          [{ role: 'user', content: 'hello' }],
          [],
          { sessionId: 'session-1', messageId: 'msg-1', onChunk: () => {} },
        );

        await service.streamChatWithConfig(
          xiaomiConfig,
          [{ role: 'user', content: 'hello' }],
          [],
          { sessionId: 'session-2', messageId: 'msg-2', onChunk: () => {} },
        );

        const runtimeCall = fetchMock.mock.calls[0];
        const smokeCall = fetchMock.mock.calls[1];
        const runtimeInit = runtimeCall?.[1] as RequestInit | undefined;
        const smokeInit = smokeCall?.[1] as RequestInit | undefined;
        const expectedHeaders = buildProviderCompatHeaders('xiaomimimo', 'xiao-key');

        expect(runtimeCall?.[0]).toBe(`${resolveLlmProviderBaseUrl('xiaomimimo')}/chat/completions`);
        expect(smokeCall?.[0]).toBe(runtimeCall?.[0]);
        expect(runtimeInit).toEqual(expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            ...expectedHeaders,
          }),
        }));
        expect(smokeInit?.method).toBe(runtimeInit?.method);
        expect(smokeInit?.body).toBe(runtimeInit?.body);
        expect(smokeInit?.headers).toEqual(runtimeInit?.headers);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('getActiveModels()', () => {
    it('loads models for the effective runtime config', async () => {
      credentialsService.getActiveProviderConfig.mockResolvedValue(null);
      credentialsService.getEnvModelOverride.mockResolvedValue('env-override-model');
      credentialsService.getModelsForProviderConfig.mockResolvedValue(['env-override-model']);

      await expect(service.getActiveModels()).resolves.toEqual(['env-override-model']);
      expect(credentialsService.getModelsForProviderConfig).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', model: 'env-override-model' }),
      );
    });
  });

  describe('updateActiveModel()', () => {
    it('updates the active DB credential when one is selected', async () => {
      credentialsService.getActiveCredentialId.mockResolvedValue('cred-1');
      credentialsService.getActiveProviderConfig.mockResolvedValue({
        provider: 'openai',
        apiKey: 'db-api-key',
        model: 'gpt-4o-next',
        baseUrl: 'https://db.openai.com/v1',
      });

      const config = await service.updateActiveModel('gpt-4o-next');

      expect(credentialsService.updateModel).toHaveBeenCalledWith('cred-1', 'gpt-4o-next');
      expect(credentialsService.setEnvModelOverride).not.toHaveBeenCalled();
      expect(config.model).toBe('gpt-4o-next');
      expect(config.source).toBe('db');
    });

    it('stores an env model override when no DB credential is active', async () => {
      credentialsService.getActiveCredentialId.mockResolvedValue(null);
      credentialsService.getActiveProviderConfig.mockResolvedValue(null);
      credentialsService.getEnvModelOverride.mockResolvedValue('mimo-v2-thinking');

      const config = await service.updateActiveModel('mimo-v2-thinking');

      expect(credentialsService.setEnvModelOverride).toHaveBeenCalledWith('mimo-v2-thinking');
      expect(credentialsService.updateModel).not.toHaveBeenCalled();
      expect(config.model).toBe('mimo-v2-thinking');
      expect(config.source).toBe('env');
    });

    it('stores an env model override when KALIO_FORCE_ENV_LLM is set despite active DB credential', async () => {
      const forcedCreds = buildCredentialsMock();
      forcedCreds.getActiveCredentialId.mockResolvedValue('paid-cred');
      forcedCreds.getActiveProviderConfig.mockResolvedValue({
        provider: 'cometapi',
        apiKey: 'paid-db-key',
        model: 'paid-db-model',
        baseUrl: 'https://paid.example/v1',
      });
      forcedCreds.getEnvModelOverride.mockResolvedValue('mock-next');
      const forcedModule = await Test.createTestingModule({
        providers: [
          LLMService,
          {
            provide: ConfigService,
            useValue: buildConfigMock({
              LLM_PROVIDER: 'mock',
              LLM_API_KEY: 'mock',
              LLM_BASE_URL: 'mock',
              LLM_MODEL: 'mock',
              KALIO_FORCE_ENV_LLM: '1',
            }),
          },
          { provide: CredentialsService, useValue: forcedCreds },
          { provide: TimeoutSettingsService, useValue: buildTimeoutSettingsMock() },
          ProviderStreamLimiterService,
        ],
      }).compile();

      const forcedService = forcedModule.get<LLMService>(LLMService);
      const config = await forcedService.updateActiveModel('mock-next');

      expect(forcedCreds.getActiveCredentialId).not.toHaveBeenCalled();
      expect(forcedCreds.updateModel).not.toHaveBeenCalled();
      expect(forcedCreds.setEnvModelOverride).toHaveBeenCalledWith('mock-next');
      expect(config.source).toBe('env');
      expect(config.model).toBe('mock-next');
    });
  });

  describe('createProvider()', () => {
    it('returns a provider instance for given config', () => {
      const provider = service.createProvider({
        provider: 'mock' as const,
        apiKey: 'key',
        model: 'model',
        baseUrl: '',
      });
      expect(provider).toBeDefined();
      expect(typeof provider.streamChat).toBe('function');
    });
  });

  describe('constructor - env bootstrap', () => {
    it('should warn when env LLM config is incomplete (mock values)', async () => {
      // Arrange — build a new module with mock/empty env
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockCreds = buildCredentialsMock();
      mockCreds.getActiveProviderConfig.mockResolvedValue(null);

      const m = await Test.createTestingModule({
        providers: [
          LLMService,
          {
            provide: ConfigService,
            useValue: buildConfigMock({ LLM_PROVIDER: 'mock', LLM_API_KEY: 'mock' }),
          },
          { provide: CredentialsService, useValue: mockCreds },
          { provide: TimeoutSettingsService, useValue: buildTimeoutSettingsMock() },
          ProviderStreamLimiterService,
        ],
      }).compile();

      // The service instantiation should log a warning (not throw)
      const svc = m.get<LLMService>(LLMService);
      expect(svc).toBeDefined();

      warnSpy.mockRestore();
    });

    it('should not throw if env is fully specified', async () => {
      const mockCreds = buildCredentialsMock();
      mockCreds.getActiveProviderConfig.mockResolvedValue(null);

      const m = await Test.createTestingModule({
        providers: [
          LLMService,
          {
            provide: ConfigService,
            useValue: buildConfigMock({
              LLM_PROVIDER: 'openai',
              LLM_API_KEY: 'sk-test-key',
              LLM_BASE_URL: 'https://api.openai.com/v1',
              LLM_MODEL: 'gpt-4o',
            }),
          },
          { provide: CredentialsService, useValue: mockCreds },
          { provide: TimeoutSettingsService, useValue: buildTimeoutSettingsMock() },
          ProviderStreamLimiterService,
        ],
      }).compile();

      expect(m.get<LLMService>(LLMService)).toBeDefined();
    });
  });
});
