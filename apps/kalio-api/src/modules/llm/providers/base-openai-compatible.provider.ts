import type { ILLMProvider } from '../llm.service';
import type { LLMMessage, LLMStreamChunk, LLMToolCall, LLMConfig } from '@kalio/types';
import { Logger } from '@nestjs/common';

const PROVIDER_BASE_URLS: Record<string, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  cometapi: 'https://api.cometapi.com/v1',
  openai: 'https://api.openai.com/v1',
  xiaomimimo: 'https://token-plan-ams.xiaomimimo.com/v1',
  ollama: 'http://localhost:11434/v1',
};

function resolveBaseUrl(provider: string, baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/$/, '');
  return PROVIDER_BASE_URLS[provider] ?? 'https://api.openai.com/v1';
}

let _toolCallCounter = 0;
function uniqueToolCallId(): string {
  return `call_${Date.now()}_${++_toolCallCounter}`;
}

export class BaseOpenAICompatibleProvider implements ILLMProvider {
  protected readonly logger = new Logger(BaseOpenAICompatibleProvider.name);
  protected readonly providerName: string;
  protected readonly apiKey: string;
  protected readonly model: string;
  protected readonly baseUrl: string;

  constructor(
    providerName: string,
    apiKey: string,
    model: string,
    baseUrl?: string,
  ) {
    this.providerName = providerName;
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = resolveBaseUrl(providerName.toLowerCase(), baseUrl);
  }

  async streamChat(
    messages: LLMMessage[],
    tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>,
    onChunk: (chunk: LLMStreamChunk) => void,
    sessionId: string,
    messageId: string,
  ): Promise<LLMToolCall[]> {
    const body = JSON.stringify({
      model: this.model,
      messages: messages.map((m) => {
        if (m.role === 'tool' && m.toolCallId) {
          return { role: 'tool', content: m.content, tool_call_id: m.toolCallId };
        }
        if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          return {
            role: 'assistant',
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.args) },
            })),
          };
        }
        return m;
      }),
      stream: true,
      tools: tools.length > 0
        ? tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined,
    });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`[${this.providerName}] LLM request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    this.logger.debug(`[${this.providerName}] Streaming response started`, {
      status: response.status,
      model: this.model,
    });

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
          this.logger.warn(`[${this.providerName}] Failed to parse SSE chunk: ${data.slice(0, 100)}`);
          continue;
        }

        const choices = parsed['choices'] as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.['delta'] as Record<string, unknown> | undefined;
        if (!delta) continue;

        const content = delta['content'];
        if (typeof content === 'string' && content) {
          onChunk({ delta: content, done: false, sessionId, messageId });
        }

        // Thinking / reasoning tokens (DeepSeek R1 / MiMo style)
        const reasoning = delta['reasoning_content'];
        if (typeof reasoning === 'string' && reasoning) {
          onChunk({ delta: reasoning, done: false, sessionId, messageId, thinking: true });
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
      toolCalls.push({ id: uniqueToolCallId(), name: buf.name, args });
    }

    this.logger.debug(`[${this.providerName}] Streaming complete`, {
      toolCallsCount: toolCalls.length,
    });

    return toolCalls;
  }

  protected buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }
}
