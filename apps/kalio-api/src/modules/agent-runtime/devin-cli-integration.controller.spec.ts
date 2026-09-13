import { describe, expect, it, vi } from 'vitest';
import { DevinCliIntegrationController } from './devin-cli-integration.controller';

describe('DevinCliIntegrationController', () => {
  function createController(options: { token?: string | null; source?: 'settings' | 'environment' | 'none' } = {}) {
    const nativeToolsPolicy = {
      get: vi.fn(async () => ({ filesystem: false, web: false, terminal: false, source: 'default' as const })),
      update: vi.fn(async (value) => ({ ...value, source: 'settings' as const })),
    };
    const tokenService = {
      getStatus: vi.fn(async () => ({ enabled: Boolean(options.token), source: options.source ?? 'none' })),
      setOverride: vi.fn(async () => ({ enabled: true, source: 'settings' as const })),
      generate: vi.fn(async () => ({ enabled: true, source: 'settings' as const })),
      clearOverride: vi.fn(async () => ({ enabled: false, source: 'none' as const })),
    };
    const registry = { reset: vi.fn(async () => undefined), getStatus: vi.fn(async () => ({}) as never) };
    return {
      controller: new DevinCliIntegrationController(registry as never, nativeToolsPolicy as never, tokenService as never),
      nativeToolsPolicy,
      tokenService,
      registry,
    };
  }

  it('reports Settings token ownership without returning the token', async () => {
    const { controller } = createController({ token: 'settings-token', source: 'settings' });
    await expect(controller.settings()).resolves.toMatchObject({
      mcpBridge: { enabled: true, configuredBy: 'settings', transport: 'streamable-http' },
    });
    const result = await controller.settings();
    expect(result.mcpBridge).not.toHaveProperty('token');
  });

  it('generates a Settings token and resets active Devin hosts', async () => {
    const { controller, tokenService, registry } = createController();
    await controller.updateSettings({ generateMcpBridgeToken: true });
    expect(tokenService.generate).toHaveBeenCalledOnce();
    expect(registry.reset).toHaveBeenCalledOnce();
  });

  it('persists a manual token override and can clear it back to the environment fallback', async () => {
    const { controller, tokenService } = createController({ token: 'environment-token', source: 'environment' });
    await controller.updateSettings({ mcpBridgeToken: 'manual-bridge-token-123' });
    expect(tokenService.setOverride).toHaveBeenCalledWith('manual-bridge-token-123');
    await controller.updateSettings({ clearMcpBridgeToken: true });
    expect(tokenService.clearOverride).toHaveBeenCalledOnce();
  });

  it('rejects ambiguous or invalid token actions', async () => {
    const { controller } = createController();
    await expect(controller.updateSettings({ generateMcpBridgeToken: true, clearMcpBridgeToken: true })).rejects.toThrow(/only one/);
    await expect(controller.updateSettings({ generateMcpBridgeToken: false })).rejects.toThrow(/must be true/);
    await expect(controller.updateSettings({ mcpBridgeToken: 'too-short' })).rejects.toThrow(/at least 16/);
  });
});
