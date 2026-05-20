import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseOpenAICompatibleProvider } from './base-openai-compatible.provider';
import { XiaomiMiMoProvider } from './xiaomimimo.provider';
import type { LLMMessage, LLMStreamChunk } from '@kalio/types';

// Regression test for: Silent JSON parse error in streaming
// Issue: Empty catch block at line 98 that silently ignores parse errors
// AGENTS.md rule: "No empty catch... Log the error AND rethrow or handle explicitly"

describe('BaseOpenAICompatibleProvider', () => {
  let provider: BaseOpenAICompatibleProvider;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockLogger: { warn: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockLogger = {
      warn: vi.fn(),
      debug: vi.fn(),
    };
    provider = new BaseOpenAICompatibleProvider('TestProvider', 'test-key', 'gpt-4', 'https://api.test.com');
    // Replace the logger
    (provider as any).logger = mockLogger;
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe('streamChat - JSON Parse Error Logging (REGRESSION TEST)', () => {
    it('should log warning when SSE data JSON parse fails', async () => {
      // Arrange
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      const onChunk = vi.fn();
      const sessionId = 'sess-123';
      const messageId = 'msg-456';

      const mockStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          // Send malformed JSON
          controller.enqueue(encoder.encode('data: {invalid json}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      // Act
      await provider.streamChat(messages, tools, { sessionId, messageId, onChunk });

      // Assert
      // FIXED: Implementation now logs a warning when SSE data JSON parse fails
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse SSE chunk'),
      );
    });

    it('should continue streaming after JSON parse error', async () => {
      // Arrange
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      const onChunk = vi.fn();
      const sessionId = 'sess-123';
      const messageId = 'msg-456';

      const mockStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          // Send malformed JSON
          controller.enqueue(encoder.encode('data: {invalid}\n\n'));
          // Send valid data after error
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      // Act
      await provider.streamChat(messages, tools, { sessionId, messageId, onChunk });

      // Assert
      // Should log the error but continue processing valid data
      expect(mockLogger.warn).toHaveBeenCalled();
      expect(onChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          delta: 'Hello',
          done: false,
        }),
      );
    });
  });

  describe('buildHeaders()', () => {
    it('REGRESSION: omits Authorization when the API key is empty', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      const keylessProvider = new BaseOpenAICompatibleProvider('TestProvider', '', 'gpt-4', 'https://api.test.com');
      (keylessProvider as any).logger = mockLogger;

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      await keylessProvider.streamChat(messages, tools, { sessionId: 'sess-123', messageId: 'msg-456', onChunk: vi.fn() });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/chat/completions',
        expect.objectContaining({
          headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
        }),
      );
    });

    it('REGRESSION: Xiaomi passes assistant reasoning_content back together with tool calls', async () => {
      const messages = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'tc-1', name: 'my_tool', args: { prompt: 'cat' } }],
          reasoningContent: 'step 1',
        } as LLMMessage & { reasoningContent: string },
      ];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      const xiaomiProvider = new XiaomiMiMoProvider('test-key', 'mimo-v2-omni', 'https://api.test.com');
      (xiaomiProvider as unknown as { logger: typeof mockLogger }).logger = mockLogger;

      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      await xiaomiProvider.streamChat(messages, tools, { sessionId: 'sess-123', messageId: 'msg-456', onChunk: vi.fn() });

      const request = mockFetch.mock.calls[0]?.[1] as { body: string };
      const parsed = JSON.parse(request.body) as { messages: Array<Record<string, unknown>> };

      expect(parsed.messages[0]).toEqual({
        role: 'assistant',
        content: null,
        reasoning_content: 'step 1',
        tool_calls: [
          {
            id: 'tc-1',
            type: 'function',
            function: { name: 'my_tool', arguments: '{"prompt":"cat"}' },
          },
        ],
      });
    });
  });

  describe('streamChat - Tool Call ID Collision (REGRESSION TEST)', () => {
    it('should generate unique tool call IDs even for calls in same millisecond', async () => {
      // Arrange
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools = [
        { name: 'tool1', description: 'Tool 1', parameters: {} },
        { name: 'tool2', description: 'Tool 2', parameters: {} },
      ];
      const onChunk = vi.fn();
      const sessionId = 'sess-123';
      const messageId = 'msg-456';

      // Mock stream that returns two tool calls in the same chunk
      const mockStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          // Send two tool calls in the same message (simulating same millisecond)
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"tool1","arguments":"{}"}},{"index":1,"function":{"name":"tool2","arguments":"{}"}}]}}]}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      // Act
      const result = await provider.streamChat(messages, tools, { sessionId, messageId, onChunk });

      // Assert
      // BUG: Current implementation uses Date.now() for ID, which could collide for calls in same ms
      // Expected: All tool call IDs should be unique
      const ids = result.map((tc) => tc.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(result.length);
      expect(result).toHaveLength(2);
    });

    it('should generate unique IDs for multiple chunks with same timestamp', async () => {
      // Arrange
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools = [{ name: 'test_tool', description: 'Test', parameters: {} }];
      const onChunk = vi.fn();
      const sessionId = 'sess-123';
      const messageId = 'msg-456';

      // Mock stream that sends tool calls in rapid succession
      const mockStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          // First tool call
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"test_tool","arguments":"{\\"a\\":1}"}}]}}]}\n\n',
            ),
          );
          // Second tool call (could be in same millisecond)
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"test_tool","arguments":"{\\"b\\":2}"}}]}}]}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      // Act
      const result = await provider.streamChat(messages, tools, { sessionId, messageId, onChunk });

      // Assert
      const ids = result.map((tc) => tc.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(result.length);
    });
  });

  describe('streamChat - Normal Operation', () => {
    it('retries transient provider failures before streaming succeeds', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      const onChunk = vi.fn();
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: vi.fn().mockResolvedValue('busy'),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: mockStream,
        });

      await provider.streamChat(messages, tools, { sessionId: 'sess-123', messageId: 'msg-456', onChunk });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry authentication failures', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue('bad key'),
      });

      await expect(provider.streamChat(messages, tools, {
        sessionId: 'sess-123',
        messageId: 'msg-456',
        onChunk: vi.fn(),
      })).rejects.toMatchObject({ code: 'LLM_AUTH' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('rejects malformed streamed tool arguments instead of executing empty args', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools = [{ name: 'vfs_write', description: 'Write a file', parameters: {} }];
      const mockStream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"vfs_write","arguments":"{\\"path\\":"}}]}}]}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      await expect(provider.streamChat(messages, tools, {
        sessionId: 'sess-123',
        messageId: 'msg-456',
        onChunk: vi.fn(),
      })).rejects.toMatchObject({ code: 'LLM_BAD_TOOL_ARGS' });
    });

    it('REGRESSION: emits tool intent when function name streams before arguments', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'build a calculator' }];
      const tools = [{ name: 'raapp_create', description: 'Create an app', parameters: {} }];
      const onChunk = vi.fn();
      const onToolArgChunk = vi.fn();
      const sessionId = 'sess-123';
      const messageId = 'msg-456';

      const mockStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"raapp_create"}}]}}]}\n\n',
            ),
          );
          controller.enqueue(
            encoder.encode(
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"title\\":\\"Calculator\\"}"}}]}}]}\n\n',
            ),
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      await provider.streamChat(messages, tools, { sessionId, messageId, onChunk, onToolArgChunk });

      expect(onToolArgChunk).toHaveBeenCalledWith('raapp_create', 0);
    });

    it('should release the reader lock when abort happens mid-stream', async () => {
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      const sessionId = 'sess-123';
      const messageId = 'msg-456';
      const abortController = new AbortController();
      const reader = {
        read: vi.fn().mockResolvedValueOnce({
          done: false,
          value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'),
        }),
        releaseLock: vi.fn(),
      };
      const onChunk = vi.fn((chunk: LLMStreamChunk) => {
        if (chunk.delta === 'Hello') {
          abortController.abort();
        }
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: { getReader: () => reader },
      });

      const result = await provider.streamChat(messages, tools, { sessionId, messageId, onChunk, abortSignal: abortController.signal });

      expect(result).toEqual([]);
      expect(reader.releaseLock).toHaveBeenCalledOnce();
    });

    it('should stream content chunks correctly', async () => {
      // Arrange
      const messages: LLMMessage[] = [{ role: 'user', content: 'test' }];
      const tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = [];
      const onChunk = vi.fn();
      const sessionId = 'sess-123';
      const messageId = 'msg-456';

      const mockStream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":" World"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: mockStream,
      });

      // Act
      await provider.streamChat(messages, tools, { sessionId, messageId, onChunk });

      // Assert
      expect(onChunk).toHaveBeenCalledWith({
        delta: 'Hello',
        done: false,
        sessionId,
        messageId,
      });
      expect(onChunk).toHaveBeenCalledWith({
        delta: ' World',
        done: false,
        sessionId,
        messageId,
      });
      expect(onChunk).toHaveBeenCalledWith({
        delta: '',
        done: true,
        sessionId,
        messageId,
      });
    });
  });
});
