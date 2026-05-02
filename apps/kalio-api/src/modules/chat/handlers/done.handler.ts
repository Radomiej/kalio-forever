import { Injectable } from '@nestjs/common';
import type { ChunkHandler } from '../interfaces/chunk-handler.interface';
import type { DoneChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';
import { SessionManagerService } from '../session-manager.service';

@Injectable()
export class DoneHandler implements ChunkHandler<DoneChunk> {
  readonly chunkType = 'done' as const;

  constructor(private readonly sessionManager: SessionManagerService) {}

  async handle(_chunk: DoneChunk, ctx: StreamContext): Promise<void> {
    const hasAssistantPayload =
      ctx.state.text.trim().length > 0 ||
      ctx.state.thinking.trim().length > 0 ||
      ctx.state.toolCalls.length > 0;
    if (!hasAssistantPayload) {
      return;
    }

    // Persist the assistant message for THIS LLM iteration.
    // chat:complete is intentionally NOT emitted here — ChatService emits it
    // once after the whole agentic loop (text + tool rounds) finishes.
    await this.sessionManager.persistAssistantMessage(
      ctx.sessionId,
      ctx.messageId,
      ctx.state,
    );
  }
}
