import type { ILLMProvider, LLMToolDef, StreamChatOptions } from '../llm.types';
import type { LLMToolCall } from '@kalio/types';
import { Logger } from '@nestjs/common';
import { buildProviderCompatHeaders, resolveLlmProviderBaseUrl } from '../../../common/utils/llm-provider-http.util';
import type { ContextManagedLLMMessage } from '../../../common/utils/context-managed-llm-message.util';
import { getReasoningContent } from '../../../common/utils/context-managed-llm-message.util';

export type LLMProviderErrorCode =
  | 'LLM_ERROR'
  | 'LLM_RATE_LIMIT'
  | 'LLM_TIMEOUT'
  | 'LLM_AUTH'
  | 'LLM_PROVIDER_DOWN'
  | 'LLM_QUOTA'
  | 'LLM_BAD_TOOL_ARGS';

export class LLMProviderError extends Error {
  constructor(
    public readonly code: LLMProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LLMProviderError';
  }
}

let _toolCallCounter = 0;
function uniqueToolCallId(): string {
  return `call_${Date.now()}_${++_toolCallCounter}`;
}

const MAX_PROVIDER_ATTEMPTS = 3;
const PROVIDER_TIMEOUT_MS = 120_000;

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
    this.baseUrl = resolveLlmProviderBaseUrl(providerName.toLowerCase(), baseUrl);
  }

  async streamChat(
    messages: ContextManagedLLMMessage[],
    tools: LLMToolDef[],
    options: StreamChatOptions,
  ): Promise<LLMToolCall[]> {
    const { sessionId, messageId, onChunk, onToolArgChunk, abortSignal } = options;
    if (abortSignal?.aborted) {
      return [];
    }

    const body = JSON.stringify({
      model: this.model,
      messages: messages.map((m) => this.buildRequestMessage(m)),
      stream: true,
      tools: tools.length > 0
        ? tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          }))
        : undefined,
      ...this.buildThinkingParams(),
    });

    const response = await this.fetchStreamingResponse(body, abortSignal);

    if (!response.ok || !response.body) {
      const errorText = await response.text().catch(() => '');
      throw this.buildHttpError(response.status, response.statusText, errorText);
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
    let debugChunkCount = 0;

    try {
      while (true) {
        if (abortSignal?.aborted) {
          return [];
        }
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

          // Debug: log delta keys on first few chunks to diagnose field names
          debugChunkCount++;
          if (debugChunkCount <= 3) {
            this.logger.debug(`[${this.providerName}] delta keys: ${JSON.stringify(Object.keys(delta))}, reasoning_content=${JSON.stringify(delta['reasoning_content'])?.slice(0,40)}, content=${JSON.stringify(delta['content'])?.slice(0,40)}`);
          }

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
              if (typeof fn?.['name'] === 'string') {
                toolCallBuffers[idx]!.name += fn['name'];
                onToolArgChunk?.(toolCallBuffers[idx]!.name, 0);
              }
              if (typeof fn?.['arguments'] === 'string') {
                toolCallBuffers[idx]!.argsRaw += fn['arguments'];
                onToolArgChunk?.(toolCallBuffers[idx]!.name, fn['arguments'].length);
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    for (const [, buf] of Object.entries(toolCallBuffers)) {
      let args: Record<string, unknown>;
      try {
        args = buf.argsRaw.trim().length > 0
          ? JSON.parse(buf.argsRaw) as Record<string, unknown>
          : {};
      } catch {
        throw new LLMProviderError(
          'LLM_BAD_TOOL_ARGS',
          `[${this.providerName}] Tool call ${buf.name || 'unknown'} streamed malformed JSON arguments`,
        );
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
      ...buildProviderCompatHeaders(this.providerName, this.apiKey || undefined),
    };
  }

  protected buildThinkingParams(): Record<string, unknown> {
    return {};
  }

  private async fetchStreamingResponse(body: string, abortSignal?: AbortSignal): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt++) {
      const timeoutSignal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
      const signal = abortSignal
        ? AbortSignal.any([abortSignal, timeoutSignal])
        : timeoutSignal;

      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.buildHeaders(),
          body,
          signal,
        });

        if (response.ok || !this.shouldRetryStatus(response.status)) {
          return response;
        }

        const errorText = await response.text().catch(() => '');
        const error = this.buildHttpError(response.status, response.statusText, errorText);
        if (!this.shouldRetryError(error) || attempt === MAX_PROVIDER_ATTEMPTS) {
          throw error;
        }

        this.logger.warn(`[${this.providerName}] transient LLM failure ${response.status}; retrying attempt ${attempt + 1}/${MAX_PROVIDER_ATTEMPTS}`);
        await this.delayBeforeRetry(attempt);
      } catch (err) {
        lastError = err;
        if (abortSignal?.aborted) {
          throw err;
        }
        const normalized = this.normalizeThrownError(err);
        if (!this.shouldRetryError(normalized) || attempt === MAX_PROVIDER_ATTEMPTS) {
          throw normalized;
        }
        this.logger.warn(`[${this.providerName}] transient LLM transport failure; retrying attempt ${attempt + 1}/${MAX_PROVIDER_ATTEMPTS}`);
        await this.delayBeforeRetry(attempt);
      }
    }

    throw this.normalizeThrownError(lastError);
  }

  private shouldRetryStatus(status: number): boolean {
    return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
  }

  private shouldRetryError(err: LLMProviderError): boolean {
    return err.code === 'LLM_RATE_LIMIT' || err.code === 'LLM_PROVIDER_DOWN' || err.code === 'LLM_TIMEOUT';
  }

  private buildHttpError(status: number, statusText: string, errorText: string): LLMProviderError {
    const body = errorText.toLowerCase();
    const message = `[${this.providerName}] LLM request failed: ${status} ${statusText} - ${errorText}`;

    if (status === 401 || status === 403) {
      return new LLMProviderError('LLM_AUTH', message);
    }
    if (body.includes('insufficient_quota') || body.includes('quota')) {
      return new LLMProviderError('LLM_QUOTA', message);
    }
    if (status === 429) {
      return new LLMProviderError('LLM_RATE_LIMIT', message);
    }
    if (status === 408 || status === 500 || status === 502 || status === 503 || status === 504) {
      return new LLMProviderError('LLM_PROVIDER_DOWN', message);
    }
    return new LLMProviderError('LLM_ERROR', message);
  }

  private normalizeThrownError(err: unknown): LLMProviderError {
    if (err instanceof LLMProviderError) {
      return err;
    }
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      return new LLMProviderError('LLM_TIMEOUT', `[${this.providerName}] LLM request timed out`);
    }
    if (err instanceof Error && err.name === 'TimeoutError') {
      return new LLMProviderError('LLM_TIMEOUT', `[${this.providerName}] LLM request timed out`);
    }
    return new LLMProviderError(
      'LLM_PROVIDER_DOWN',
      `[${this.providerName}] LLM transport failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  private async delayBeforeRetry(attempt: number): Promise<void> {
    const jitter = Math.floor(Math.random() * 10);
    await new Promise((resolve) => setTimeout(resolve, 25 * attempt + jitter));
  }

  protected supportsReasoningContentHistory(): boolean {
    return false;
  }

  private buildRequestMessage(message: ContextManagedLLMMessage): Record<string, unknown> {
    if (message.role === 'tool' && message.toolCallId) {
      return { role: 'tool', content: message.content, tool_call_id: message.toolCallId };
    }

    if (message.role === 'assistant') {
      const reasoningContent = this.getReasoningContent(message);

      if (message.toolCalls && message.toolCalls.length > 0) {
        return {
          role: 'assistant',
          content: this.normalizeAssistantContent(message.content),
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          tool_calls: message.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          })),
        };
      }

      return {
        role: 'assistant',
        content: reasoningContent ? this.normalizeAssistantContent(message.content) : message.content,
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
      };
    }

    return { role: message.role, content: message.content };
  }

  private getReasoningContent(message: ContextManagedLLMMessage): string | undefined {
    if (!this.supportsReasoningContentHistory()) {
      return undefined;
    }

    const reasoningContent = getReasoningContent(message);
    if (reasoningContent.length === 0) {
      return undefined;
    }

    return reasoningContent;
  }

  private normalizeAssistantContent(content: ContextManagedLLMMessage['content']): ContextManagedLLMMessage['content'] | null {
    return typeof content === 'string' && content.length === 0 ? null : content;
  }
}
