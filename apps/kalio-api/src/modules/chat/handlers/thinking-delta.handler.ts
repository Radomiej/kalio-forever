import { Injectable } from '@nestjs/common';
import type { ChunkHandler } from '../interfaces/chunk-handler.interface';
import type { ThinkingDeltaChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';

@Injectable()
export class ThinkingDeltaHandler implements ChunkHandler<ThinkingDeltaChunk> {
  readonly chunkType = 'thinking_delta' as const;

  async handle(chunk: ThinkingDeltaChunk, ctx: StreamContext): Promise<void> {
    ctx.state.appendThinking(chunk.delta);
    ctx.emit('chat:chunk', {
      delta: chunk.delta,
      done: false,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      thinking: true,
    });
  }
}
