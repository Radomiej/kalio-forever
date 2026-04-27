import { Injectable } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import type { ILLMSource, LLMSourceParams } from './interfaces/llm-source.interface';
import type { InternalLLMChunk } from './interfaces/llm-chunk.types';

/**
 * Bridges the callback-based LLMService.streamChat() to the AsyncIterable
 * contract required by ILLMSource.
 *
 * Conversion:
 *  onChunk({ delta, thinking })  → TextDeltaChunk | ThinkingDeltaChunk
 *  Promise resolved (LLMToolCall[]) → ToolCallChunk[], then DoneChunk
 *  Promise rejected                → generator throws
 */
@Injectable()
export class LLMServiceAdapter implements ILLMSource {
  constructor(private readonly llm: LLMService) {}

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    const pending: Array<InternalLLMChunk | null> = [];
    let notify: (() => void) | null = null;
    let streamError: Error | null = null;

    const enqueue = (item: InternalLLMChunk | null): void => {
      pending.push(item);
      const fn = notify;
      notify = null;
      fn?.();
    };

    const toolMetas = params.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    // Fire the stream — do NOT await here so we can yield concurrently
    void this.llm
      .streamChat(
        params.messages,
        toolMetas,
        chunk => {
          if (chunk.delta) {
            if (chunk.thinking) {
              enqueue({ type: 'thinking_delta', delta: chunk.delta });
            } else {
              enqueue({ type: 'text_delta', delta: chunk.delta });
            }
          }
        },
        params.sessionId,
        params.messageId,
      )
      .then(toolCalls => {
        for (const tc of toolCalls) {
          enqueue({ type: 'tool_call', callId: tc.id, name: tc.name, args: tc.args });
        }
        enqueue({ type: 'done' });
        enqueue(null); // sentinel — end of iteration
      })
      .catch(err => {
        streamError = err instanceof Error ? err : new Error(String(err));
        enqueue(null); // sentinel — end with error
      });

    while (true) {
      while (pending.length > 0) {
        const item = pending.shift()!;
        if (item === null) {
          if (streamError) throw streamError;
          return;
        }
        yield item;
      }
      // Wait for the next enqueue() call
      await new Promise<void>(r => {
        notify = r;
      });
    }
  }
}
