import type { ArchitectureBranchStreamSummary } from '@kalio/types';

export function streamFromEventData(data: Record<string, unknown> | undefined): ArchitectureBranchStreamSummary | undefined {
  const stream = data?.['stream'];
  if (!isRecord(stream)) {
    return undefined;
  }
  const streamGroupId = stream['streamGroupId'];
  const branchSessionId = stream['branchSessionId'];
  const status = stream['status'];
  const chunkCount = stream['chunkCount'];
  const text = stream['text'];
  if (
    typeof streamGroupId !== 'string'
    || typeof branchSessionId !== 'string'
    || !isStreamStatus(status)
    || typeof chunkCount !== 'number'
    || typeof text !== 'string'
  ) {
    return undefined;
  }
  return {
    streamGroupId,
    branchSessionId,
    status,
    chunkCount,
    text,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStreamStatus(value: unknown): value is ArchitectureBranchStreamSummary['status'] {
  return value === 'started' || value === 'streaming' || value === 'completed' || value === 'failed';
}
