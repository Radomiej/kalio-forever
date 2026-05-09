import type { StreamMiddleware } from '../interfaces/stream-middleware.interface';

/**
 * Short-circuits the pipeline when the turn's AbortSignal has been triggered.
 * Must be the outermost middleware so it runs before everything else.
 */
export const abortCheckMiddleware: StreamMiddleware = async (chunk, ctx, next) => {
  if (ctx.abortSignal.aborted) {
    return;
  }
  await next();
};
