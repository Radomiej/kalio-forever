import { Logger } from '@nestjs/common';
import type { StreamMiddleware } from '../interfaces/stream-middleware.interface';
import { TurnErrorAlreadyEmitted } from '../turn-error';

const logger = new Logger('ErrorBoundaryMiddleware');

/**
 * Catches handler/middleware errors, emits chat:error to the client,
 * logs with full context, then re-throws as TurnErrorAlreadyEmitted so
 * ChatService knows not to emit a duplicate chat:error.
 */
export const errorBoundaryMiddleware: StreamMiddleware = async (chunk, ctx, next) => {
  try {
    await next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `Stream error on chunk [${chunk.type}] session=${ctx.sessionId}: ${message}`,
      err instanceof Error ? err.stack : undefined,
    );
    ctx.emit('chat:error', {
      sessionId: ctx.sessionId,
      code: 'LLM_ERROR',
      message,
    });
    throw new TurnErrorAlreadyEmitted(err);
  }
};
