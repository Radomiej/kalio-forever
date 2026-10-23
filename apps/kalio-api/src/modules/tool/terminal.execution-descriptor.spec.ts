import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { TerminalService } from './terminal.service';
import { TerminalOutputTool, TerminalSpawnTool } from './tools/terminal.tools';
import type { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import type { CmdInvocationAuditService } from '../chat/cmd-invocation-audit.service';
import type { TerminalSession } from './terminal.service';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

describe('host terminal execution descriptor', () => {
  const owner = { sessionId: 'session', turnId: 'turn', callId: 'spawn' };
  let proc: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; pid: number; kill: ReturnType<typeof vi.fn> };
  let service: TerminalService;
  const allowed = { isAllowed: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    proc = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 42, kill: vi.fn(),
    });
    spawnMock.mockReturnValue(proc);
    allowed.isAllowed.mockResolvedValue(true);
    service = new TerminalService(allowed as unknown as AllowedPathsService);
  });

  it('captures argv and owner before path authorization awaits; matches actual spawn', async () => {
    let authorize!: (allowed: boolean) => void;
    allowed.isAllowed.mockReturnValueOnce(new Promise<boolean>((resolve) => { authorize = resolve; }));
    const args = ['run', 'build'];
    const identity = { ...owner };
    const pending = service.spawn('npm', args, '/project/../project', false, identity);
    args[1] = 'dev'; identity.sessionId = 'foreign';
    authorize(true);
    const session = await pending;
    expect(spawnMock).toHaveBeenCalledExactlyOnceWith('npm', ['run', 'build'], expect.objectContaining({
      cwd: '/project/../project', shell: process.platform === 'win32',
    }));
    expect(session.command).toBe('npm run build');
    expect(session).toHaveProperty('executionDescriptor', {
      terminalId: session.id, executable: 'npm', argv: ['run', 'build'],
      actualCwd: '/project/../project', shell: process.platform === 'win32', ownerIdentity: owner,
    });
  });

  it('detaches every returned metadata snapshot, including nested descriptor references', async () => {
    const session = await service.spawn('node', ['a.js'], '/project', false, owner);
    const expected = structuredClone(session);
    for (const snapshot of [session, service.get(session.id)!, service.list()[0]!]) {
      snapshot.status = 'killed'; snapshot.output = 'forged';
      expect(snapshot).toHaveProperty('executionDescriptor');
      Object.assign(snapshot.executionDescriptor!, { executable: 'forged' });
      Object.assign(snapshot.executionDescriptor!.argv, { 0: 'forged' });
      Object.assign(snapshot.executionDescriptor!.ownerIdentity!, { sessionId: 'foreign' });
    }
    expect(service.get(expected.id)).toEqual(expected);
    const stored = Reflect.get(service, 'sessions') as Map<string, { meta: TerminalSession }>;
    const internal = stored.get(expected.id)!.meta.executionDescriptor!;
    expect(Object.isFrozen(internal)).toBe(true);
    expect(Object.isFrozen(internal.argv)).toBe(true);
    expect(Object.isFrozen(internal.ownerIdentity)).toBe(true);
  });

  it('uses the same captured identity for audit and spawn while audit awaits', async () => {
    let acknowledge!: () => void;
    const audit = { recordInvocation: vi.fn().mockReturnValue(new Promise<void>((resolve) => { acknowledge = resolve; })) };
    service = new TerminalService(allowed as unknown as AllowedPathsService, audit as unknown as CmdInvocationAuditService);
    const identity = { ...owner };
    const args = ['run', 'build'];
    const pending = service.spawn('npm', args, '/project', false, identity);
    await Promise.resolve();
    identity.callId = 'forged'; args[0] = 'changed';
    acknowledge();
    const session = await pending;
    expect(audit.recordInvocation).toHaveBeenCalledExactlyOnceWith({
      command: 'npm', shell: process.platform === 'win32', source: 'terminal.spawn', launcher: 'spawn', ...owner,
    });
    expect(session.executionDescriptor?.ownerIdentity).toEqual(owner);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(['run', 'build']);
  });

  it('serializes only host-created spawn metadata and matching-session output', async () => {
    const result = await new TerminalSpawnTool(service).execute({
      ...owner, toolName: 'terminal_spawn', args: {
        command: 'node', args: ['a.js'], cwd: '/project', executionDescriptor: { executable: 'forged' },
      },
    });
    const descriptor = service.get(result.id)!.executionDescriptor;
    expect(JSON.parse(JSON.stringify(result))).toEqual({ id: result.id, pid: 42, command: 'node a.js', executionDescriptor: descriptor });
    proc.stdout.emit('data', Buffer.from('done'));
    proc.emit('close', 0);
    const output = await new TerminalOutputTool(service).execute({
      sessionId: owner.sessionId, turnId: 'later-turn', callId: 'output', toolName: 'terminal_output', args: { id: result.id },
    });
    expect(JSON.parse(JSON.stringify(output))).toEqual({ id: result.id, status: 'exited', exitCode: 0, output: 'done', executionDescriptor: descriptor });
    Object.assign(output.executionDescriptor!, { executable: 'changed' });
    expect(service.get(result.id)!.executionDescriptor).toEqual(descriptor);
  });

  it.each([owner, undefined])('omits foreign or unowned output descriptor without changing legacy access (%j)', async (identity) => {
    const session = await service.spawn('node', [], '/project', false, identity);
    const output = await new TerminalOutputTool(service).execute({
      sessionId: 'foreign', callId: 'output', toolName: 'terminal_output', args: { id: session.id, executionDescriptor: { ownerIdentity: owner } },
    });
    expect(output).toEqual({ id: session.id, status: 'running', exitCode: null, output: '' });
    if (!identity) expect(service.get(session.id)).toHaveProperty('executionDescriptor.ownerIdentity', null);
  });

  it.each([0, 9, null])('preserves actual close status/code without inventing success (%s)', async (code) => {
    const session = await service.spawn('node', [], '/project', false, owner);
    proc.emit('close', code);
    const output = await new TerminalOutputTool(service).execute({
      ...owner, toolName: 'terminal_output', args: { id: session.id },
    });
    expect(output).toMatchObject({ status: 'exited', exitCode: code });
    expect(output).toHaveProperty('executionDescriptor.terminalId', session.id);
  });

  it('preserves killed status in descriptor-bearing output', async () => {
    const session = await service.spawn('node', [], '/project', false, owner);
    service.kill(session.id);
    proc.emit('close', null);
    const output = await new TerminalOutputTool(service).execute({ ...owner, toolName: 'terminal_output', args: { id: session.id } });
    expect(output).toMatchObject({ status: 'killed', exitCode: null });
    expect(output.executionDescriptor?.ownerIdentity).toEqual(owner);
  });
});
