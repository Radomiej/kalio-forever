import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { TerminalService, type TerminalSession } from '../terminal.service';

function getCommandArg(args: ToolCallRequest['args']): string {
  const rawCommand = args['command'];
  if (typeof rawCommand !== 'string' || rawCommand.trim().length === 0) {
    throw new Error('INVALID_COMMAND: command must be a non-empty string');
  }
  return rawCommand.trim();
}

function getArgsArg(args: ToolCallRequest['args']): string[] {
  const rawArgs = args['args'];
  if (rawArgs === undefined) {
    return [];
  }
  if (!Array.isArray(rawArgs) || rawArgs.some((arg) => typeof arg !== 'string')) {
    throw new Error('INVALID_ARGS: args must be an array of strings');
  }
  return rawArgs;
}

function getCwdArg(args: ToolCallRequest['args']): string {
  const rawCwd = args['cwd'];
  if (rawCwd === undefined) {
    throw new Error('MISSING_CWD: terminal_spawn requires a cwd inside an AllowedPaths root');
  }
  if (typeof rawCwd !== 'string' || rawCwd.trim().length === 0) {
    throw new Error('INVALID_CWD: cwd must be a non-empty string');
  }
  return rawCwd.trim();
}

/** Measured 2026-11-26: Devin's MCP client drops a tool request after ~60 s, so stay well below it. */
export const SPAWN_MAX_WAIT_MS = 50_000;
const INLINE_OUTPUT_MAX_CHARS = 20_000;

function getSpawnWaitArg(args: ToolCallRequest['args']): number {
  const waitMs = args['waitMs'] === undefined ? 0 : args['waitMs'];
  if (typeof waitMs !== 'number' || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > SPAWN_MAX_WAIT_MS) {
    throw new Error(`INVALID_WAIT: waitMs must be an integer between 0 and ${SPAWN_MAX_WAIT_MS}`);
  }
  return waitMs;
}

function truncateTail(output: string): string {
  if (output.length <= INLINE_OUTPUT_MAX_CHARS) return output;
  return `[... ${output.length - INLINE_OUTPUT_MAX_CHARS} earlier characters omitted; use terminal_output for the full buffer]\n`
    + output.slice(-INLINE_OUTPUT_MAX_CHARS);
}

function getIdArg(args: ToolCallRequest['args']): string {
  const rawId = args['id'];
  if (typeof rawId !== 'string' || rawId.trim().length === 0) {
    throw new Error('INVALID_ID: id must be a non-empty string');
  }
  return rawId.trim();
}

@Injectable()
@Tool({
  name: 'terminal_spawn',
  domain: 'terminal',
  description:
    'Spawn a long-running terminal process in the background. ' +
    'Returns a session ID — use terminal_output to read its stdout/stderr and terminal_kill to stop it. ' +
    'IMPORTANT: cwd must be an absolute path inside an AllowedPaths-registered directory. ' +
    'Split command and args: command="node", args=["server.js"] — NOT command="node server.js".',
  parameters: {
    type: 'object',
    required: ['command', 'cwd'],
    properties: {
      command: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description:
          'Executable name only, no arguments (e.g. "node", "python", "npm"). ' +
          'Arguments go in the args array.',
      },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Arguments to pass to the command (e.g. ["server.js"] or ["run", "dev"]).',
      },
      cwd: {
        type: 'string',
        minLength: 1,
        pattern: '\\S',
        description:
          'Absolute path to the working directory. Must be inside an AllowedPaths root. ' +
          'Use fs_list first to confirm the path exists, or check allowed_paths.',
      },
      waitMs: {
        type: 'integer',
        minimum: 0,
        maximum: SPAWN_MAX_WAIT_MS,
        description:
          'Optional. Wait up to this many milliseconds for the process to exit and return its status, exitCode and output in this same result. ' +
          'Use it for builds, tests and scripts. Default 0 returns immediately. A timeout never kills the process.',
      },
    },
  },
  requiresConfirmation: true,
})
export class TerminalSpawnTool {
  constructor(private readonly terminals: TerminalService) {}

  async execute(request: ToolCallRequest) {
    const command = getCommandArg(request.args);
    const args = getArgsArg(request.args);
    const cwd = getCwdArg(request.args);
    const waitMs = getSpawnWaitArg(request.args);
    const session = await this.terminals.spawn(command, args, cwd, false, {
      sessionId: request.sessionId,
      turnId: request.turnId,
      callId: request.callId,
    });
    const base = {
      id: session.id, pid: session.pid, command: session.command,
      ...(session.executionDescriptor ? { executionDescriptor: structuredClone(session.executionDescriptor) } : {}),
    };
    // Agents (notably Devin over the MCP bridge) otherwise tend to stop after spawn and never read the result.
    const next = `The process runs in the background. Call terminal_output with {"id":"${session.id}","waitMs":30000} to wait for it and read its output; repeat while it is still running.`;
    if (waitMs === 0) return { ...base, next };
    let observed: TerminalSession | null;
    try {
      observed = await this.terminals.observeUntilExit(session.id, waitMs, request.abortSignal);
    } catch {
      return { ...base, status: 'running', next };
    }
    const status = observed?.status ?? 'running';
    return {
      ...base,
      status,
      exitCode: observed?.exitCode ?? null,
      output: truncateTail(observed?.output ?? ''),
      ...(status === 'running' ? { next } : {}),
    };
  }
}

@Injectable()
@Tool({
  name: 'terminal_list',
  domain: 'terminal',
  description: 'List all active and recently exited terminal sessions.',
  parameters: {
    type: 'object',
    properties: {},
  },
  requiresConfirmation: false,
})
export class TerminalListTool {
  constructor(private readonly terminals: TerminalService) {}

  async execute(request: ToolCallRequest) {
    void request;
    return { sessions: this.terminals.list() };
  }
}

@Injectable()
@Tool({
  name: 'terminal_output',
  domain: 'terminal',
  description: 'Get the buffered output (stdout + stderr) of a terminal session. ' +
    'For builds/tests, set waitMs=30000 to observe completion in this turn. ' +
    'Timeout returns the current status without stopping the process. If still running, read again; do not claim success until status is exited and exitCode is 0.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'Terminal session ID returned by terminal_spawn.' },
      waitMs: { type: 'integer', minimum: 0, maximum: 30000, description: 'Optional wait for exit, in milliseconds. Default 0 is an immediate snapshot; never kills the process.' },
    },
  },
  requiresConfirmation: false,
})
export class TerminalOutputTool {
  constructor(private readonly terminals: TerminalService) {}

  async execute(request: ToolCallRequest) {
    const id = getIdArg(request.args);
    const waitMs = request.args['waitMs'] === undefined ? 0 : request.args['waitMs'];
    if (typeof waitMs !== 'number' || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 30000) {
      throw new Error('INVALID_WAIT: waitMs must be an integer between 0 and 30000');
    }
    const session = waitMs > 0
      ? await this.terminals.observeUntilExit(id, waitMs, request.abortSignal)
      : this.terminals.get(id);
    if (!session) throw new Error(`Terminal session not found: ${id}`);
    return {
      id: session.id,
      status: session.status,
      exitCode: session.exitCode,
      output: session.output,
      ...(session.executionDescriptor?.ownerIdentity?.sessionId === request.sessionId
        ? { executionDescriptor: structuredClone(session.executionDescriptor) } : {}),
    };
  }
}

@Injectable()
@Tool({
  name: 'terminal_kill',
  domain: 'terminal',
  description: 'Send SIGTERM to a running terminal session.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'Terminal session ID to kill.' },
    },
  },
  requiresConfirmation: true,
})
export class TerminalKillTool {
  constructor(private readonly terminals: TerminalService) {}

  async execute(request: ToolCallRequest) {
    const id = getIdArg(request.args);
    const killed = this.terminals.kill(id);
    return { killed, id };
  }
}
