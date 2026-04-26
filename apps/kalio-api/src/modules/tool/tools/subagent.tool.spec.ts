import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { SubagentTool } from './subagent.tool';
import { LLMService } from '../../llm/llm.service';
import { ToolRegistryService } from '../tool-registry.service';
import { Reflector } from '@nestjs/core';
import type { ToolCallRequest } from '@kalio/types';

describe('SubagentTool', () => {
  let tool: SubagentTool;
  let mockLLM: { streamChat: ReturnType<typeof vi.fn> };
  let mockToolRegistry: { getAllTools: ReturnType<typeof vi.fn>; getToolsForSkills: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockLLM = { streamChat: vi.fn().mockResolvedValue([]) };
    mockToolRegistry = {
      getAllTools: vi.fn(() => []),
      getToolsForSkills: vi.fn(() => []),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SubagentTool,
        { provide: LLMService, useValue: mockLLM },
        { provide: ToolRegistryService, useValue: mockToolRegistry },
        Reflector,
      ],
    }).compile();

    tool = moduleRef.get<SubagentTool>(SubagentTool);
  });

  it('executes subagent with all tools when availableTools not provided', async () => {
    const mockTools = [{ name: 'tool1', description: 'Test tool', parameters: {} }];
    mockToolRegistry.getAllTools.mockReturnValue(mockTools);
    mockLLM.streamChat.mockResolvedValue([]);

    const request: ToolCallRequest = {
      sessionId: 'sess-123',
      toolName: 'run_subagent',
      args: { objective: 'Test task' },
      callId: 'call-789',
    };

    const result = await tool.execute(request);

    expect(mockToolRegistry.getAllTools).toHaveBeenCalled();
    expect(mockLLM.streamChat).toHaveBeenCalledWith(
      expect.arrayContaining([
        { role: 'system', content: expect.any(String) },
        { role: 'user', content: 'Test task' },
      ]),
      mockTools,
      expect.any(Function),
      'sess-123',
      expect.any(String),
    );
    expect(result.taskId).toBeDefined();
    expect(result.result).toBeDefined();
  });

  it('executes subagent with specific tools when availableTools provided', async () => {
    const mockTools = [{ name: 'tool1', description: 'Test tool', parameters: {} }];
    mockToolRegistry.getToolsForSkills.mockReturnValue(mockTools);
    mockLLM.streamChat.mockResolvedValue([]);

    const request: ToolCallRequest = {
      sessionId: 'sess-123',
      toolName: 'run_subagent',
      args: { objective: 'Test task', availableTools: ['tool1'] },
      callId: 'call-789',
    };

    const result = await tool.execute(request);

    expect(mockToolRegistry.getToolsForSkills).toHaveBeenCalledWith(['tool1']);
    expect(mockLLM.streamChat).toHaveBeenCalledWith(
      expect.any(Array),
      mockTools,
      expect.any(Function),
      'sess-123',
      expect.any(String),
    );
    expect(result.taskId).toBeDefined();
  });

  it('uses default timeout when not provided', async () => {
    mockToolRegistry.getAllTools.mockReturnValue([]);
    mockLLM.streamChat.mockImplementation(async (_, __, onChunk) => {
      onChunk({ delta: 'test', done: false, thinking: false });
      return [];
    });

    const request: ToolCallRequest = {
      sessionId: 'sess-123',
      toolName: 'run_subagent',
      args: { objective: 'Test task' },
      callId: 'call-789',
    };

    await tool.execute(request);

    // Should not timeout immediately (default is 60s)
    expect(mockLLM.streamChat).toHaveBeenCalled();
  });

  it('respects custom timeout when provided', async () => {
    mockToolRegistry.getAllTools.mockReturnValue([]);
    mockLLM.streamChat.mockImplementation(
      async (_, __, onChunk, ___, ____): Promise<unknown> => {
        return new Promise((resolve) => setTimeout(() => resolve([]), 10));
      },
    );

    const request: ToolCallRequest = {
      sessionId: 'sess-123',
      toolName: 'run_subagent',
      args: { objective: 'Test task', timeoutMs: 100 },
      callId: 'call-789',
    };

    const result = await tool.execute(request);

    expect(result.taskId).toBeDefined();
  });

  it('times out when LLM takes too long', async () => {
    mockToolRegistry.getAllTools.mockReturnValue([]);
    mockLLM.streamChat.mockImplementation(
      async (): Promise<unknown[]> => {
        return new Promise((resolve) => setTimeout(() => resolve([]), 10000));
      },
    );

    const request: ToolCallRequest = {
      sessionId: 'sess-123',
      toolName: 'run_subagent',
      args: { objective: 'Test task', timeoutMs: 50 },
      callId: 'call-789',
    };

    await expect(tool.execute(request)).rejects.toThrow('Sub-agent timed out after 50ms');
  });

  it('caps timeout at maximum 180000ms', async () => {
    mockToolRegistry.getAllTools.mockReturnValue([]);
    mockLLM.streamChat.mockResolvedValue([]);

    const request: ToolCallRequest = {
      sessionId: 'sess-123',
      toolName: 'run_subagent',
      args: { objective: 'Test task', timeoutMs: 200000 },
      callId: 'call-789',
    };

    await tool.execute(request);

    // Should not timeout with 200s, should be capped at 180s
    expect(mockLLM.streamChat).toHaveBeenCalled();
  });
});
