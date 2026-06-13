import type { CLIAgentSessionSnapshot, ToolCallRequest } from '@kalio/types';

export const CLI_AGENT_SESSION_RUNTIME = Symbol('CLI_AGENT_SESSION_RUNTIME');

export interface CLIAgentSessionRuntimePort {
  stopSession(
    parentSessionId: string,
    childSessionId: string,
    emit?: ToolCallRequest['_emit'],
  ): Promise<CLIAgentSessionSnapshot>;
}
