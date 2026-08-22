import type { IdeErrorCode } from '@kalio/types';

export class CodeIntelligenceError extends Error {
  constructor(
    public readonly code: IdeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodeIntelligenceError';
  }
}

export function isCodeIntelligenceError(error: unknown): error is CodeIntelligenceError {
  return error instanceof CodeIntelligenceError;
}
