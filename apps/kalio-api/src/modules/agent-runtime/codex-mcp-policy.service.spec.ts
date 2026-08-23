import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from '../../database/app-settings.service';
import { CodexMcpPolicyService } from './codex-mcp-policy.service';

describe('CodexMcpPolicyService', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps inherited Codex MCP disabled by default', async () => {
    const settings = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } as unknown as AppSettingsService;
    const service = new CodexMcpPolicyService(settings);

    await expect(service.get('chatgpt-default')).resolves.toEqual({ inheritConfiguredMcp: false, source: 'default' });
  });

  it('uses the environment only when no profile setting exists', async () => {
    vi.stubEnv('KALIO_CODEX_INHERIT_MCP', 'true');
    const settings = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } as unknown as AppSettingsService;
    const service = new CodexMcpPolicyService(settings);

    await expect(service.get('chatgpt-default')).resolves.toEqual({ inheritConfiguredMcp: true, source: 'environment' });
  });

  it('prefers the persisted profile setting over the environment', async () => {
    vi.stubEnv('KALIO_CODEX_INHERIT_MCP', 'true');
    const settings = { get: vi.fn(async () => 'false'), set: vi.fn(async () => undefined) } as unknown as AppSettingsService;
    const service = new CodexMcpPolicyService(settings);

    await expect(service.get('chatgpt-default')).resolves.toEqual({ inheritConfiguredMcp: false, source: 'settings' });
    expect(settings.get).toHaveBeenCalledWith('codex.mcp.inherit.chatgpt-default');
  });

  it('persists an explicit profile toggle', async () => {
    const settings = { get: vi.fn(async () => null), set: vi.fn(async () => undefined) } as unknown as AppSettingsService;
    const service = new CodexMcpPolicyService(settings);

    await expect(service.update('chatgpt-default', true)).resolves.toEqual({ inheritConfiguredMcp: true, source: 'settings' });
    expect(settings.set).toHaveBeenCalledWith('codex.mcp.inherit.chatgpt-default', 'true');
  });
});
