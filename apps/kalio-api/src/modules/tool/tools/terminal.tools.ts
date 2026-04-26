import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { TerminalService } from '../terminal.service';

@Injectable()
@Tool({
  name: 'terminal_spawn',
  description: 'Spawn a long-running terminal process in the background. Returns a session ID to track output.',
  parameters: {
    type: 'object',
    required: ['command'],
    properties: {
      command: { type: 'string', description: 'Command to run (e.g. "node", "python").' },
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'Command arguments.',
      },
      cwd: { type: 'string', description: 'Working directory (optional).' },
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
