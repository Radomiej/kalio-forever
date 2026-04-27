/**
 * Thrown by errorBoundaryMiddleware after it has already emitted chat:error.
 * ChatService.handleTurn catches this and skips the duplicate emit.
 */
export class TurnErrorAlreadyEmitted extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'TurnErrorAlreadyEmitted';
    this.cause = cause;
  }
}
