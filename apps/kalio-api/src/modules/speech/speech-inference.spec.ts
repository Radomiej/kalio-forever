import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { SpeechInferenceService } from './speech-inference.service';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

describe('speech isolated worker lifecycle (fixture IPC)', () => {
  let service: SpeechInferenceService;
  let child: EventEmitter & { kill: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    service = new SpeechInferenceService();
    child = Object.assign(new EventEmitter(), {
      kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true; }),
      send: vi.fn((_message: unknown, callback: (error: Error | null) => void) => callback(null)),
    });
    vi.mocked(spawn).mockReset().mockReturnValue(child as unknown as ChildProcess);
  });
  afterEach(() => { service.onModuleDestroy(); vi.useRealTimers(); });

  it('reserves before spawn, cancellation stays bound to that scope and does not leak busy state', async () => {
    const scope = service.reserve('pending');
    expect(service.cancel('other')).toBe(false);
    expect(service.cancel('pending')).toBe(true);
    await expect(service.transcribe('/fixture', 'pending', Buffer.alloc(2), scope)).rejects.toThrow();
    expect(spawn).not.toHaveBeenCalled();
    service.release('pending', scope);
    expect(service.cancel('pending')).toBe(false);
    const next = service.transcribe('/fixture', 'next', Buffer.alloc(2));
    child.emit('message', { text: 'fixture' }); child.emit('close', 0);
    await expect(next).resolves.toBe('fixture');
  });
  it.each(['sync', 'callback', 'error'])('releases IPC %s failure and permits a follow-up', async (mode) => {
    if (mode === 'sync') child.send.mockImplementation(() => { throw new Error('IPC closed'); });
    if (mode === 'callback') child.send.mockImplementation((_message, callback) => callback(new Error('IPC closed')));
    const pending = service.transcribe('/fixture', 'failed', Buffer.alloc(2));
    if (mode === 'error') { child.emit('error', new Error('spawn')); child.emit('close', 1); }
    await expect(pending).rejects.toThrow();
    expect(service.cancel('failed')).toBe(false);
  });
  it('rejects oversized UTF8 result and unexpected worker close', async () => {
    const pending = service.transcribe('/fixture', 'oversized', Buffer.alloc(2));
    child.emit('message', { text: 'ą'.repeat(20000) }); child.emit('close', 0);
    await expect(pending).rejects.toThrow();
    const crashed = service.transcribe('/fixture', 'crash', Buffer.alloc(2));
    child.emit('close', 1); await expect(crashed).rejects.toThrow();
  });
  it('timeout kills the process and drains before follow-up', async () => {
    vi.useFakeTimers();
    const pending = service.transcribe('/fixture', 'timeout', Buffer.alloc(2));
    const assertion = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(120000); await assertion;
    expect(child.kill).toHaveBeenCalled(); expect(service.cancel('timeout')).toBe(false);
  });
});
