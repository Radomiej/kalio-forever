import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { KalioConfigService } from '../../config/kalio-config.service';
import { CLIAgentConfigService } from './cli-agent-config.service';

function makeKalioConfigMock(config: Awaited<ReturnType<KalioConfigService['getCliAgentConfig']>>): Pick<KalioConfigService, 'getCliAgentConfig'> {
  return {
    getCliAgentConfig: vi.fn().mockResolvedValue(config),
  };
}

describe('CLIAgentConfigService', () => {
  it('prefers TOML-managed config over filesystem defaults', async () => {
    const kalioConfig = makeKalioConfigMock({
      enabled: false,
      cliPath: 'codex.cmd',
      timeoutMs: 90_000,
      model: 'gpt-5.4',
      extraArgs: ['--approval-mode', 'never'],
    });
    const service = new CLIAgentConfigService(kalioConfig as never);

    await expect(service.getConfig('codex')).resolves.toEqual({
      enabled: false,
      cliPath: 'codex.cmd',
      timeoutMs: 90_000,
      maxOutputChars: 16_000,
      model: 'gpt-5.4',
      extraArgs: ['--approval-mode', 'never'],
    });
  });

  it('rejects API writes for TOML-managed agents', async () => {
    const kalioConfig = makeKalioConfigMock({
      enabled: true,
      cliPath: 'codex.cmd',
    });
    const service = new CLIAgentConfigService(kalioConfig as never);

    await expect(service.saveConfig('codex', { model: 'gpt-5.4' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.saveConfig('codex', { model: 'gpt-5.4' })).rejects.toThrow(
      'CLI agent codex is managed by .kalio/config.toml',
    );
  });

  it('normalizes partial TOML-managed config with existing defaults', async () => {
    const kalioConfig = makeKalioConfigMock({
      cliPath: 'gemini.cmd',
      extraArgs: ['--yolo', 123 as unknown as string],
    });
    const service = new CLIAgentConfigService(kalioConfig as never);

    await expect(service.getConfig('gemini')).resolves.toEqual({
      enabled: true,
      cliPath: 'gemini.cmd',
      timeoutMs: 600_000,
      maxOutputChars: 16_000,
      model: '',
      extraArgs: ['--yolo'],
    });
  });
});