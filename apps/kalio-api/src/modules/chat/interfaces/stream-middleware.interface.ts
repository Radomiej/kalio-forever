import type { InternalLLMChunk } from './llm-chunk.types';
import type { StreamContext } from './stream-context.interface';

/**
 * Cross-cutting middleware — executes around every chunk.
 * Call `next()` to continue the pipeline; skip it to short-circuit (e.g. abort check).
 */
export type StreamMiddleware = (
  chunk: InternalLLMChunk,
  ctx: StreamContext,
  next: () => Promise<void>,
) => Promise<void>;
