import { describe, expect, it, vi } from 'vitest';
import type { ExecutionProfile } from '@kalio/types';
import type { CodexAppServerHostStatus } from './codex-app-server.host';
import { NativeCliIntegrationController } from './native-cli-integration.controller';

const profile = (id: string, model: string, authProfileId = 'chatgpt-default'): ExecutionProfile => ({
  id,
  name: id,
  kind: 'codex-app-server',
  model,
  authProfileId,
  approvalMode: 'kalio_strict',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
});

const status = (authProfileId: string): CodexAppServerHostStatus => ({
  authProfileId,
  status: 'offline',
  connected: false,
  openSessionCount: 0,
});

describe('NativeCliIntegrationController', () => {
  it('groups Codex profiles and exposes their persisted MCP policy', async () => {
    const policy = { get: vi.fn(async () => ({ inheritConfiguredMcp: false, source: 'default' as const })) };
    const host = { getStatus: vi.fn((authProfileId: string) => status(authProfileId)) };
    const profiles = { list: vi.fn(async () => [profile('codex-luna', 'gpt-5.6-luna'), profile('codex-spark', 'gpt-5.3-codex-spark', 'spark')]) };
    const controller = new NativeCliIntegrationController(profiles as never, host as never, policy as never);

    await expect(controller.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'codex:chatgpt-default',
        profileIds: ['codex-luna'],
        models: ['gpt-5.6-luna'],
        mcp: { inheritConfiguredMcp: false, source: 'default' },
      }),
      expect.objectContaining({ id: 'codex:spark', profileIds: ['codex-spark'], models: ['gpt-5.3-codex-spark'] }),
    ]);
  });

  it('persists the MCP toggle and resets the affected process', async () => {
    const policy = {
      get: vi.fn(async () => ({ inheritConfiguredMcp: false, source: 'default' as const })),
      update: vi.fn(async () => ({ inheritConfiguredMcp: true, source: 'settings' as const })),
    };
    const host = { getStatus: vi.fn(() => status('chatgpt-default')), reset: vi.fn(async () => undefined) };
    const profiles = { list: vi.fn(async () => [profile('codex-luna', 'gpt-5.6-luna')]) };
    const controller = new NativeCliIntegrationController(profiles as never, host as never, policy as never);

    await expect(controller.updateSettings('chatgpt-default', { inheritConfiguredMcp: true })).resolves.toEqual({
      inheritConfiguredMcp: true,
      source: 'settings',
    });
    expect(policy.update).toHaveBeenCalledWith('chatgpt-default', true);
    expect(host.reset).toHaveBeenCalledWith('chatgpt-default');
  });

  it('rejects malformed settings and unknown integrations', async () => {
    const policy = { get: vi.fn(async () => ({ inheritConfiguredMcp: false, source: 'default' as const })) };
    const host = { getStatus: vi.fn(() => status('chatgpt-default')) };
    const profiles = { list: vi.fn(async () => [profile('codex-luna', 'gpt-5.6-luna')]) };
    const controller = new NativeCliIntegrationController(profiles as never, host as never, policy as never);

    await expect(controller.updateSettings('chatgpt-default', { inheritConfiguredMcp: 'true' }))
      .rejects.toThrow('inheritConfiguredMcp must be a boolean');
    await expect(controller.getSettings('missing')).rejects.toThrow('Native CLI integration not found');
  });
});
