import { describe, expect, it } from 'vitest';
import {
  createWorkflowError,
  isWorkflowError,
  workflowFailureFromError,
} from './workflow-error.util';

describe('workflow error utilities', () => {
  it('classifies workflow failures by typed code instead of message text', () => {
    const err = createWorkflowError('RATE_LIMITED', 'provider changed this wording', {
      source: 'llm-provider',
    });

    expect(isWorkflowError(err)).toBe(true);
    expect(isWorkflowError(err, 'RATE_LIMITED')).toBe(true);
    expect(isWorkflowError(err, 'TIMEOUT')).toBe(false);
    expect(workflowFailureFromError(err)).toEqual({
      code: 'RATE_LIMITED',
      source: 'llm-provider',
      retryable: true,
      message: 'provider changed this wording',
    });
  });

  it('does not infer retryability from a plain error message', () => {
    const err = new Error('429 rate limit timeout');

    expect(isWorkflowError(err)).toBe(false);
    expect(workflowFailureFromError(err)).toEqual({
      code: 'UNKNOWN',
      retryable: false,
      message: '429 rate limit timeout',
    });
  });
});
