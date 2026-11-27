import { describe, expect, it, vi } from 'vitest';
import type { ToolResult } from '@kalio/types';
import type { CodexServerNotification, CodexServerRequest } from './codex-app-server.host';
import { CodexAppServerLLMSource } from './codex-app-server.llm-source';

describe('Codex fs_read result contract', () => {
  it.each([
    { content: '# first\r\nstep\r\n# second\r\n', reads: 1 },
    { content: '# first\nstep\n# second\n', reads: 1 },
    { content: '', reads: 1 },
    { content: '# same file, intentional second call\n', reads: 2 },
  ])('returns usable text without hiding genuine calls: %j', async ({ content, reads }) => {
      let requestListener: (request: CodexServerRequest) => void | Promise<void>;
      let notificationListener: (notification: CodexServerNotification) => void;
      let resultHandler: (callId: string, result: ToolResult) => void | Promise<void>;
      let attempts = 0;
      const expectedCases = (content.match(/^# /gm) ?? []).length;
      const issueRead = () => {
        attempts++;
        void requestListener({ id: attempts, method: 'item/tool/call', params: {
          threadId: 'thread', turnId: 'turn', callId: `read-${attempts}`,
          tool: 'fs_read', arguments: { path: 'harness/tests/example.test' },
        } });
      };
      const responses: string[] = [];
      const connection = {
        processEpoch: 'epoch',
        request: vi.fn(async (method: string) => {
          if (method === 'model/list') return { data: [{ model: 'gpt-6-luna' }] };
          if (method === 'thread/start') return { thread: { id: 'thread' } };
          if (method === 'turn/start') {
            queueMicrotask(issueRead);
            return { turn: { id: 'turn' } };
          }
          throw new Error(`Unexpected request: ${method}`);
        }),
        onRequest: (listener: typeof requestListener) => { requestListener = listener; return () => undefined; },
        onNotification: (listener: typeof notificationListener) => { notificationListener = listener; return () => undefined; },
        respond: (_id: string | number, value: unknown) => {
          const text = (value as { contentItems: Array<{ text: string }> }).contentItems[0]!.text;
          responses.push(text);
          // Recreate the stored model's first operation: count headings in the tool's string.
          // Retry once when the result is unusable, using a genuine new call ID.
          if (attempts < reads || ((text.match(/^# /gm) ?? []).length !== expectedCases && attempts < 2)) {
            queueMicrotask(issueRead);
          } else {
            notificationListener({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'turn' } } });
          }
        },
      };
      const source = new CodexAppServerLLMSource({ getConnection: async () => connection } as never);
      const execute = vi.fn(async () => ({ path: 'harness/tests/example.test', content, lines: content.split('\n').length }));
      const recordedCalls: string[] = [];
      const recordedResults: ToolResult[] = [];
      for await (const chunk of source.stream({
        sessionId: 'session', messageId: 'message', messages: [{ role: 'user', content: 'Count cases' }],
        tools: [{ name: 'fs_read', description: 'Read a file.', parameters: {}, requiresConfirmation: false }],
        executionProfile: { id: 'codex', name: 'Codex', kind: 'codex-app-server', model: 'gpt-6-luna',
          approvalMode: 'codex_guard', enabled: true, capabilitiesVersion: '1', createdAt: 1, updatedAt: 1 },
        toolResultChannel: { setHandler: handler => { resultHandler = handler; } },
      })) {
        if (chunk.type !== 'tool_call') continue;
        recordedCalls.push(chunk.callId);
        const result: ToolResult = { callId: chunk.callId, status: 'success', data: await execute() };
        recordedResults.push(result);
        await resultHandler!(chunk.callId, result);
      }
      expect(execute).toHaveBeenCalledTimes(reads);
      expect(recordedCalls).toEqual(Array.from({ length: reads }, (_, i) => `read-${i + 1}`));
      expect(recordedResults).toHaveLength(reads);
      expect(recordedResults[0]?.data).toEqual({ path: 'harness/tests/example.test', content, lines: content.split('\n').length });
      expect(responses).toEqual(Array.from({ length: reads }, () => content));
      expect(connection.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({
        dynamicTools: [expect.objectContaining({ description: expect.stringContaining('Returns raw file text') })],
      }));
    },
  );
});
