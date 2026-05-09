import type { ILLMProvider } from '../llm.types';
import type { LLMMessage, LLMStreamChunk, LLMToolCall, LLMConfig } from '@kalio/types';

export class OpenAICompatibleProvider implements ILLMProvider {
  constructor(private readonly config: LLMConfig) {}

  async streamChat(
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
  ): Promise<LLMToolCall[]> {
    const body = JSON.stringify({
      model: this.config.model,
      messages,
      stream: true,
      tools: tools.length > 0
        ? tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined,
    });

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body,
    });

    if (!response.ok || !response.body) {
      throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
    }

    const toolCalls: LLMToolCall[] = [];
    const toolCallBuffers: Record<string, { name: string; argsRaw: string }> = {};
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          onChunk({ delta: '', done: true, sessionId, messageId });
          continue;
        }

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }

        const choices = parsed['choices'] as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.['delta'] as Record<string, unknown> | undefined;
        if (!delta) continue;

        const content = delta['content'];
        if (typeof content === 'string' && content) {
          onChunk({ delta: content, done: false, sessionId, messageId });
        }

        const rawToolCalls = delta['tool_calls'] as Array<Record<string, unknown>> | undefined;
        if (rawToolCalls) {
          for (const tc of rawToolCalls) {
            const idx = String(tc['index'] ?? 0);
            const fn = tc['function'] as Record<string, unknown> | undefined;
            if (!toolCallBuffers[idx]) {
              toolCallBuffers[idx] = { name: '', argsRaw: '' };
            }
            if (typeof fn?.['name'] === 'string') toolCallBuffers[idx]!.name += fn['name'];
            if (typeof fn?.['arguments'] === 'string') toolCallBuffers[idx]!.argsRaw += fn['arguments'];
          }
        }
      }
    }

    for (const [, buf] of Object.entries(toolCallBuffers)) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(buf.argsRaw) as Record<string, unknown>;
      } catch {
        // leave empty
      }
      toolCalls.push({ id: `call_${Date.now()}`, name: buf.name, args });
    }

    return toolCalls;
  }
}
