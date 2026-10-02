import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevinAcpHostRegistry } from './devin-cli-acp.host';
import { DevinCliModelCatalogService } from './devin-cli-model-catalog.service';
import { DevinCliCommandQueueService } from './devin-cli-command-queue.service';
import { DevinCliProbeService } from './devin-cli-probe.service';

const { execFileMock, execFileAsyncMock, spawnMock } = vi.hoisted(() => {
  const execFileAsyncMock = vi.fn(async (_command: string, _args: string[], _options?: unknown) => ({ stdout: '', stderr: '' }));
  const execFileMock = vi.fn();
  Object.defineProperty(execFileMock, Symbol.for('nodejs.util.promisify.custom'), { value: execFileAsyncMock });
  return { execFileMock, execFileAsyncMock, spawnMock: vi.fn() };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFile: execFileMock, spawn: spawnMock };
});

describe('DevinAcpHostRegistry status reads', () => {
  function createRegistry(): DevinAcpHostRegistry {
    const commands = new DevinCliCommandQueueService();
    const catalog = new DevinCliModelCatalogService(commands);
    return new DevinAcpHostRegistry(new DevinCliProbeService(catalog, commands));
  }

  beforeEach(() => {
    vi.resetAllMocks();
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' });
  });

  it('returns an unchecked snapshot without launching Devin CLI probes by default', async () => {
    const registry = createRegistry();

    const status = await registry.getStatus();

    expect(execFileAsyncMock).not.toHaveBeenCalled();
    expect(status).toMatchObject({
      probeChecked: false,
      modelCatalogStatus: 'not-checked',
      modelCatalogDiscoveredAt: null,
      models: [],
    });
  });

  it('refreshes the dynamic model catalog on request and serves the snapshot without another probe', async () => {
    execFileAsyncMock.mockImplementation(async (_command: string, args: string[]) => {
      const output = args[0] === '--version'
        ? 'devin 3000.11.1 (build)'
        : args[0] === 'auth'
          ? 'Logged in'
          : args[0] === 'acp'
            ? 'Usage: devin acp\nRun as an ACP agent'
            : 'SWE-2 (swe-2)\n  swe-2-high    SWE-2 High [Free]';
      return { stdout: output, stderr: '' };
    });
    const registry = createRegistry();

    const refreshed = await registry.getStatus(true);
    expect(refreshed).toMatchObject({
      probeChecked: true,
      version: '3000.11.1',
      authenticated: true,
      acp: true,
      models: ['swe-2', 'swe-2-high'],
      modelCatalogStatus: 'ready',
    });
    expect(execFileAsyncMock).toHaveBeenCalledTimes(4);

    await expect(registry.getStatus()).resolves.toMatchObject({
      probeChecked: true,
      models: ['swe-2', 'swe-2-high'],
    });
    expect(execFileAsyncMock).toHaveBeenCalledTimes(4);
  });

  it('coalesces concurrent explicit refresh requests into one CLI probe set', async () => {
    const registry = createRegistry();

    const statuses = await Promise.all([registry.getStatus(true), registry.getStatus(true)]);

    expect(statuses.every((status) => status.probeChecked)).toBe(true);
    expect(execFileAsyncMock).toHaveBeenCalledTimes(4);
  });

  it('keeps Devin status and model probes to one active CLI process', async () => {
    let active = 0;
    let maxActive = 0;
    execFileAsyncMock.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { stdout: '', stderr: '' };
    });
    const registry = createRegistry();

    await registry.getStatus(true);

    expect(execFileAsyncMock).toHaveBeenCalledTimes(4);
    expect(maxActive).toBe(1);
  });
});
