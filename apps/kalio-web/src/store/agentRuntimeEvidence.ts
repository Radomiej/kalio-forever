import type { ChatMessage } from '@kalio/types';

export type RuntimeEvidenceSource =
  | 'tool_result'
  | 'architecture';

export interface RuntimeEvidence {
  source: RuntimeEvidenceSource;
  text: string;
  code: string;
  updatedAt?: number;
}

export interface RuntimeEvidenceClassification {
  kind: 'runtime_timeout' | 'runtime_error';
  detail: string;
  priority: number;
}

const TIMEOUT_ERROR_CODES = new Set([
  'TIMEOUT',
  'SUBAGENT_TIMEOUT',
]);

export function compactRuntimeAttentionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractArchitectureEvidence(
  run: ChatMessage['architectureRun'] | undefined,
  updatedAt: number | undefined,
): RuntimeEvidence | null {
  if (!run) {
    return null;
  }
  for (let index = run.trace.length - 1; index >= 0; index -= 1) {
    const step = run.trace[index];
    if (!step) {
      continue;
    }
    if (step.stream?.status === 'failed') {
      return {
        source: 'architecture',
        code: 'ARCHITECTURE_STREAM_FAILED',
        text: compactRuntimeAttentionText(step.detail ?? step.content ?? 'Architecture stream failed'),
        updatedAt,
      };
    }
  }
  return null;
}

function firstStringField(record: Record<string, unknown>, fields: string[]): string | undefined {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function extractToolResultEvidence(content: unknown, updatedAt: number | undefined): RuntimeEvidence | null {
  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const code = firstStringField(parsed, ['toolResultErrorCode', 'errorCode', 'code']);
    if (!code) return null;
    const message = firstStringField(parsed, [
      'recoverableRuntimeError',
      'toolResultErrorMessage',
      'errorMessage',
      'message',
    ]);
    return {
      source: 'tool_result',
      code,
      text: compactRuntimeAttentionText(message ?? code),
      updatedAt,
    };
  } catch {
    return null;
  }

  return null;
}

export function extractLatestVisibleRuntimeEvidence(
  messages: ChatMessage[] | undefined,
): RuntimeEvidence | null {
  const safeMessages = messages ?? [];
  for (let index = safeMessages.length - 1; index >= 0; index -= 1) {
    const message = safeMessages[index];
    if (!message) {
      continue;
    }
    if (message.role === 'tool_result') {
      const evidence = extractToolResultEvidence(message.content, message.createdAt);
      if (evidence) {
        return evidence;
      }
    }
    const architectureEvidence = extractArchitectureEvidence(message.architectureRun, message.createdAt);
    if (architectureEvidence) {
      return architectureEvidence;
    }
  }

  return null;
}

export function classifyRuntimeEvidence(
  evidence: RuntimeEvidence | null,
): RuntimeEvidenceClassification | null {
  if (!evidence) {
    return null;
  }

  if (TIMEOUT_ERROR_CODES.has(evidence.code)) {
    return {
      kind: 'runtime_timeout',
      detail: evidence.text,
      priority: 5,
    };
  }

  return {
    kind: 'runtime_error',
    detail: evidence.text,
    priority: 15,
  };
}
