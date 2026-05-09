import { Logger } from '@nestjs/common';
import type { StreamMiddleware } from '../interfaces/stream-middleware.interface';

const logger = new Logger('MetricsMiddleware');

/**
 * Records per-chunk processing latency.
 * Placed innermost so it measures only handler time, not abort check or error handling.
 */
export const metricsMiddleware: StreamMiddleware = async (chunk, ctx, next) => {
  const start = performance.now();
  await next();
  const duration = performance.now() - start;
  logger.debug(`chunk=[${chunk.type}] session=${ctx.sessionId} duration=${duration.toFixed(2)}ms`);
};
