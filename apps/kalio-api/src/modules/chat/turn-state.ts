import type { LLMToolCall } from '@kalio/types';

/**
 * Mutable per-turn accumulator for the assistant response.
 * Shared by handlers via StreamContext.
 */
export class TurnState {
  text = '';
  thinking = '';
  hadContent = false;
  readonly toolCalls: LLMToolCall[] = [];
  private seq = 0;

  appendText(delta: string): void {
    this.text += delta;
  }

  replaceText(text: string): void {
    this.text = text;
  }

  appendThinking(delta: string): void {
    this.thinking += delta;
  }

  addToolCall(call: LLMToolCall): void {
    this.toolCalls.push(call);
  }

  nextSeq(): number {
    return ++this.seq;
  }
}
