import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import * as childProcess from 'node:child_process';
import { listConfiguredCodexMcpServers, spawnCodexAppServerProcess } from './codex-app-server-process';

describe('Codex MCP inspection process auditing', () => {
  beforeEach(() => spawnMock.mockReset());

  it('reports the actual wrapper command before launching the inspection process', async () => {
    const stdout = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr: new EventEmitter(),
    });
    spawnMock.mockImplementation(() => {
      setImmediate(() => {
        stdout.emit('data', Buffer.from('[]'));
        child.emit('close', 0);
      });
      return child;
    });
    const onSpawnAttempt = vi.fn(async () => undefined);

    await (listConfiguredCodexMcpServers as unknown as (
      command: string,
      env: NodeJS.ProcessEnv,
      onSpawnAttempt: (command: string) => Promise<void>,
    ) => Promise<unknown>)('cmd.exe', {}, onSpawnAttempt);

    expect(onSpawnAttempt).toHaveBeenCalledExactlyOnceWith('cmd.exe');
    expect(childProcess.spawn).toHaveBeenCalledOnce();
  });

  it('records the app-server CMD launch before spawning the process', async () => {
    const order: string[] = [];
    const child = {} as ReturnType<typeof childProcess.spawn>;
    spawnMock.mockImplementation(() => {
      order.push('spawn');
      return child;
    });
    const cmdAudit = {
      recordInvocation: vi.fn(async () => { order.push('audit'); }),
    };

    await spawnCodexAppServerProcess({
      command: 'cmd.exe',
      args: ['/c', 'codex.cmd', 'app-server', '--stdio'],
      windowsVerbatimArguments: true,
    }, {}, cmdAudit as never);

    expect(order).toEqual(['audit', 'spawn']);
    expect(cmdAudit.recordInvocation).toHaveBeenCalledExactlyOnceWith({
      command: 'cmd.exe',
      source: 'codex.app-server',
      launcher: 'spawn',
    });
    expect(childProcess.spawn).toHaveBeenCalledOnce();
  });
});
