import type { CLIAgentSessionSnapshot, ToolCallRequest } from '@kalio/types';

export const CLI_AGENT_SESSION_RUNTIME = Symbol('CLI_AGENT_SESSION_RUNTIME');

export interface CLIAgentSessionRuntimePort {
  getStatus?(parentSessionId: string, childSessionId: string): Promise<CLIAgentSessionSnapshot>;
  stopSession(
    parentSessionId: string,
    childSessionId: string,
    emit?: ToolCallRequest['_emit'],
  ): Promise<CLIAgentSessionSnapshot>;
}
