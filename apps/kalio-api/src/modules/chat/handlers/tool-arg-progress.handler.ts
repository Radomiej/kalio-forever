import { Injectable } from '@nestjs/common';
import type { ChunkHandler } from '../interfaces/chunk-handler.interface';
import type { ToolArgProgressChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';

@Injectable()
export class ToolArgProgressHandler implements ChunkHandler<ToolArgProgressChunk> {
  readonly chunkType = 'tool_arg_progress' as const;

  async handle(chunk: ToolArgProgressChunk, ctx: StreamContext): Promise<void> {
    ctx.emit('tool:arg_progress', {
      toolName: chunk.toolName,
      totalChars: chunk.totalChars,
      charsPerSec: chunk.charsPerSec,
      sessionId: ctx.sessionId,
    });
  }
}
