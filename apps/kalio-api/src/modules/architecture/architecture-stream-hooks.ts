import type { ID, SocketEvents } from '@kalio/types';
import type { SubagentEmit } from '../tool/subagent-runtime.port';

export type ArchitectureStreamStatus = 'started' | 'streaming' | 'completed' | 'failed';

export interface ArchitectureBranchStreamEvent {
  sequence: number;
  event: keyof SocketEvents;
  sessionId?: ID;
  childSessionId?: ID;
  messageId?: ID;
  callId?: ID;
  toolName?: string;
  toolPath?: string;
  agentId?: string;
  workdir?: string;
  childStatus?: string;
  status?: string;
  delta?: string;
  done?: boolean;
}

export interface ArchitectureBranchStreamSnapshot {
  streamGroupId: ID;
  runId: ID;
  nodeId?: ID;
  roleSlotId: ID;
  branchSessionId: ID;
  personaId: ID;
  status: ArchitectureStreamStatus;
  chunkCount: number;
  text: string;
  events: ArchitectureBranchStreamEvent[];
}

export interface ArchitectureBranchStreamHookOptions {
  runId: ID;
  nodeId?: ID;
  roleSlotId: ID;
  branchSessionId: ID;
  personaId: ID;
  parentEmit?: SubagentEmit;
}

export interface ArchitectureBranchStreamHook {
  emit: SubagentEmit;
  snapshot: () => ArchitectureBranchStreamSnapshot;
}

export function createArchitectureBranchStreamHook(
  options: ArchitectureBranchStreamHookOptions,
): ArchitectureBranchStreamHook {
  const events: ArchitectureBranchStreamEvent[] = [];
  let sequence = 0;
  let status: ArchitectureStreamStatus = 'started';
  let text = '';
  let chunkCount = 0;
  const childSessionIdsByCallId = new Map<ID, ID>();

  const emit: SubagentEmit = (event, data) => {
    sequence += 1;
    const normalized = normalizeStreamEvent(sequence, event, data);
    const childSessionId = normalized.childSessionId
      ?? (normalized.callId ? childSessionIdsByCallId.get(normalized.callId) : undefined);
    const eventRecord = childSessionId ? { ...normalized, childSessionId } : normalized;
    if (eventRecord.callId && eventRecord.childSessionId) {
      childSessionIdsByCallId.set(eventRecord.callId, eventRecord.childSessionId);
    }
    events.push(eventRecord);

    if (event === 'chat:chunk') {
      chunkCount += 1;
      text += normalized.delta ?? '';
      status = 'streaming';
    } else if (event === 'chat:complete' || event === 'agent:done') {
      status = 'completed';
    } else if (event === 'chat:error') {
      status = 'failed';
    }

    options.parentEmit?.(event, data);
  };

  return {
    emit,
    snapshot: () => ({
      streamGroupId: architectureStreamGroupId(options.runId, options.nodeId ?? options.roleSlotId),
      runId: options.runId,
      nodeId: options.nodeId,
      roleSlotId: options.roleSlotId,
      branchSessionId: options.branchSessionId,
      personaId: options.personaId,
      status,
      chunkCount,
      text,
      events: [...events],
    }),
  };
}

function architectureStreamGroupId(runId: ID, nodeOrSlotId: ID): ID {
  return `architecture:${runId}:${nodeOrSlotId}`;
}

function normalizeStreamEvent<K extends keyof SocketEvents>(
  sequence: number,
  event: K,
  data: SocketEvents[K],
): ArchitectureBranchStreamEvent {
  const payload: Record<string, unknown> = isRecord(data) ? data : {};
  const delta = payload['delta'];
  const done = payload['done'];
  const sessionId = payload['sessionId'];
  const childSessionId = payload['childSessionId'];
  const messageId = payload['messageId'];
  const callId = payload['callId'];
  const toolName = payload['toolName'];
  const status = payload['status'];
  const args = payload['args'];
  const resultData = payload['data'];
  const result = isRecord(resultData) ? resultData : payload;
  const argsRecord = isRecord(args) ? args : {};
  const agentId = result['agentId'];
  const workdir = result['workdir'];
  const childStatus = isRecord(resultData) ? resultData['status'] : undefined;

  return {
    sequence,
    event,
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    childSessionId: typeof childSessionId === 'string'
      ? childSessionId
      : firstStringField(argsRecord, ['childSessionId'])
        ?? firstStringField(result, ['childSessionId']),
    messageId: typeof messageId === 'string' ? messageId : undefined,
    callId: typeof callId === 'string' ? callId : undefined,
    toolName: typeof toolName === 'string' ? toolName : undefined,
    toolPath: isRecord(args)
      ? firstStringField(argsRecord, ['path', 'filePath', 'targetPath', 'workdir', 'cwd'])
      : firstStringField(payload, ['path', 'filePath', 'targetPath', 'workdir', 'cwd']),
    agentId: typeof agentId === 'string' ? agentId : undefined,
    workdir: typeof workdir === 'string' ? workdir : undefined,
    childStatus: typeof childStatus === 'string' ? childStatus : undefined,
    status: typeof status === 'string' ? status : undefined,
    delta: typeof delta === 'string' ? delta : undefined,
    done: typeof done === 'boolean' ? done : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
