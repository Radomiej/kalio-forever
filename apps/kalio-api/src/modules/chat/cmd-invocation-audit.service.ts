import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from './audit.service';

export type CmdInvocationSource =
  | 'cli-agent.probe'
  | 'cli-agent.run'
  | 'cli-agent.pty'
  | 'terminal.spawn'
  | 'codex.app-server'
  | 'codex.mcp-config'
  | 'devin.cli.probe'
  | 'devin.cli.models'
  | 'mcp.stdio.connect';

export interface CmdInvocationAuditInput {
  command?: string;
  shell?: boolean;
  source: CmdInvocationSource;
  launcher: 'execFile' | 'spawn' | 'pty' | 'stdio-transport';
  agentId?: string;
  sessionId?: string;
  turnId?: string;
  callId?: string;
}

@Injectable()
export class CmdInvocationAuditService {
  private readonly logger = new Logger(CmdInvocationAuditService.name);

  constructor(private readonly audit: AuditService) {}

  async recordInvocation(
    invocation: CmdInvocationAuditInput,
    platform: NodeJS.Platform = process.platform,
  ): Promise<void> {
    if (platform !== 'win32') return;

    const mechanism = invocation.shell
      ? 'shell'
      : getCmdMechanism(invocation.command);
    if (!mechanism) return;

    try {
      await this.audit.log({
        sessionId: invocation.sessionId,
        type: 'runtime_event',
        label: 'process.cmd.invocation',
        data: {
          domain: 'process',
          eventName: 'process.cmd.invocation',
          source: invocation.source,
          mechanism,
          launcher: invocation.launcher,
          platform,
          ...(invocation.agentId ? { agentId: invocation.agentId } : {}),
          ...(invocation.turnId ? { turnId: invocation.turnId } : {}),
          ...(invocation.callId ? { callId: invocation.callId } : {}),
        },
      });
    } catch (error) {
      const errorType = error instanceof Error ? error.name : typeof error;
      this.logger.warn(`Could not persist CMD invocation audit event from ${invocation.source} (${errorType}).`);
    }
  }
}

function getCmdMechanism(command: string | undefined): 'cmd' | 'cmd-shim' | undefined {
  const executable = command?.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
  if (executable === 'cmd' || executable === 'cmd.exe') return 'cmd';
  if (executable?.endsWith('.cmd') || executable?.endsWith('.bat')) return 'cmd-shim';
  return undefined;
}
