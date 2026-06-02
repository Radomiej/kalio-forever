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
      architecturePreference: 'Use conservative verification for architecture runs.',
      extraArgs: ['--approval-mode', 'never'],
    });
    const service = new CLIAgentConfigService(kalioConfig as never);

    await expect(service.getConfig('codex')).resolves.toEqual({
      enabled: false,
      cliPath: 'codex.cmd',
      timeoutMs: 90_000,
      hardTimeoutEnabled: false,
      hardTimeoutMs: 3_600_000,
      autoRecoveryEnabled: false,
      autoRecoveryPrompt: 'continue',
      maxOutputChars: 16_000,
      model: 'gpt-5.4',
      architecturePreference: 'Use conservative verification for architecture runs.',
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
      timeoutMs: 900_000,
      hardTimeoutEnabled: false,
      hardTimeoutMs: 3_600_000,
      autoRecoveryEnabled: false,
      autoRecoveryPrompt: 'continue',
      maxOutputChars: 16_000,
      model: '',
      architecturePreference: '',
      extraArgs: ['--yolo'],
    });
  });

  it('uses gpt-5.4-mini as the filesystem default for Codex', async () => {
    const kalioConfig = makeKalioConfigMock(null);
    const service = new CLIAgentConfigService(kalioConfig as never);

    await expect(service.getConfig('codex')).resolves.toMatchObject({
      model: 'gpt-5.4-mini',
    });
  });

  it('does not apply the Codex model default to other CLI agents', async () => {
    const kalioConfig = makeKalioConfigMock(null);
    const service = new CLIAgentConfigService(kalioConfig as never);

    await expect(service.getConfig('unit-test-agent-without-default')).resolves.toMatchObject({
      model: '',
      architecturePreference: '',
    });
  });

  it('trims architecture preference strings from managed config', async () => {
    const kalioConfig = makeKalioConfigMock({
      architecturePreference: '  Prefer cheap materialization for architecture runs.  ',
    });
    const service = new CLIAgentConfigService(kalioConfig as never);

    await expect(service.getConfig('copilot')).resolves.toMatchObject({
      architecturePreference: 'Prefer cheap materialization for architecture runs.',
    });
  });

  it('clamps out-of-bounds timeoutMs and maxOutputChars from TOML to safe values', async () => {
    const kalioConfig = makeKalioConfigMock({ timeoutMs: 100, maxOutputChars: 50 });
    const service = new CLIAgentConfigService(kalioConfig as never);

    const config = await service.getConfig('codex');
    expect(config.timeoutMs).toBe(1_000);
    expect(config.maxOutputChars).toBe(1_000);
  });

  it('allows long inactivity timeouts up to the 24h maximum', async () => {
    const kalioConfig = makeKalioConfigMock({ timeoutMs: 9_000_000 });
    const service = new CLIAgentConfigService(kalioConfig as never);

    const config = await service.getConfig('codex');
    expect(config.timeoutMs).toBe(9_000_000);
  });

  it('always re-reads TOML-managed configs without caching so TTL expiry is respected', async () => {
    let callCount = 0;
    const kalioConfig: Pick<KalioConfigService, 'getCliAgentConfig'> = {
      getCliAgentConfig: vi.fn().mockImplementation(async () => {
        callCount += 1;
        return callCount === 1 ? { cliPath: 'codex-v1.cmd' } : { cliPath: 'codex-v2.cmd' };
      }),
    };
    const service = new CLIAgentConfigService(kalioConfig as never);

    const first = await service.getConfig('codex');
    const second = await service.getConfig('codex');
    expect(first.cliPath).toBe('codex-v1.cmd');
    expect(second.cliPath).toBe('codex-v2.cmd');
    expect(kalioConfig.getCliAgentConfig).toHaveBeenCalledTimes(2);
  });
});
