import type { InternalLLMChunk } from './llm-chunk.types';
import type { StreamContext } from './stream-context.interface';

/**
 * Handler for a specific chunk type.
 * Implement this interface and register in ChatModule via CHUNK_HANDLERS token.
 */
export interface ChunkHandler<T extends InternalLLMChunk = InternalLLMChunk> {
  /** Discriminator value — must match InternalLLMChunk['type'] */
  readonly chunkType: T['type'];
  handle(chunk: T, ctx: StreamContext): Promise<void>;
}
