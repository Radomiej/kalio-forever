import { Injectable } from '@nestjs/common';
import type { ChunkHandler } from '../interfaces/chunk-handler.interface';
import type { TextDeltaChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';

@Injectable()
export class TextDeltaHandler implements ChunkHandler<TextDeltaChunk> {
  readonly chunkType = 'text_delta' as const;

  async handle(chunk: TextDeltaChunk, ctx: StreamContext): Promise<void> {
    ctx.state.appendText(chunk.delta);
    ctx.emit('chat:chunk', {
      delta: chunk.delta,
      done: false,
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
    });
  }
}
