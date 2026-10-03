import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { TerminalService } from '../terminal.service';

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
        description:
          'Absolute path to the working directory. Must be inside an AllowedPaths root. ' +
          'Use fs_list first to confirm the path exists, or check allowed_paths.',
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
    const session = await this.terminals.spawn(command, args, cwd, false, {
      sessionId: request.sessionId,
      turnId: request.turnId,
      callId: request.callId,
    });
    return { id: session.id, pid: session.pid, command: session.command };
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
      ? await this.terminals.observeUntilExit(id, waitMs)
      : this.terminals.get(id);
    if (!session) throw new Error(`Terminal session not found: ${id}`);
    return {
      id: session.id,
      status: session.status,
      exitCode: session.exitCode,
      output: session.output,
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
