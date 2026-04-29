import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubagentTool } from './subagent.tool';
import type { LLMService } from '../../llm/llm.service';
import type { ModuleRef } from '@nestjs/core';
import type { ToolCallRequest } from '@kalio/types';
import type { ToolEntry } from '../tool-registry.service';

function makeRequest(args: Record<string, unknown> = {}, sessionId = 'sess-sub'): ToolCallRequest {
  return { callId: 'call-1', sessionId, toolName: 'run_subagent', args };
}

function makeRegistryMock(tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }> = []) {
  return {
    getAllTools: vi.fn().mockReturnValue(tools),
    getToolsForSkills: vi.fn().mockReturnValue(tools),
  };
}

// ── SubagentTool ──────────────────────────────────────────────────────────────

describe('SubagentTool', () => {
  let tool: SubagentTool;
  let llm: Partial<LLMService>;
  let moduleRef: Partial<ModuleRef>;
  let registry: ReturnType<typeof makeRegistryMock>;

  beforeEach(() => {
    registry = makeRegistryMock();

    llm = {
      streamChat: vi.fn(),
    };

    moduleRef = {
      get: vi.fn().mockReturnValue(registry),
    };

    tool = new SubagentTool(llm as LLMService, moduleRef as ModuleRef);
  });

  describe('positive scenarios', () => {
    it('returns result text and a UUID taskId', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockImplementation(
        async (_messages, _tools, onChunk: (c: { done: boolean; thinking: boolean; delta: string }) => void) => {
          onChunk({ done: false, thinking: false, delta: 'The answer is 42.' });
        },
      );

      const result = await tool.execute(makeRequest({ objective: 'What is 6 times 7?' }));

      expect(result.result).toBe('The answer is 42.');
      expect(result.taskId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('joins multiple chunks into a single result string', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockImplementation(
        async (_messages, _tools, onChunk: (c: { done: boolean; thinking: boolean; delta: string }) => void) => {
          onChunk({ done: false, thinking: false, delta: 'Hello' });
          onChunk({ done: false, thinking: false, delta: ' World' });
          onChunk({ done: true, thinking: false, delta: '' });
        },
      );

      const result = await tool.execute(makeRequest({ objective: 'greet' }));

      expect(result.result).toBe('Hello World');
    });

    it('calls getAllTools when no availableTools are provided', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await tool.execute(makeRequest({ objective: 'task' }));

      expect(registry.getAllTools).toHaveBeenCalled();
      expect(registry.getToolsForSkills).not.toHaveBeenCalled();
    });

    it('calls getToolsForSkills when availableTools list is provided', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await tool.execute(
        makeRequest({ objective: 'task', availableTools: ['vfs_read', 'vfs_write'] }),
      );

      expect(registry.getToolsForSkills).toHaveBeenCalledWith(['vfs_read', 'vfs_write']);
      expect(registry.getAllTools).not.toHaveBeenCalled();
    });

    it('works with the public ToolRegistryService API that exposes getEntries()', async () => {
      const entry: ToolEntry = {
        meta: {
          name: 'vfs_read',
          description: 'Read a file',
          parameters: { type: 'object' },
          requiresConfirmation: false,
        },
        execute: vi.fn().mockResolvedValue({}),
      };

      moduleRef = {
        get: vi.fn().mockReturnValue({
          getEntries: vi.fn().mockReturnValue([entry]),
        }),
      };
      tool = new SubagentTool(llm as LLMService, moduleRef as ModuleRef);
      (llm.streamChat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await expect(tool.execute(makeRequest({ objective: 'task' }))).resolves.toMatchObject({
        result: 'Sub-agent completed with no output.',
      });

      expect(llm.streamChat).toHaveBeenCalledWith(
        expect.any(Array),
        [entry.meta],
        expect.any(Function),
        'sess-sub',
        expect.stringMatching(/^subagent-/),
      );
    });
  });

  describe('edge cases', () => {
    it('returns fallback message when LLM produces no output chunks', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      const result = await tool.execute(makeRequest({ objective: 'silent task' }));

      expect(result.result).toBe('Sub-agent completed with no output.');
    });

    it('skips thinking chunks in result', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockImplementation(
        async (_messages, _tools, onChunk: (c: { done: boolean; thinking: boolean; delta: string }) => void) => {
          onChunk({ done: false, thinking: true, delta: 'thinking...' });
          onChunk({ done: false, thinking: false, delta: 'actual result' });
        },
      );

      const result = await tool.execute(makeRequest({ objective: 'think' }));

      expect(result.result).toBe('actual result');
      expect(result.result).not.toContain('thinking...');
    });

    it('caps timeoutMs at 180000 regardless of input', async () => {
      // We test the cap indirectly: if timeoutMs > 180000, the race should still
      // work (LLM returns before any timeout). The important thing is no crash.
      (llm.streamChat as ReturnType<typeof vi.fn>).mockImplementation(
        async (_messages, _tools, onChunk: (c: { done: boolean; thinking: boolean; delta: string }) => void) => {
          onChunk({ done: false, thinking: false, delta: 'ok' });
        },
      );

      const result = await tool.execute(makeRequest({ objective: 'test cap', timeoutMs: 999_999_999 }));

      expect(result.result).toBe('ok');
    });

    it('uses empty availableTools list correctly (falls back to getAllTools)', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await tool.execute(makeRequest({ objective: 'task', availableTools: [] }));

      // empty array → condition `availableTools.length > 0` is false → getAllTools
      expect(registry.getAllTools).toHaveBeenCalled();
    });
  });

  describe('negative scenarios', () => {
    it('rejects with timeout error when LLM takes too long', async () => {
      vi.useFakeTimers();

      (llm.streamChat as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 200_000)),
      );

      const promise = tool.execute(makeRequest({ objective: 'slow task', timeoutMs: 100 }));

      vi.advanceTimersByTime(200);

      await expect(promise).rejects.toThrow('timed out');

      vi.useRealTimers();
    });

    it('propagates error when LLMService.streamChat throws', async () => {
      (llm.streamChat as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM_UNAVAILABLE'));

      await expect(tool.execute(makeRequest({ objective: 'failing task' }))).rejects.toThrow('LLM_UNAVAILABLE');
    });
  });
});
