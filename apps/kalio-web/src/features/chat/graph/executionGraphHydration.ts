import type { ChatMessage } from '@kalio/types';

export interface ExecutionGraphHydrationStatus {
  label: string;
  tone: 'success' | 'warning' | 'muted';
  detail: string;
  readFailures: number;
  readSuccesses: number;
  totalBranches: number;
}

export function extractExecutionGraphHydrationStatus(
  messages: ChatMessage[],
  sessionMessages: Record<string, ChatMessage[]>,
): ExecutionGraphHydrationStatus | null {
  const branchSessionIds = extractArchitectureBranchSessionIds(messages);
  if (branchSessionIds.length === 0) {
    return null;
  }

  let readSuccesses = 0;
  let readFailures = 0;
  let unknown = 0;

  branchSessionIds.forEach((sessionId) => {
    const readState = vfsReadState(sessionMessages[sessionId] ?? []);
    if (readState === 'success') {
      readSuccesses += 1;
    } else if (readState === 'failure') {
      readFailures += 1;
    } else {
      unknown += 1;
    }
  });

  if (readFailures > 0) {
    return {
      label: `VFS ${readFailures} missing`,
      tone: 'warning',
      detail: `${readFailures} branch read(s) failed, ${readSuccesses} succeeded, ${unknown} unknown`,
      readFailures,
      readSuccesses,
      totalBranches: branchSessionIds.length,
    };
  }

  if (readSuccesses > 0 && unknown === 0) {
    return {
      label: `VFS ${readSuccesses}/${branchSessionIds.length} ok`,
      tone: 'success',
      detail: 'All architecture branch reads succeeded',
      readFailures,
      readSuccesses,
      totalBranches: branchSessionIds.length,
    };
  }

  return {
    label: `VFS ${readSuccesses}/${branchSessionIds.length} seen`,
    tone: 'muted',
    detail: `${unknown} branch transcript(s) have no vfs_read result yet`,
    readFailures,
    readSuccesses,
    totalBranches: branchSessionIds.length,
  };
}

export function extractArchitectureBranchSessionIds(messages: ChatMessage[]): string[] {
  const sessionIds = new Set<string>();
  const architectureToolCallIds = new Set(messages
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => typeof toolCall.args['architectureRunId'] === 'string')
    .map((toolCall) => toolCall.id));
  messages
    .filter((message) => message.role === 'tool_result')
    .forEach((message) => {
      const parsed = parseRecord(message.content);
      const childSessionId = parsed?.['childSessionId'];
      const isArchitectureResult = typeof parsed?.['architectureRunId'] === 'string'
        || (typeof message.toolCallId === 'string' && architectureToolCallIds.has(message.toolCallId));
      if (typeof childSessionId === 'string' && isArchitectureResult) {
        sessionIds.add(childSessionId);
      }
    });
  return [...sessionIds];
}

function vfsReadState(messages: ChatMessage[]): 'success' | 'failure' | 'unknown' {
  const readCallIds = new Set(messages
    .flatMap((message) => message.toolCalls ?? [])
    .filter((toolCall) => toolCall.name === 'vfs_read')
    .map((toolCall) => toolCall.id));

  if (readCallIds.size === 0) {
    return 'unknown';
  }

  const readResults = messages.filter((message) => message.role === 'tool_result' && message.toolCallId && readCallIds.has(message.toolCallId));
  if (readResults.some((message) => isMissingFileResult(message.content))) {
    return 'failure';
  }
  return readResults.length > 0 ? 'success' : 'unknown';
}

function isMissingFileResult(content: string): boolean {
  const parsed = parseRecord(content);
  if (!parsed) {
    return false;
  }
  const errorCode = firstStringField(parsed, ['errorCode', 'toolResultErrorCode', 'code']);
  return errorCode === 'ENOENT' || errorCode === 'VFS_FILE_NOT_FOUND';
}

function parseRecord(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function firstStringField(record: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}
