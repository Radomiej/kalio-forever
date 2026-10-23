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

const claudeProfile = (id: string): ExecutionProfile => ({
  id,
  name: id,
  kind: 'claude-agent-sdk',
  model: 'claude-sonnet-4',
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
  function catalogController() {
    let current: CodexAppServerHostStatus = { ...status('chatgpt-default'), status: 'online', connected: true, processEpoch: 'epoch-1' };
    const request = vi.fn().mockResolvedValue({ data: [{ model: 'current-model' }], nextCursor: null });
    const host = {
      getStatus: vi.fn(() => current),
      getConnection: vi.fn(async () => ({ processEpoch: 'epoch-1', request })),
    };
    const policy = { get: vi.fn(async () => ({ inheritConfiguredMcp: false, source: 'default' as const })) };
    const profiles = { list: vi.fn(async () => [profile('codex-strict', 'obsolete-model')]) };
    const controller = new NativeCliIntegrationController(profiles as never, host as never, policy as never);
    return { controller, host, request, changeHost: (next: CodexAppServerHostStatus) => { current = next; } };
  }

  it('returns only explicitly discovered models and polling never starts the host', async () => {
    const { controller, host } = catalogController();
    await expect(controller.getModels('chatgpt-default')).resolves.toBeNull();
    expect(host.getConnection).not.toHaveBeenCalled();
    await expect(controller.checkModels('chatgpt-default')).resolves.toMatchObject({ models: ['current-model'], processEpoch: 'epoch-1' });
    await expect(controller.getModels('chatgpt-default')).resolves.toMatchObject({ models: ['current-model'] });
    expect(host.getConnection).toHaveBeenCalledOnce();
  });

  it('invalidates a catalog when the host disconnects or changes epoch', async () => {
    const { controller, changeHost } = catalogController();
    await controller.checkModels('chatgpt-default');
    changeHost(status('chatgpt-default'));
    await expect(controller.getModels('chatgpt-default')).resolves.toBeNull();
    changeHost({ ...status('chatgpt-default'), status: 'online', connected: true, processEpoch: 'epoch-2' });
    await expect(controller.getModels('chatgpt-default')).resolves.toBeNull();
  });

  it('does not cache a response from a reset host and allows retry after an error', async () => {
    const { controller, request, changeHost } = catalogController();
    request.mockImplementationOnce(async () => {
      changeHost(status('chatgpt-default'));
      return { data: [{ model: 'current-model' }], nextCursor: null };
    });
    await expect(controller.checkModels('chatgpt-default')).rejects.toThrow('host changed');
    await expect(controller.getModels('chatgpt-default')).resolves.toBeNull();
    changeHost({ ...status('chatgpt-default'), status: 'online', connected: true, processEpoch: 'epoch-1' });
    await expect(controller.checkModels('chatgpt-default')).resolves.toMatchObject({ models: ['current-model'] });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('coalesces simultaneous checks on the same connection', async () => {
    const { controller, request } = catalogController();
    const checks = await Promise.all([controller.checkModels('chatgpt-default'), controller.checkModels('chatgpt-default')]);
    expect(checks.map((check) => check.models)).toEqual([['current-model'], ['current-model']]);
    expect(request).toHaveBeenCalledOnce();
  });

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

  it('checks a configured Codex process and returns a real status after reset', async () => {
    const policy = { get: vi.fn(async () => ({ inheritConfiguredMcp: false, source: 'default' as const })) };
    const host = {
      getStatus: vi.fn(() => status('chatgpt-default')),
      getConnection: vi.fn(async () => ({ processEpoch: 'epoch-1' })),
      reset: vi.fn(async () => undefined),
    };
    const profiles = { list: vi.fn(async () => [profile('codex-luna', 'gpt-5.6-luna')]) };
    const controller = new NativeCliIntegrationController(profiles as never, host as never, policy as never);

    await expect(controller.check('chatgpt-default')).resolves.toMatchObject({
      authProfileId: 'chatgpt-default',
      status: 'offline',
    });
    await expect(controller.reset('chatgpt-default')).resolves.toMatchObject({
      authProfileId: 'chatgpt-default',
      status: 'offline',
    });
    expect(host.getConnection).toHaveBeenCalledWith('chatgpt-default', 'settings-check');
    expect(host.reset).toHaveBeenCalledWith('chatgpt-default');
  });

  it('uses cached Claude status for list polling and refreshes it once on explicit check', async () => {
    const policy = { get: vi.fn(async () => ({ inheritConfiguredMcp: false, source: 'default' as const })) };
    const host = { getStatus: vi.fn(() => status('claude-login')) };
    const profiles = { list: vi.fn(async () => [claudeProfile('claude-login')]) };
    const freshProbe = {
      id: 'claude',
      displayName: 'Claude Code',
      installUrl: 'https://example.invalid/claude',
      available: true,
      version: '1.0.0',
      supportsModelSelection: true,
    };
    const cliAgents = {
      probe: vi.fn(async () => ({ available: true, version: '1.0.0' })),
      refreshProbe: vi.fn(async () => freshProbe),
    };
    const controller = new NativeCliIntegrationController(profiles as never, host as never, policy as never, cliAgents as never);

    await expect(controller.list()).resolves.toMatchObject([
      { status: 'offline', connected: false, probeChecked: false },
    ]);
    expect(cliAgents.probe).not.toHaveBeenCalled();

    await expect(controller.check('claude-login')).resolves.toMatchObject({
      status: 'online', connected: true, probeChecked: true, processEpoch: '1.0.0',
    });
    expect(cliAgents.refreshProbe).toHaveBeenCalledOnce();
    expect(cliAgents.probe).not.toHaveBeenCalled();
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
