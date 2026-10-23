import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { TerminalService } from './terminal.service';

async function fixture() {
  const proc = Object.assign(new EventEmitter(), {
    pid: 123, stdout: new EventEmitter(), stderr: new EventEmitter(),
    stdin: { end: vi.fn() }, kill: vi.fn(),
  });
  spawnMock.mockReturnValue(proc);
  const service = Reflect.construct(TerminalService, [
    { isAllowed: vi.fn().mockResolvedValue(true) },
  ]) as TerminalService;
  const session = await service.spawn('test', []);
  return { proc, service, session };
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('waitForExit completion evidence', () => {
  it.each([null, 0, 7])('preserves known codes and fails closed for already exited %s', async (code) => {
    const { proc, service, session } = await fixture();
    proc.emit('close', code);
    await expect(service.waitForExit(session.id, 100)).resolves.toEqual({ output: '', exitCode: code ?? -1 });
  });

  it('does not report a killed process with unknown exit as success', async () => {
    const { service, session } = await fixture();
    service.kill(session.id);
    await expect(service.waitForExit(session.id, 100)).resolves.toEqual({ output: '', exitCode: -1 });
  });

  it('fails closed for an unknown close code while waiting and cleans its timer', async () => {
    vi.useFakeTimers();
    const { proc, service, session } = await fixture();
    const waiting = service.waitForExit(session.id, 100);
    proc.emit('close', null);
    await expect(waiting).resolves.toEqual({ output: '', exitCode: -1 });
    expect(vi.getTimerCount()).toBe(0);
    expect(proc.listenerCount('close')).toBe(1);
  });

  it('handles close during listener registration without a timer initialization race', async () => {
    vi.useFakeTimers();
    const { proc, service, session } = await fixture();
    const originalOn = proc.on.bind(proc);
    vi.spyOn(proc, 'on').mockImplementation((event, listener) => {
      originalOn(event, listener);
      if (event === 'close') proc.emit('close', null);
      return proc;
    });
    await expect(service.waitForExit(session.id, 100)).resolves.toEqual({ output: '', exitCode: -1 });
    expect(vi.getTimerCount()).toBe(0);
    expect(proc.listenerCount('close')).toBe(1);
  });

  it('fails closed when status changes before the attached listener receives close', async () => {
    const { proc, service, session } = await fixture();
    const originalOn = proc.on.bind(proc);
    vi.spyOn(proc, 'on').mockImplementation((event, listener) => {
      if (event === 'close') proc.emit('close', null);
      return originalOn(event, listener);
    });
    await expect(service.waitForExit(session.id, 100)).resolves.toEqual({ output: '', exitCode: -1 });
    expect(proc.listenerCount('close')).toBe(1);
  });
});
