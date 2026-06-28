import type { WorkflowErrorCode, WorkflowFailure } from '@kalio/types';

type WorkflowErrorOptions = {
  source?: string;
  retryable?: boolean;
  cause?: unknown;
};

const WORKFLOW_ERROR_CODES = new Set<WorkflowErrorCode>([
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_UNAUTHORIZED',
  'INVALID_ARGUMENT',
  'CONTRACT_VIOLATION',
  'CLI_AGENT_SESSION_METADATA_MISSING',
  'CLI_AGENT_STOPPED',
  'SUBAGENT_TIMEOUT',
  'RAAPP_RELEASE_NOT_FOUND',
  'UNKNOWN',
]);

const RETRYABLE_WORKFLOW_ERROR_CODES = new Set<WorkflowErrorCode>([
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;
  readonly source?: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;

  constructor(code: WorkflowErrorCode, message: string, options: WorkflowErrorOptions = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.source = options.source;
    this.retryable = options.retryable;
    this.cause = options.cause;
  }
}

export function createWorkflowError(
  code: WorkflowErrorCode,
  message: string,
  options: WorkflowErrorOptions = {},
): WorkflowError {
  return new WorkflowError(code, message, options);
}

export function isWorkflowError(error: unknown, code?: WorkflowErrorCode): boolean {
  if (!isRecord(error)) return false;
  const value = error['code'];
  if (!isWorkflowErrorCode(value)) return false;
  return code === undefined || value === code;
}

export function workflowFailureFromError(error: unknown): WorkflowFailure {
  const code = isWorkflowError(error) && isRecord(error)
    ? error['code'] as WorkflowErrorCode
    : 'UNKNOWN';
  const message = error instanceof Error ? error.message : String(error);
  const source = isRecord(error) && typeof error['source'] === 'string' ? error['source'] : undefined;
  const retryable = isRecord(error) && typeof error['retryable'] === 'boolean'
    ? error['retryable']
    : isRetryableWorkflowErrorCode(code);
  return {
    code,
    ...(source ? { source } : {}),
    retryable,
    message,
  };
}

export function isRetryableWorkflowErrorCode(code: WorkflowErrorCode): boolean {
  return RETRYABLE_WORKFLOW_ERROR_CODES.has(code);
}

export function isWorkflowErrorCode(value: unknown): value is WorkflowErrorCode {
  return typeof value === 'string' && WORKFLOW_ERROR_CODES.has(value as WorkflowErrorCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
