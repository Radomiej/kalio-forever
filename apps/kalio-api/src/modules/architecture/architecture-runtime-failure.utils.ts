import type { ArchitectureExecutionEvent, WorkflowErrorCode, WorkflowFailure } from '@kalio/types';

interface TerminalWorkflowFailure {
  errorCode?: WorkflowErrorCode;
  failure?: WorkflowFailure;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isWorkflowErrorCode(value: unknown): value is WorkflowErrorCode {
  return typeof value === 'string';
}

function isWorkflowFailure(value: unknown): value is WorkflowFailure {
  if (!isRecord(value)) return false;
  return typeof value['code'] === 'string'
    && typeof value['message'] === 'string'
    && typeof value['retryable'] === 'boolean';
}

export function terminalWorkflowFailureFromEvents(
  events: ArchitectureExecutionEvent[],
): TerminalWorkflowFailure {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const data = isRecord(event.data) ? event.data : {};
    const failure = event.failure ?? (isWorkflowFailure(data['failure']) ? data['failure'] : undefined);
    const errorCode = event.errorCode
      ?? (isWorkflowErrorCode(data['errorCode']) ? data['errorCode'] : undefined)
      ?? failure?.code;

    if (errorCode || failure) {
      return { errorCode, failure };
    }
  }

  return {};
}
