import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TerminalSpawnTool,
  TerminalListTool,
  TerminalOutputTool,
  TerminalKillTool,
} from './terminal.tools';
import type { TerminalService, TerminalSession } from '../terminal.service';
import type { ToolCallRequest } from '@kalio/types';
import { Reflector } from '@nestjs/core';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';

function makeRequest(toolName: string, args: Record<string, unknown> = {}, sessionId = 'sess-term'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName, args };
}

function makeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 'term-abc',
    command: 'node server.js',
    pid: 12345,
    status: 'running',
    output: 'started\n',
    exitCode: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ── TerminalSpawnTool ─────────────────────────────────────────────────────────

describe('TerminalSpawnTool', () => {
  let tool: TerminalSpawnTool;
  let terminals: Partial<TerminalService>;
  let reflector: Reflector;

  beforeEach(() => {
    terminals = {
      spawn: vi.fn(),
    };
    tool = new TerminalSpawnTool(terminals as TerminalService);
    reflector = new Reflector();
  });

  describe('@Tool() decorator (REGRESSION)', () => {
    it('MUST have requiresConfirmation=true for process spawn', () => {
      const metadata = reflector.get(TOOL_METADATA, TerminalSpawnTool);
      expect(metadata.requiresConfirmation).toBe(true);
    });

    it('has correct tool name', () => {
      const metadata = reflector.get(TOOL_METADATA, TerminalSpawnTool);
      expect(metadata.name).toBe('terminal_spawn');
    });
  });

  describe('positive scenarios', () => {
    it('spawns process and returns id, pid, command', async () => {
      const session = makeSession({ command: 'node app.js' });
      (terminals.spawn as ReturnType<typeof vi.fn>).mockResolvedValue(session);

      const result = await tool.execute(
        makeRequest('terminal_spawn', { command: 'node', args: ['app.js'] }),
      );

      expect(terminals.spawn).toHaveBeenCalledWith('node', ['app.js'], undefined);
      expect(result).toEqual({ id: session.id, pid: session.pid, command: session.command });
    });

    it('passes cwd to terminal.spawn when provided', async () => {
      (terminals.spawn as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession());

      await tool.execute(
        makeRequest('terminal_spawn', { command: 'python', args: ['-m', 'http.server'], cwd: '/app' }),
      );

      expect(terminals.spawn).toHaveBeenCalledWith('python', ['-m', 'http.server'], '/app');
    });
  });

  describe('edge cases', () => {
    it('defaults args to empty array when not provided', async () => {
      (terminals.spawn as ReturnType<typeof vi.fn>).mockResolvedValue(makeSession({ command: 'bash' }));

      await tool.execute(makeRequest('terminal_spawn', { command: 'bash' }));

      expect(terminals.spawn).toHaveBeenCalledWith('bash', [], undefined);
    });
  });

  describe('negative scenarios', () => {
    it('propagates ForbiddenException when cwd is outside allowed roots', async () => {
      (terminals.spawn as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('ACCESS_DENIED: cwd is outside allowed roots'),
      );

      await expect(
        tool.execute(makeRequest('terminal_spawn', { command: 'ls', cwd: '/etc' })),
      ).rejects.toThrow('ACCESS_DENIED');
    });

    it('propagates error when spawn fails', async () => {
      (terminals.spawn as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ENOENT: command not found'));

      await expect(
        tool.execute(makeRequest('terminal_spawn', { command: 'nonexistent_cmd' })),
      ).rejects.toThrow('ENOENT');
    });
  });
});

// ── TerminalListTool ──────────────────────────────────────────────────────────

describe('TerminalListTool', () => {
  let tool: TerminalListTool;
  let terminals: Partial<TerminalService>;

  beforeEach(() => {
    terminals = {
      list: vi.fn(),
    };
    tool = new TerminalListTool(terminals as TerminalService);
  });

  describe('positive scenarios', () => {
    it('returns all active sessions', async () => {
      const sessions = [makeSession({ id: 'a' }), makeSession({ id: 'b', status: 'exited' })];
      (terminals.list as ReturnType<typeof vi.fn>).mockReturnValue(sessions);

      const result = await tool.execute(makeRequest('terminal_list'));

      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0].id).toBe('a');
      expect(result.sessions[1].status).toBe('exited');
    });
  });

  describe('edge cases', () => {
    it('returns empty array when no sessions exist', async () => {
      (terminals.list as ReturnType<typeof vi.fn>).mockReturnValue([]);

      const result = await tool.execute(makeRequest('terminal_list'));

      expect(result.sessions).toHaveLength(0);
    });
  });

  describe('negative scenarios', () => {
    it('propagates error if terminals.list throws', async () => {
      (terminals.list as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('LIST_ERROR');
      });

      await expect(tool.execute(makeRequest('terminal_list'))).rejects.toThrow('LIST_ERROR');
    });
  });
});

// ── TerminalOutputTool ────────────────────────────────────────────────────────

describe('TerminalOutputTool', () => {
  let tool: TerminalOutputTool;
  let terminals: Partial<TerminalService>;

  beforeEach(() => {
    terminals = {
      get: vi.fn(),
    };
    tool = new TerminalOutputTool(terminals as TerminalService);
  });

  describe('positive scenarios', () => {
    it('returns id, status, exitCode and output for a running session', async () => {
      const session = makeSession({ output: 'log line 1\nlog line 2\n' });
      (terminals.get as ReturnType<typeof vi.fn>).mockReturnValue(session);

      const result = await tool.execute(makeRequest('terminal_output', { id: 'term-abc' }));

      expect(result).toEqual({
        id: 'term-abc',
        status: 'running',
        exitCode: null,
        output: 'log line 1\nlog line 2\n',
      });
    });

    it('returns exitCode when session has exited', async () => {
      const session = makeSession({ status: 'exited', exitCode: 0, output: 'done\n' });
      (terminals.get as ReturnType<typeof vi.fn>).mockReturnValue(session);

      const result = await tool.execute(makeRequest('terminal_output', { id: 'term-abc' }));

      expect(result.exitCode).toBe(0);
      expect(result.status).toBe('exited');
    });
  });

  describe('negative scenarios', () => {
    it('throws "Terminal session not found" for unknown session ID', async () => {
      (terminals.get as ReturnType<typeof vi.fn>).mockReturnValue(null);

      await expect(
        tool.execute(makeRequest('terminal_output', { id: 'nonexistent-id' })),
      ).rejects.toThrow('Terminal session not found: nonexistent-id');
    });
  });
});

// ── TerminalKillTool ──────────────────────────────────────────────────────────

describe('TerminalKillTool', () => {
  let tool: TerminalKillTool;
  let terminals: Partial<TerminalService>;
  let reflector: Reflector;

  beforeEach(() => {
    terminals = {
      kill: vi.fn(),
    };
    tool = new TerminalKillTool(terminals as TerminalService);
    reflector = new Reflector();
  });

  describe('@Tool() decorator (REGRESSION)', () => {
    it('MUST have requiresConfirmation=true for process kill', () => {
      const metadata = reflector.get(TOOL_METADATA, TerminalKillTool);
      expect(metadata.requiresConfirmation).toBe(true);
    });

    it('has correct tool name', () => {
      const metadata = reflector.get(TOOL_METADATA, TerminalKillTool);
      expect(metadata.name).toBe('terminal_kill');
    });
  });

  describe('positive scenarios', () => {
    it('returns { killed: true, id } when session was killed successfully', async () => {
      (terminals.kill as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const result = await tool.execute(makeRequest('terminal_kill', { id: 'term-abc' }));

      expect(terminals.kill).toHaveBeenCalledWith('term-abc');
      expect(result).toEqual({ killed: true, id: 'term-abc' });
    });
  });

  describe('edge cases', () => {
    it('returns { killed: false } when session does not exist', async () => {
      (terminals.kill as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = await tool.execute(makeRequest('terminal_kill', { id: 'no-such-term' }));

      expect(result.killed).toBe(false);
    });
  });

  describe('negative scenarios', () => {
    it('propagates error if terminals.kill throws', async () => {
      (terminals.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('KILL_ERROR');
      });

      await expect(tool.execute(makeRequest('terminal_kill', { id: 'term-abc' }))).rejects.toThrow('KILL_ERROR');
    });
  });
});
