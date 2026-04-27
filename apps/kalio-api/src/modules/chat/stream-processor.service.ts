import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import type { ChunkHandler } from './interfaces/chunk-handler.interface';
import type { InternalLLMChunk } from './interfaces/llm-chunk.types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { StreamMiddleware } from './interfaces/stream-middleware.interface';
import { CHUNK_HANDLERS, STREAM_MIDDLEWARES } from './chat.tokens';

type Pipeline = (chunk: InternalLLMChunk, ctx: StreamContext) => Promise<void>;

/**
 * Orchestrates chunk processing:
 *  1. Builds a registry Map<chunkType, ChunkHandler> from CHUNK_HANDLERS.
 *  2. Wraps handlers in a middleware pipeline via reduceRight.
 *  3. Exposes process(chunk, ctx) — the single public entry point.
 *
 * Adding a new chunk type = create a handler class + register in ChatModule.
 * Zero modification to this service (Open/Closed).
 */
@Injectable()
export class StreamProcessorService implements OnModuleInit {
  private readonly logger = new Logger(StreamProcessorService.name);
  private registry!: ReadonlyMap<string, ChunkHandler>;
  private pipeline!: Pipeline;

  constructor(
    @Inject(CHUNK_HANDLERS) private readonly handlers: ChunkHandler[],
    @Inject(STREAM_MIDDLEWARES) private readonly middlewares: StreamMiddleware[],
  ) {}

  onModuleInit(): void {
    // Build handler registry
    const map = new Map<string, ChunkHandler>();
    for (const handler of this.handlers) {
      map.set(handler.chunkType, handler);
      this.logger.log(`Registered chunk handler: ${handler.chunkType}`);
    }
    this.registry = map;

    // Leaf: look up and call the registered handler
    const leaf: Pipeline = async (chunk, ctx) => {
      const handler = this.registry.get(chunk.type);
      if (!handler) {
        this.logger.warn(`No handler registered for chunk type: ${chunk.type}`);
        return;
      }
      // `as never` is safe here: the registry guarantees handler.chunkType === chunk.type
      await handler.handle(chunk as never, ctx);
    };

    // Build middleware stack: middlewares[0] is outermost (called first).
    // reduceRight wraps each layer: (innerFn, mw) => new outer function.
    this.pipeline = this.middlewares.reduceRight<Pipeline>(
      (innerFn, middleware) =>
        (chunk, ctx) =>
          middleware(chunk, ctx, () => innerFn(chunk, ctx)),
      leaf,
    );

    this.logger.log(
      `Pipeline built: [${this.middlewares.map(m => m.name || 'anonymous').join(' → ')}] → handler`,
    );
  }

  async process(chunk: InternalLLMChunk, ctx: StreamContext): Promise<void> {
    await this.pipeline(chunk, ctx);
  }
}
