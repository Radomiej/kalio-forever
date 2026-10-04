import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { stopDevinChild } from './devin-cli-process-shutdown';

const control = vi.hoisted(() => ({ complete: undefined as undefined | ((error: Error | null) => void) }));
vi.mock('node:child_process', () => ({ execFile: (...args: unknown[]) => {
  const callback = args.at(-1);
  if (typeof callback !== 'function') throw new Error('Expected execFile completion callback');
  control.complete = (error: Error | null) => callback(error, '', '');
} }));
afterEach(() => { vi.useRealTimers(); control.complete = undefined; });

function ownedChild() {
  return Object.assign(new EventEmitter(), {
    pid: 123456, exitCode: null as number | null, signalCode: null,
    stdout: { closed: false }, stderr: { closed: false }, kill: () => true,
  });
}

it.skipIf(process.platform !== 'win32')('distinguishes completed tree termination from pending stdio close in timeout diagnostics', async () => {
  vi.useFakeTimers();
  const child = ownedChild();
  const result = stopDevinChild(child as unknown as ChildProcessWithoutNullStreams).catch(error => error as Error);
  child.exitCode = 0;
  control.complete!(null);
  await vi.advanceTimersByTimeAsync(10000);
  const error = await result;
  expect(error).toBeInstanceOf(Error);
  expect(error).toMatchObject({ shutdownState: {
    terminationComplete: true, exitCode: 0, signalCode: null, stdoutClosed: false, stderrClosed: false,
  } });
});

it.skipIf(process.platform !== 'win32')('reports unresolved termination instead of claiming the owned process stopped', async () => {
  vi.useFakeTimers();
  const child = ownedChild();
  const result = stopDevinChild(child as unknown as ChildProcessWithoutNullStreams).catch(error => error as Error);
  await vi.advanceTimersByTimeAsync(10000);
  expect(await result).toMatchObject({ shutdownState: { terminationComplete: false, exitCode: null } });
});

it.skipIf(process.platform !== 'win32')('does not accept close as successful tree termination when taskkill fails', async () => {
  const child = ownedChild();
  const result = stopDevinChild(child as unknown as ChildProcessWithoutNullStreams);
  child.emit('close');
  control.complete!(new Error('Owned tree termination failed'));
  await expect(result).rejects.toThrow('Owned tree termination failed');
});
