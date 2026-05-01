import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { TerminalService } from '../terminal.service';

@Injectable()
@Tool({
  name: 'terminal_spawn',
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
    const command = request.args['command'] as string;
    const args = (request.args['args'] as string[]) ?? [];
    const cwd = request.args['cwd'] as string | undefined;
    if (!cwd) {
      throw new Error('MISSING_CWD: terminal_spawn requires a cwd inside an AllowedPaths root');
    }
    const session = await this.terminals.spawn(command, args, cwd);
    return { id: session.id, pid: session.pid, command: session.command };
  }
}

@Injectable()
@Tool({
  name: 'terminal_list',
  description: 'List all active and recently exited terminal sessions.',
  parameters: {
    type: 'object',
    properties: {},
  },
  requiresConfirmation: false,
})
export class TerminalListTool {
  constructor(private readonly terminals: TerminalService) {}

  async execute(_request: ToolCallRequest) {
    return { sessions: this.terminals.list() };
  }
}

@Injectable()
@Tool({
  name: 'terminal_output',
  description: 'Get the buffered output (stdout + stderr) of a terminal session.',
  parameters: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'Terminal session ID returned by terminal_spawn.' },
    },
  },
  requiresConfirmation: false,
})
export class TerminalOutputTool {
  constructor(private readonly terminals: TerminalService) {}

  async execute(request: ToolCallRequest) {
    const id = request.args['id'] as string;
    const session = this.terminals.get(id);
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
    const id = request.args['id'] as string;
    const killed = this.terminals.kill(id);
    return { killed, id };
  }
}
