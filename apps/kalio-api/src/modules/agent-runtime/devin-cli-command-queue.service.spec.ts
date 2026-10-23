import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DevinCliCommandQueueService } from './devin-cli-command-queue.service';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

type Finish = (error: Error | null, stdout: string, stderr: string) => void;

describe('Devin CLI command queue', () => {
  beforeEach(() => mocks.execFile.mockReset());

  it('serializes concurrent probe and model requests and preserves hidden launch options', async () => {
    const finishes: Finish[] = [];
    mocks.execFile.mockImplementation((_command: string, _args: string[], _options: unknown, finish: Finish) => {
      finishes.push(finish);
    });
    const queue = new DevinCliCommandQueueService();
    const probe = queue.run('devin.exe', ['--version'], { windowsHide: true, timeout: 5000 }, 'devin.cli.probe');
    const models = queue.run('devin.exe', ['models'], { windowsHide: true, maxBuffer: 4096 }, 'devin.cli.models');
    await vi.waitFor(() => expect(mocks.execFile).toHaveBeenCalledTimes(1));
    expect(mocks.execFile.mock.calls[0]?.[2]).toEqual({ windowsHide: true, timeout: 5000, encoding: 'utf8' });
    finishes[0]!(null, 'version', '');
    await probe;
    await vi.waitFor(() => expect(mocks.execFile).toHaveBeenCalledTimes(2));
    expect(mocks.execFile.mock.calls[1]?.[2]).toEqual({ windowsHide: true, maxBuffer: 4096, encoding: 'utf8' });
    finishes[1]!(null, 'swe-2', '');
    await models;
  });

  it('does not poison or retry the queue after a failed probe', async () => {
    mocks.execFile
      .mockImplementationOnce((_command: string, _args: string[], _options: unknown, finish: Finish) => {
        finish(new Error('probe failed'), '', '');
      })
      .mockImplementationOnce((_command: string, _args: string[], _options: unknown, finish: Finish) => {
        finish(null, 'swe-2', '');
      });
    const queue = new DevinCliCommandQueueService();
    const probe = queue.run('devin.exe', ['--version'], { windowsHide: true }, 'devin.cli.probe');
    const models = queue.run('devin.exe', ['models'], { windowsHide: true }, 'devin.cli.models');
    await expect(probe).rejects.toThrow('probe failed');
    await models;
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });
});
