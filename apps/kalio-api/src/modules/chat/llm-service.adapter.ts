import { Injectable } from '@nestjs/common';
import { LLMService } from '../llm/llm.service';
import type { ILLMSource, LLMSourceParams } from './interfaces/llm-source.interface';
import type { InternalLLMChunk, ToolArgProgressChunk } from './interfaces/llm-chunk.types';

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

interface RateWindow { t: number; chars: number }

/**
 * Returns a callback that tracks tool-argument generation rate and emits
 * ToolArgProgressChunk via `enqueue` at most once per `intervalMs`.
 * Uses a sliding window of `windowMs` ms to compute chars/sec.
 */
function makeToolArgRateTracker(
  enqueue: (chunk: ToolArgProgressChunk) => void,
  windowMs = 5000,
  intervalMs = 1000,
): (toolName: string, deltaChars: number) => void {
  const window: RateWindow[] = [];
  const totals = new Map<string, number>();
  let lastEmitAt = 0;

  return (toolName: string, deltaChars: number): void => {
    const now = Date.now();
    window.push({ t: now, chars: deltaChars });
    const cutoff = now - windowMs;
    while (window.length > 0 && window[0]!.t < cutoff) window.shift();
    totals.set(toolName, (totals.get(toolName) ?? 0) + deltaChars);

    if (now - lastEmitAt >= intervalMs) {
      lastEmitAt = now;
      const windowChars = window.reduce((s, e) => s + e.chars, 0);
      const oldestT = window[0]?.t ?? now;
      const actualWindowSec = Math.max(1, (now - oldestT) / 1000);
      const charsPerSec = Math.round(windowChars / actualWindowSec);
      enqueue({ type: 'tool_arg_progress', toolName, totalChars: totals.get(toolName) ?? 0, charsPerSec });
    }
  };
}

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
    let closed = false;
    const controller = new AbortController();

    const enqueue = (item: InternalLLMChunk | null): void => {
      if (closed && item !== null) {
        return;
      }
      pending.push(item);
      const fn = notify;
      notify = null;
      fn?.();
    };

    const abortUpstream = (reason?: unknown): void => {
      if (controller.signal.aborted) {
        return;
      }
      controller.abort(reason);
      enqueue(null);
    };

    const handleAbort = (): void => {
      abortUpstream(params.abortSignal?.reason);
    };

    if (params.abortSignal?.aborted) {
      handleAbort();
    } else {
      params.abortSignal?.addEventListener('abort', handleAbort, { once: true });
    }

    const toolMetas = params.tools.map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    if (controller.signal.aborted) {
      return;
    }

    // Fire the stream — do NOT await here so we can yield concurrently
    const onToolArgChunk = makeToolArgRateTracker(chunk => enqueue(chunk));

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
        controller.signal,
        onToolArgChunk,
      )
      .then(toolCalls => {
        if (controller.signal.aborted) {
          enqueue(null);
          return;
        }
        for (const tc of toolCalls) {
          enqueue({ type: 'tool_call', callId: tc.id, name: tc.name, args: tc.args });
        }
        enqueue({ type: 'done' });
        enqueue(null); // sentinel — end of iteration
      })
      .catch(err => {
        if (controller.signal.aborted && isAbortError(err)) {
          enqueue(null);
          return;
        }
        streamError = err instanceof Error ? err : new Error(String(err));
        enqueue(null); // sentinel — end with error
      });

    try {
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
    } finally {
      closed = true;
      params.abortSignal?.removeEventListener('abort', handleAbort);
      abortUpstream();
    }
  }
}
