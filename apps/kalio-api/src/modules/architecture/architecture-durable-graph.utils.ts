import type { ArchitectureGraphProjection } from '@kalio/types';

export function normalizeIdentifier(value: string): string {
  return value.replace(/[_-]/g, '').toLowerCase();
}

export function isCliAgentToolName(name: string): boolean {
  return name === 'run_cli_agent'
    || name === 'spawn_cli_agent'
    || name === 'message_cli_agent'
    || name === 'get_cli_agent_status';
}

export function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function targetPathsFrom(
  toolName: string,
  args: Record<string, unknown>,
  result: Record<string, unknown>,
): string[] | undefined {
  const expected = stringArrayField(args, 'expectedChangedFiles') ?? stringArrayField(result, 'expectedChangedFiles');
  if (expected) {
    return expected;
  }
  if (toolName === 'get_cli_agent_status') {
    return undefined;
  }
  const workdir = stringField(result, 'workdir') ?? stringField(args, 'workdir');
  return workdir ? [workdir] : undefined;
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const values = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return values.length > 0 ? values : undefined;
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function normalizeCliStatus(
  status: string | undefined,
): NonNullable<ArchitectureGraphProjection['childAgents']>[number]['status'] | undefined {
  if (status === 'idle' || status === 'running' || status === 'completed' || status === 'failed' || status === 'stopped') {
    return status;
  }
  if (status === 'success' || status === 'exited') {
    return 'completed';
  }
  if (status === 'error') {
    return 'failed';
  }
  return undefined;
}

export function eventIdFromToolCallId(callId: string): string {
  const architecturePrefix = callId.match(/^architecture:[^:]+:(.+)$/);
  return architecturePrefix?.[1] ?? callId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
