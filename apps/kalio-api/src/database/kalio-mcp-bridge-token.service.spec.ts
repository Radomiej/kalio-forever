import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KALIO_MCP_BRIDGE_TOKEN_SETTING_KEY,
  KalioMcpBridgeTokenService,
} from './kalio-mcp-bridge-token.service';

describe('KalioMcpBridgeTokenService', () => {
  let stored: string | null;
  let service: KalioMcpBridgeTokenService;

  beforeEach(() => {
    stored = null;
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
    service = new KalioMcpBridgeTokenService({
      get: vi.fn(async () => stored),
      set: vi.fn(async (_key: string, value: string) => { stored = value; }),
      delete: vi.fn(async () => { stored = null; }),
    } as never);
  });

  afterEach(() => {
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
  });

  it('uses the environment token only when no Settings override exists', async () => {
    process.env['KALIO_MCP_BRIDGE_TOKEN'] = 'environment-bridge-token';
    await expect(service.getStatus()).resolves.toEqual({ enabled: true, source: 'environment' });

    stored = 'settings-bridge-token';
    await expect(service.getToken()).resolves.toBe('settings-bridge-token');
    await expect(service.getStatus()).resolves.toEqual({ enabled: true, source: 'settings' });
  });

  it('generates and persists a local token without exposing it in status', async () => {
    await expect(service.generate()).resolves.toEqual({ enabled: true, source: 'settings' });
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toBeNull();
  });

  it('clears the Settings override and falls back to the environment', async () => {
    process.env['KALIO_MCP_BRIDGE_TOKEN'] = 'environment-bridge-token';
    stored = 'settings-bridge-token';
    await expect(service.clearOverride()).resolves.toEqual({ enabled: true, source: 'environment' });
    expect(stored).toBeNull();
  });

  it('rejects a short manual override', async () => {
    await expect(service.setOverride('too-short')).rejects.toThrow(/at least 16 characters/);
    expect(stored).toBeNull();
  });

  it('writes the override under the stable app setting key', async () => {
    const set = vi.fn(async (_key: string, value: string) => { stored = value; });
    service = new KalioMcpBridgeTokenService({
      get: vi.fn(async () => stored),
      set,
      delete: vi.fn(async () => { stored = null; }),
    } as never);
    await service.setOverride('manual-bridge-token-123');
    expect(set).toHaveBeenCalledWith(KALIO_MCP_BRIDGE_TOKEN_SETTING_KEY, 'manual-bridge-token-123');
  });
});
