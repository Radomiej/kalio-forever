import { describe, expect, it, vi } from 'vitest';
import type { AgentRunContext, ChatSession, ToolMeta, ToolResult } from '@kalio/types';
import { SubagentRuntimeService } from '../subagent-runtime.service';
import { TurnState } from '../turn-state';
import type { ILLMSource, LLMSourceParams } from '../interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../interfaces/llm-chunk.types';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { StreamProcessorService } from '../stream-processor.service';
import type { ToolDispatchService } from '../tool-dispatch.service';
import type { SessionManagerService } from '../session-manager.service';
import type { SessionsService } from '../sessions.service';
import type { VFSService } from '../../vfs/vfs.service';
import type { PersonaService } from '../../persona/persona.service';

const tools: ToolMeta[] = [
  { name: 'run_subagent', description: 'spawn child', parameters: {}, requiresConfirmation: false },
  { name: 'vfs_write', description: 'write file', parameters: {}, requiresConfirmation: true },
];

async function* streamFrom(chunks: InternalLLMChunk[]): AsyncIterable<InternalLLMChunk> {
  for (const chunk of chunks) yield chunk;
}

function makeProcessor(sessionManager: Pick<SessionManagerService, 'persistAssistantMessage'>): Pick<StreamProcessorService, 'process'> {
  return {
    process: vi.fn(async (chunk: InternalLLMChunk, ctx: StreamContext) => {
      if (chunk.type === 'text_delta') {
        ctx.state.appendText(chunk.delta);
        ctx.emit('chat:chunk', { sessionId: ctx.sessionId, messageId: ctx.messageId, delta: chunk.delta, done: false, agentRun: ctx.agentRun });
      }
      if (chunk.type === 'tool_call') {
        ctx.state.addToolCall({ id: chunk.callId, name: chunk.name, args: chunk.args });
      }
      if (chunk.type === 'done') {
        await sessionManager.persistAssistantMessage(ctx.sessionId, ctx.messageId, ctx.state as TurnState);
      }
    }),
  };
}

function makeSession(id: string): ChatSession {
  return { id, personaId: 'default', title: `Sub-agent: ${id}`, kind: 'subagent', createdAt: 1, updatedAt: 1 };
}

describe('SubagentRuntimeService nested subagents', () => {
  it('lets a first-level subagent see run_subagent, but hides it at the nested-depth limit', async () => {
    const streamCalls: LLMSourceParams[] = [];
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        streamCalls.push(params);
        return streamFrom([{ type: 'text_delta', delta: 'done' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory'>;
    const runtime = new SubagentRuntimeService(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      { dispatch: vi.fn(), getToolMetas: vi.fn() } as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      { createWithId: vi.fn(async (id: string) => makeSession(id)) } as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-1',
      objective: 'outer',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
    });
    await runtime.runSubagent({
      parentSessionId: 'sub-parent',
      parentToolCallId: 'call-2',
      objective: 'nested',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      parentAgentRun: { agentRunId: 'parent-run', agentType: 'subagent', subagentDepth: 1 } as AgentRunContext,
    });

    expect(streamCalls[0].tools.map((tool) => tool.name)).toContain('run_subagent');
    expect(streamCalls[1].tools.map((tool) => tool.name)).not.toContain('run_subagent');
  });

  it('executes a subagent that delegates to one nested subagent', async () => {
    const sessionStreamCounts = new Map<string, number>();
    const llmSource: ILLMSource = {
      stream: vi.fn((params: LLMSourceParams) => {
        const count = sessionStreamCounts.get(params.sessionId) ?? 0;
        sessionStreamCounts.set(params.sessionId, count + 1);
        if (params.sessionId.startsWith('sub-') && count === 0 && params.tools.some((tool) => tool.name === 'run_subagent')) {
          return streamFrom([
            { type: 'tool_call', callId: 'nested-call', name: 'run_subagent', args: { objective: 'nested objective' } },
            { type: 'done' },
          ]);
        }
        if (count === 0) {
          return streamFrom([{ type: 'text_delta', delta: 'nested done' }, { type: 'done' }]);
        }
        return streamFrom([{ type: 'text_delta', delta: 'outer saw nested' }, { type: 'done' }]);
      }),
    };
    const sessionManager = {
      persistUserMessage: vi.fn().mockResolvedValue(undefined),
      persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
      saveToolResult: vi.fn().mockResolvedValue(undefined),
      loadHistory: vi.fn().mockResolvedValue([]),
    } satisfies Pick<SessionManagerService, 'persistUserMessage' | 'persistAssistantMessage' | 'saveToolResult' | 'loadHistory'>;
    const sessions = { createWithId: vi.fn(async (id: string) => makeSession(id)) };
    let runtime: SubagentRuntimeService;
    const toolDispatch = {
      dispatch: vi.fn(async (callId: string, toolName: string, args: Record<string, unknown>, ctx: StreamContext, availableTools: ToolMeta[]): Promise<ToolResult> => {
        if (toolName !== 'run_subagent') return { callId, status: 'success', data: {} };
        if (!availableTools.some((tool) => tool.name === 'run_subagent')) {
          return { callId, status: 'error', errorCode: 'TOOL_NOT_AVAILABLE', errorMessage: 'run_subagent unavailable' };
        }
        const result = await runtime.runSubagent({
          parentSessionId: ctx.sessionId,
          parentToolCallId: callId,
          objective: typeof args['objective'] === 'string' ? args['objective'] : 'nested',
          availableTools,
          timeoutMs: 60000,
          vfsMode: 'isolated',
          copyOutputs: false,
          emit: ctx.emit,
          parentAgentRun: ctx.agentRun,
        });
        return { callId, status: 'success', data: result, sessionId: ctx.sessionId, toolName, agentRun: ctx.agentRun };
      }),
      getToolMetas: vi.fn(),
    };
    runtime = new SubagentRuntimeService(
      llmSource,
      makeProcessor(sessionManager) as StreamProcessorService,
      toolDispatch as unknown as ToolDispatchService,
      sessionManager as unknown as SessionManagerService,
      sessions as unknown as SessionsService,
      { copySessionFiles: vi.fn(() => []) } as unknown as VFSService,
      { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', model: '', availableSkills: [], kv: {} }) } as unknown as PersonaService,
    );

    const result = await runtime.runSubagent({
      parentSessionId: 'master',
      parentToolCallId: 'call-outer',
      objective: 'outer objective',
      availableTools: tools,
      timeoutMs: 60000,
      vfsMode: 'isolated',
      copyOutputs: false,
      emit: vi.fn(),
    });

    expect(result.result).toBe('outer saw nested');
    expect(sessions.createWithId).toHaveBeenCalledTimes(2);
    expect(toolDispatch.dispatch).toHaveBeenCalledWith(
      'nested-call',
      'run_subagent',
      { objective: 'nested objective' },
      expect.objectContaining({ agentRun: expect.objectContaining({ subagentDepth: 1 }) }),
      expect.arrayContaining([expect.objectContaining({ name: 'run_subagent' })]),
    );
  });
});