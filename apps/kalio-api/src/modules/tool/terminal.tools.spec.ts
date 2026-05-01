/**
 * terminal.tools.spec.ts
 *
 * Tests for TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool.
 * TerminalService is mocked — we don't spawn real processes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool } from './tools/terminal.tools';
import type { TerminalService, TerminalSession } from './terminal.service';
import type { ToolCallRequest } from '@kalio/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(toolName: string, args: Record<string, unknown> = {}): ToolCallRequest {
  return { callId: 'call-1', sessionId: 'sess-1', toolName, args };
}

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'term-abc',
    command: 'node server.js',
    pid: 12345,
    status: 'running',
    output: '',
    exitCode: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function mockTerminalService(overrides: Partial<TerminalService> = {}): TerminalService {
  return {
    spawn: vi.fn().mockResolvedValue(makeSession()),
    list: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    kill: vi.fn().mockReturnValue(true),
    waitForExit: vi.fn(),
    onModuleDestroy: vi.fn(),
    ...overrides,
  } as unknown as TerminalService;
}

// ── TerminalSpawnTool ─────────────────────────────────────────────────────────

describe('TerminalSpawnTool', () => {
  let svc: TerminalService;
  let tool: TerminalSpawnTool;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = mockTerminalService();
    tool = new TerminalSpawnTool(svc);
  });

  it('throws MISSING_CWD when cwd is not provided', async () => {
    await expect(
      tool.execute(makeRequest('terminal_spawn', { command: 'node', args: ['server.js'] })),
    ).rejects.toThrow('MISSING_CWD');
  });

  it('delegates to TerminalService.spawn with correct arguments', async () => {
    const session = makeSession({ id: 'term-1', pid: 999, command: 'node server.js' });
    vi.mocked(svc.spawn).mockResolvedValue(session);

    const result = await tool.execute(
      makeRequest('terminal_spawn', { command: 'node', args: ['server.js'], cwd: '/projects/app' }),
    );

    expect(svc.spawn).toHaveBeenCalledWith('node', ['server.js'], '/projects/app');
    expect(result).toEqual({ id: 'term-1', pid: 999, command: 'node server.js' });
  });

  it('passes empty args array when args not provided', async () => {
    await tool.execute(makeRequest('terminal_spawn', { command: 'node', cwd: '/projects/app' }));

    expect(svc.spawn).toHaveBeenCalledWith('node', [], '/projects/app');
  });

  it('surfaces ForbiddenException from TerminalService when cwd is not allowed', async () => {
    vi.mocked(svc.spawn).mockRejectedValue(
      new ForbiddenException('ACCESS_DENIED: cwd is outside allowed roots'),
    );

    await expect(
      tool.execute(makeRequest('terminal_spawn', { command: 'node', cwd: '/root/secret' })),
    ).rejects.toThrow('ACCESS_DENIED');
  });
});

// ── TerminalListTool ──────────────────────────────────────────────────────────

describe('TerminalListTool', () => {
  let svc: TerminalService;
  let tool: TerminalListTool;

  beforeEach(() => {
    svc = mockTerminalService();
    tool = new TerminalListTool(svc);
  });

  it('returns empty sessions when no terminals are active', async () => {
    const result = await tool.execute(makeRequest('terminal_list'));
    expect(result).toEqual({ sessions: [] });
  });

  it('returns all active terminal sessions', async () => {
    const sessions = [makeSession({ id: 't1' }), makeSession({ id: 't2', status: 'exited', exitCode: 0 })];
    vi.mocked(svc.list).mockReturnValue(sessions);

    const result = await tool.execute(makeRequest('terminal_list'));
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions[0].id).toBe('t1');
    expect(result.sessions[1].status).toBe('exited');
  });
});

// ── TerminalOutputTool ────────────────────────────────────────────────────────

describe('TerminalOutputTool', () => {
  let svc: TerminalService;
  let tool: TerminalOutputTool;

  beforeEach(() => {
    svc = mockTerminalService();
    tool = new TerminalOutputTool(svc);
  });

  it('throws when session id does not exist', async () => {
    vi.mocked(svc.get).mockReturnValue(null);

    await expect(
      tool.execute(makeRequest('terminal_output', { id: 'nonexistent' })),
    ).rejects.toThrow('Terminal session not found: nonexistent');
  });

  it('returns output for a running session', async () => {
    const session = makeSession({ output: 'Server running on :3000', status: 'running' });
    vi.mocked(svc.get).mockReturnValue(session);

    const result = await tool.execute(makeRequest('terminal_output', { id: 'term-abc' }));

    expect(result.id).toBe('term-abc');
    expect(result.status).toBe('running');
    expect(result.output).toBe('Server running on :3000');
    expect(result.exitCode).toBeNull();
  });

  it('returns exit code for a completed session', async () => {
    const session = makeSession({ status: 'exited', exitCode: 1, output: 'error occurred' });
    vi.mocked(svc.get).mockReturnValue(session);

    const result = await tool.execute(makeRequest('terminal_output', { id: 'term-abc' }));

    expect(result.status).toBe('exited');
    expect(result.exitCode).toBe(1);
    expect(result.output).toBe('error occurred');
  });
});

// ── TerminalKillTool ──────────────────────────────────────────────────────────

describe('TerminalKillTool', () => {
  let svc: TerminalService;
  let tool: TerminalKillTool;

  beforeEach(() => {
    svc = mockTerminalService();
    tool = new TerminalKillTool(svc);
  });

  it('returns killed:true when the process was running', async () => {
    vi.mocked(svc.kill).mockReturnValue(true);

    const result = await tool.execute(makeRequest('terminal_kill', { id: 'term-abc' }));

    expect(result).toEqual({ killed: true, id: 'term-abc' });
    expect(svc.kill).toHaveBeenCalledWith('term-abc');
  });

  it('returns killed:false for a session that already exited', async () => {
    vi.mocked(svc.kill).mockReturnValue(false);

    const result = await tool.execute(makeRequest('terminal_kill', { id: 'term-exited' }));

    expect(result).toEqual({ killed: false, id: 'term-exited' });
  });
});
