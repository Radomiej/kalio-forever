import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevinCliConfigHandle } from './devin-cli-config';

const probe = vi.hoisted(() => ({ outputs: [] as Array<{ stdout?: string; stderr?: string; error?: Error }>, calls: [] as string[][] }));
vi.mock('node:child_process', () => {
  const execFile = (_command: string, args: string[], options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    probe.calls.push(args);
    const result = probe.outputs.shift();
    if (!result) throw new Error('Missing probe fixture');
    callback(result.error ?? null, result.stdout ?? '', result.stderr ?? '');
    expect(options).toMatchObject({ cwd: 'private', windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 });
  };
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: (command: string, args: string[], options: unknown) => new Promise((resolve, reject) => {
      execFile(command, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
    }),
  });
  return { execFile };
});
import { suppressInheritedDevinMcp } from './devin-cli-mcp-catalog';

const enabled = 'Configured MCP servers:\n  • kalio-runtime\n    Command: node bridge\n  • global\n    Command: secret';
const disabled = 'Configured MCP servers:\n  • kalio-runtime\n    Command: node bridge\n  ✗ global  (disabled)\n    Command: node placeholder';
const handle = (): DevinCliConfigHandle => ({ path: 'private/config', cwd: 'private', cleanup: vi.fn(), suppressMcpServers: vi.fn().mockResolvedValue(undefined) });
beforeEach(() => { probe.outputs.length = 0; probe.calls.length = 0; });

describe('private MCP suppression startup guard', () => {
  it('discovers once, writes once and verifies once, without per-server commands', async () => {
    probe.outputs.push({ stdout: 'devin 3000.11.1 (build)' }, { stdout: enabled }, { stdout: disabled });
    const config = handle();
    expect(await suppressInheritedDevinMcp('devin.exe', config, ['kalio-runtime'])).toBe(1);
    expect(config.suppressMcpServers).toHaveBeenCalledExactlyOnceWith(['global']);
    expect(probe.calls).toEqual([['--version'], ['mcp', 'list'], ['mcp', 'list']]);
  });

  it.each([enabled, disabled.replace('• kalio-runtime', '✗ kalio-runtime  (disabled)'),
    disabled.replace('global', 'new-global')])('blocks if suppression, bridge readiness or complete verification fails', async (catalog) => {
    probe.outputs.push({ stdout: 'devin 3000.11.1' }, { stdout: enabled }, { stdout: catalog });
    await expect(suppressInheritedDevinMcp('devin.exe', handle(), ['kalio-runtime'])).rejects.toThrow('did not take effect');
  });

  it.each([{ stdout: 'devin 3000.12.0' }, { error: new Error('SECRET') }, { stdout: 'devin 3000.11.1', stderr: 'SECRET' }])('blocks unknown versions and probe failures without leaking output', async (result) => {
    probe.outputs.push(result);
    const config = handle();
    await expect(suppressInheritedDevinMcp('devin.exe', config, ['kalio-runtime'])).rejects.toThrow('host startup blocked');
    expect(config.suppressMcpServers).not.toHaveBeenCalled();
    expect(probe.calls).toHaveLength(1);
  });

  it('does not start verification after a failed local write', async () => {
    probe.outputs.push({ stdout: 'devin 3000.11.1' }, { stdout: enabled });
    const config = handle();
    vi.mocked(config.suppressMcpServers).mockRejectedValue(new Error('local write failed'));
    await expect(suppressInheritedDevinMcp('devin.exe', config, ['kalio-runtime'])).rejects.toThrow('local write failed');
    expect(probe.calls).toHaveLength(2);
  });
});
