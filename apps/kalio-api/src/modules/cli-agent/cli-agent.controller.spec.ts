import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLIAgentController } from './cli-agent.controller';
import type { CLIAgentService } from './cli-agent.service';
import type { CLIAgentConfigService, CLIAgentConfig } from './cli-agent-config.service';

const savedConfig: CLIAgentConfig = {
  enabled: false,
  cliPath: 'codex.cmd',
  timeoutMs: 120_000,
  hardTimeoutEnabled: true,
  hardTimeoutMs: 300_000,
  autoRecoveryEnabled: true,
  autoRecoveryPrompt: 'continue',
  maxOutputChars: 8_000,
  model: 'gpt-5.4',
  architecturePreference: 'Use bounded verification.',
  extraArgs: ['--approval-mode', 'never'],
};

describe('CLIAgentController', () => {
  let agents: {
    listAll: ReturnType<typeof vi.fn>;
    refreshAllProbes: ReturnType<typeof vi.fn>;
    refreshProbe: ReturnType<typeof vi.fn>;
    getAdapter: ReturnType<typeof vi.fn>;
  };
  let config: {
    getConfig: ReturnType<typeof vi.fn>;
    saveConfig: ReturnType<typeof vi.fn>;
  };
  let controller: CLIAgentController;

  beforeEach(() => {
    agents = {
      listAll: vi.fn().mockResolvedValue([
        {
          id: 'codex',
          displayName: 'Codex',
          installUrl: 'https://example.test/codex',
          available: true,
          version: '1.2.3',
        },
      ]),
      refreshAllProbes: vi.fn().mockResolvedValue([
        {
          id: 'codex',
          displayName: 'Codex',
          installUrl: 'https://example.test/codex',
          available: false,
          version: null,
        },
      ]),
      refreshProbe: vi.fn().mockResolvedValue({
        id: 'codex',
        displayName: 'Codex',
        installUrl: 'https://example.test/codex',
        available: true,
        version: '1.2.3',
      }),
      getAdapter: vi.fn().mockReturnValue({ id: 'codex' }),
    };
    config = {
      getConfig: vi.fn().mockResolvedValue(savedConfig),
      saveConfig: vi.fn().mockResolvedValue({ ...savedConfig, enabled: true }),
    };
    controller = new CLIAgentController(
      agents as unknown as CLIAgentService,
      config as unknown as CLIAgentConfigService,
    );
  });

  it('returns cached adapter availability for the CLI agent list', async () => {
    await expect(controller.listAll()).resolves.toEqual([
      expect.objectContaining({
        id: 'codex',
        available: true,
        version: '1.2.3',
      }),
    ]);
  });

  it('refreshes all probe results for the explicit refresh endpoint', async () => {
    await expect(controller.refreshAll()).resolves.toEqual([
      expect.objectContaining({
        id: 'codex',
        available: false,
        version: null,
      }),
    ]);
  });

  it('normalizes missing single-adapter probe results to unavailable', async () => {
    agents.refreshProbe.mockResolvedValue(null);

    await expect(controller.probe('codex')).resolves.toEqual({
      available: false,
      version: null,
    });
  });

  it('rejects probe and config requests for unknown adapters', async () => {
    agents.getAdapter.mockReturnValue(undefined);

    await expect(controller.probe('missing')).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller.getConfig('missing')).rejects.toThrow('Unknown CLI agent: missing');
    await expect(controller.saveConfig('missing', { enabled: true })).rejects.toThrow('Unknown CLI agent: missing');
  });

  it('returns and saves config only after the adapter is known', async () => {
    await expect(controller.getConfig('codex')).resolves.toEqual(savedConfig);
    await expect(controller.saveConfig('codex', { enabled: true })).resolves.toEqual({
      ...savedConfig,
      enabled: true,
    });

    expect(config.getConfig).toHaveBeenCalledWith('codex');
    expect(config.saveConfig).toHaveBeenCalledWith('codex', { enabled: true });
  });
});
