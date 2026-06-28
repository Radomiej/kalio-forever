import type { ChatMessage, RuntimeActivitySnapshot } from '@kalio/types';

export type RuntimeEvidenceSource =
  | 'assistant'
  | 'tool_result'
  | 'architecture'
  | 'child_output';

export interface RuntimeEvidence {
  source: RuntimeEvidenceSource;
  text: string;
}

export interface RuntimeEvidenceClassification {
  kind: 'runtime_timeout' | 'runtime_error';
  detail: string;
  priority: number;
}

const TOOL_BUDGET_MARKERS = [
  'tool budget ended',
  'max tools',
  'max tool',
  'maxtoolattempt',
] as const;

const TRUSTED_ASSISTANT_RUNTIME_MARKERS = [
  'sub-agent failed:',
  'sub-agent timed out after',
  'runtime failed:',
  'runtime error:',
  'agentflow failed:',
  'agentflow blocked:',
  'cli child failed:',
  'child execution failed:',
  'tool execution failed:',
] as const;

const GENERIC_RUNTIME_FAILURE_MARKERS = [
  'failed',
  'error',
  'blocked',
  'cancelled',
] as const;

export function compactRuntimeAttentionText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractArchitectureEvidence(run: ChatMessage['architectureRun'] | undefined): RuntimeEvidence | null {
  if (!run) {
    return null;
  }
  for (let index = run.trace.length - 1; index >= 0; index -= 1) {
    const reason = run.trace[index]?.incompleteReason?.trim();
    if (reason) {
      return {
        source: 'architecture',
        text: compactRuntimeAttentionText(reason),
      };
    }
  }
  return null;
}

function extractToolResultEvidence(content: string): RuntimeEvidence | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const recoverableRuntimeError = parsed['recoverableRuntimeError'];
    if (typeof recoverableRuntimeError === 'string' && recoverableRuntimeError.trim().length > 0) {
      return {
        source: 'tool_result',
        text: compactRuntimeAttentionText(recoverableRuntimeError),
      };
    }
    const errorMessage = parsed['errorMessage'];
    if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
      return {
        source: 'tool_result',
        text: compactRuntimeAttentionText(errorMessage),
      };
    }
    const toolResultErrorMessage = parsed['toolResultErrorMessage'];
    if (typeof toolResultErrorMessage === 'string' && toolResultErrorMessage.trim().length > 0) {
      return {
        source: 'tool_result',
        text: compactRuntimeAttentionText(toolResultErrorMessage),
      };
    }
  } catch {
    return null;
  }

  return null;
}

function isTrustedAssistantRuntimeEvidence(normalized: string): boolean {
  return TRUSTED_ASSISTANT_RUNTIME_MARKERS.some((marker) => normalized.includes(marker));
}

export function extractLatestVisibleRuntimeEvidence(
  messages: ChatMessage[] | undefined,
  snapshot: RuntimeActivitySnapshot | undefined,
): RuntimeEvidence | null {
  const safeMessages = messages ?? [];
  for (let index = safeMessages.length - 1; index >= 0; index -= 1) {
    const message = safeMessages[index];
    if (!message) {
      continue;
    }
    if (message.role === 'assistant' && message.content.trim().length > 0) {
      return {
        source: 'assistant',
        text: compactRuntimeAttentionText(message.content),
      };
    }
    if (message.role === 'tool_result' && message.content.trim().length > 0) {
      const evidence = extractToolResultEvidence(message.content);
      if (evidence) {
        return evidence;
      }
    }
    const architectureEvidence = extractArchitectureEvidence(message.architectureRun);
    if (architectureEvidence) {
      return architectureEvidence;
    }
  }

  const lastChildOutput = [...(snapshot?.childExecutions ?? [])]
    .reverse()
    .map((execution) => execution.lastOutput?.trim())
    .find((output): output is string => Boolean(output && output.length > 0));
  return lastChildOutput
    ? {
      source: 'child_output',
      text: compactRuntimeAttentionText(lastChildOutput),
    }
    : null;
}

export function classifyRuntimeEvidence(
  evidence: RuntimeEvidence | null,
): RuntimeEvidenceClassification | null {
  if (!evidence) {
    return null;
  }

  const normalized = evidence.text.toLowerCase();

  if (TOOL_BUDGET_MARKERS.some((marker) => normalized.includes(marker))) {
    return {
      kind: 'runtime_error',
      detail: 'Tool budget reached before the branch could finish.',
      priority: 10,
    };
  }

  const trustedFailureSource = evidence.source !== 'assistant'
    || isTrustedAssistantRuntimeEvidence(normalized);

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    if (!trustedFailureSource) {
      return null;
    }
    const timeoutMatch = /(?:sub-agent failed:\s*)?(sub-agent timed out after [^.]+\.?)/i.exec(evidence.text);
    return {
      kind: 'runtime_timeout',
      detail: compactRuntimeAttentionText(timeoutMatch?.[1] ?? evidence.text),
      priority: 5,
    };
  }

  if (GENERIC_RUNTIME_FAILURE_MARKERS.some((marker) => normalized.includes(marker))) {
    if (!trustedFailureSource) {
      return null;
    }
    return {
      kind: 'runtime_error',
      detail: evidence.text,
      priority: 15,
    };
  }

  return null;
}
