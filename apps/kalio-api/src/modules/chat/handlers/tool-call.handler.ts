import { Injectable } from '@nestjs/common';
import type { ChunkHandler } from '../interfaces/chunk-handler.interface';
import type { ToolCallChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';

/**
 * Collect-only handler.
 *
 * Tool execution is intentionally NOT performed here. Per the OpenAI/Vercel/
 * LangGraph protocol, tool_result events MUST come AFTER the assistant
 * message that requested them is fully persisted, and serve as input for
 * the NEXT iteration. ChatService runs the dispatch loop after each LLM
 * iteration's `done` chunk, so the on-wire and on-disk order is always:
 *
 *   user → assistant(text + tool_calls) → tool_result(s) → assistant(answer)
 *
 * Doing the dispatch here would interleave tool_result before the parent
 * assistant message, breaking history reconstruction on reload.
 */
@Injectable()
export class ToolCallHandler implements ChunkHandler<ToolCallChunk> {
  readonly chunkType = 'tool_call' as const;

  async handle(chunk: ToolCallChunk, ctx: StreamContext): Promise<void> {
    ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
  }
}

