import type { WorkflowErrorCode, WorkflowFailure } from '@kalio/types';

type WorkflowErrorOptions = {
  source?: string;
  retryable?: boolean;
  cause?: unknown;
};

const WORKFLOW_ERROR_CODE_SET = new Set<WorkflowErrorCode>([
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_UNAUTHORIZED',
  'INVALID_ARGUMENT',
  'CONTRACT_VIOLATION',
  'CLI_AGENT_AUTH_REQUIRED',
  'CLI_AGENT_ERROR',
  'CLI_AGENT_SESSION_METADATA_MISSING',
  'CLI_AGENT_STOPPED',
  'SUBAGENT_TIMEOUT',
  'RAAPP_RELEASE_NOT_FOUND',
  'UNKNOWN',
] satisfies WorkflowErrorCode[]);

const RETRYABLE_WORKFLOW_ERROR_CODES = new Set<WorkflowErrorCode>([
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
]);

const LLM_PROVIDER_WORKFLOW_ERROR_CODES: Record<string, WorkflowErrorCode> = {
  LLM_RATE_LIMIT: 'RATE_LIMITED',
  LLM_TIMEOUT: 'TIMEOUT',
  LLM_AUTH: 'PROVIDER_UNAUTHORIZED',
  LLM_PROVIDER_DOWN: 'PROVIDER_UNAVAILABLE',
  LLM_BAD_TOOL_ARGS: 'CONTRACT_VIOLATION',
  LLM_BAD_STRUCTURED_OUTPUT: 'CONTRACT_VIOLATION',
};

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
  const code = workflowErrorCodeFromError(error);
  const message = error instanceof Error ? error.message : String(error);
  const source = workflowFailureSource(error);
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
  return typeof value === 'string' && WORKFLOW_ERROR_CODE_SET.has(value as WorkflowErrorCode);
}

function workflowErrorCodeFromError(error: unknown): WorkflowErrorCode {
  if (!isRecord(error)) {
    return 'UNKNOWN';
  }
  const code = error['code'];
  if (isWorkflowErrorCode(code)) {
    return code;
  }
  return typeof code === 'string'
    ? LLM_PROVIDER_WORKFLOW_ERROR_CODES[code] ?? 'UNKNOWN'
    : 'UNKNOWN';
}

function workflowFailureSource(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }
  if (typeof error['source'] === 'string') {
    return error['source'];
  }
  return typeof error['code'] === 'string' && error['code'] in LLM_PROVIDER_WORKFLOW_ERROR_CODES
    ? 'llm-provider'
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
