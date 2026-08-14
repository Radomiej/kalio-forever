import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatRunSnapshot, ChatSession } from '@kalio/types';
import { ChildExecutionContinuationService } from './child-execution-continuation.service';
import type { ContextAssemblyService } from './context-assembly.service';
import type { CredentialsService } from '../credentials/credentials.service';
import type { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import type { RunJournalService } from './run-journal.service';
import type { SessionManagerService } from './session-manager.service';
import type { SessionsService } from './sessions.service';

describe('ChildExecutionContinuationService', () => {
  it('commits one parent tool result and resumes the owning parent turn once', async () => {
    const child: ChatSession = {
      id: 'child-1', personaId: 'default', title: 'Child', kind: 'subagent',
      parentSessionId: 'parent-1', parentTurnId: 'parent-turn-1', parentToolCallId: 'tool-call-1',
      createdAt: 1, updatedAt: 1,
    };
    const parent: ChatSession = {
      id: 'parent-1', personaId: 'agent-orchestrator', title: 'Parent', kind: 'subagent',
      runtimeContext: { runtimeKind: 'agent-flow-branch', systemPromptProfile: 'agent-flow-branch' },
      createdAt: 1, updatedAt: 1,
    };
    const history: ChatMessage[] = [{
      id: 'prompt-1', sessionId: parent.id, role: 'user', content: 'Parent objective',
      turnId: child.parentTurnId, createdAt: 1,
    }, {
      id: 'assistant-tool-1', sessionId: parent.id, role: 'assistant', content: '',
      turnId: child.parentTurnId, toolCalls: [{ id: 'tool-call-1', name: 'run_subagent', args: {} }], createdAt: 1,
    }];
    const childRun = {
      id: 'child-run', sessionId: child.id, turnId: 'child-turn', status: 'completed',
      outcome: { finalText: 'child result', structuredOutput: { decision: 'continue' } },
    } as ChatRunSnapshot;
    const parentRun = { id: 'parent-run', status: 'interrupted_needs_retry', safeResume: true, revision: 2 } as ChatRunSnapshot;
    const runs = {
      getTurn: vi.fn().mockResolvedValue(parentRun), checkpoint: vi.fn(), complete: vi.fn(), fail: vi.fn(),
      claimChildContinuation: vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
      subscribeCompleted: vi.fn(),
    };
    const sessions = {
      get: vi.fn(async (id: string) => id === child.id ? child : parent),
      getMessages: vi.fn().mockImplementation(async () => history),
    };
    const messages = {
      saveToolResult: vi.fn(async (_sessionId: string, toolCallId: string, content: string) => {
        history.push({ id: 'tool-result-1', sessionId: parent.id, role: 'tool_result', content, toolCallId, turnId: child.parentTurnId, createdAt: 2 });
      }),
    };
    const context = {
      assembleForSessionRuntime: vi.fn().mockResolvedValue({
        effectiveSystemPrompt: 'system', toolMetas: [], model: 'mock', personaConfig: { maxToolAttempts: 30 },
      }),
    };
    const llm = {
      runAgentLoop: vi.fn().mockResolvedValue({
        finalText: 'parent resumed', structuredOutput: { nextAction: 'route_to' },
        lastMessageId: 'parent-message-1', maxIterationsReached: false, emptyNoToolRetriesExhausted: false,
      }),
    };
    const service = new ChildExecutionContinuationService(
      runs as unknown as RunJournalService,
      sessions as unknown as SessionsService,
      messages as unknown as SessionManagerService,
      context as unknown as ContextAssemblyService,
      llm as unknown as LLMTurnRuntimeService,
      { getMaxToolAttempts: vi.fn().mockResolvedValue(30) } as unknown as CredentialsService,
    );

    await expect(service.continueParent(childRun)).resolves.toBe(true);
    await expect(service.continueParent(childRun)).resolves.toBe(false);

    expect(messages.saveToolResult).toHaveBeenCalledTimes(1);
    expect(runs.claimChildContinuation).toHaveBeenCalledWith('parent-run', 2);
    expect(llm.runAgentLoop).toHaveBeenCalledTimes(1);
    expect(runs.complete).toHaveBeenCalledWith('parent-run', expect.objectContaining({
      finalText: 'parent resumed', structuredOutput: { nextAction: 'route_to' },
    }));
  });

  it('replays a completed owned child for a safe parent continuation during bootstrap', async () => {
    const parentRun = {
      id: 'parent-run', sessionId: 'parent-1', turnId: 'parent-turn-1',
      status: 'interrupted_needs_retry', safeResume: true, revision: 3,
    } as ChatRunSnapshot;
    const childRun = {
      id: 'child-run', sessionId: 'child-1', turnId: 'child-turn-1', status: 'completed',
      outcome: { finalText: 'durable child result' },
    } as ChatRunSnapshot;
    const child = {
      id: 'child-1', personaId: 'default', title: 'Child', kind: 'subagent',
      parentSessionId: 'parent-1', parentTurnId: 'parent-turn-1', parentToolCallId: 'tool-call-1',
      createdAt: 1, updatedAt: 1,
    } as ChatSession;
    const runs = {
      subscribeCompleted: vi.fn().mockReturnValue(vi.fn()),
      listSafeRecoverableRuns: vi.fn().mockResolvedValue([parentRun]),
      getLatestCompletedForSession: vi.fn().mockResolvedValue(childRun),
    };
    const sessions = { listChildren: vi.fn().mockResolvedValue([child]) };
    const service = new ChildExecutionContinuationService(
      runs as unknown as RunJournalService,
      sessions as unknown as SessionsService,
      {} as SessionManagerService,
      {} as ContextAssemblyService,
      {} as LLMTurnRuntimeService,
      {} as CredentialsService,
    );
    const continueParent = vi.spyOn(service, 'continueParent').mockResolvedValue(true);

    await service.onApplicationBootstrap();

    expect(sessions.listChildren).toHaveBeenCalledWith('parent-1');
    expect(runs.getLatestCompletedForSession).toHaveBeenCalledWith('child-1');
    expect(continueParent).toHaveBeenCalledWith(childRun);
  });

  it('resumes after restart when the parent tool result was already committed', async () => {
    const child = {
      id: 'child-1', personaId: 'default', title: 'Child', kind: 'subagent',
      parentSessionId: 'parent-1', parentTurnId: 'parent-turn-1', parentToolCallId: 'tool-call-1',
      createdAt: 1, updatedAt: 1,
    } as ChatSession;
    const parent = {
      id: 'parent-1', personaId: 'agent-orchestrator', title: 'Parent', kind: 'subagent',
      runtimeContext: { runtimeKind: 'agent-flow-branch', systemPromptProfile: 'agent-flow-branch' },
      createdAt: 1, updatedAt: 1,
    } as ChatSession;
    const history: ChatMessage[] = [
      { id: 'prompt-1', sessionId: parent.id, role: 'user', content: 'Parent objective', turnId: 'parent-turn-1', createdAt: 1 },
      { id: 'assistant-1', sessionId: parent.id, role: 'assistant', content: '', turnId: 'parent-turn-1', toolCalls: [{ id: 'tool-call-1', name: 'run_subagent', args: {} }], createdAt: 2 },
      { id: 'result-1', sessionId: parent.id, role: 'tool_result', content: '{}', toolCallId: 'tool-call-1', turnId: 'parent-turn-1', createdAt: 3 },
    ];
    const runs = {
      getTurn: vi.fn().mockResolvedValue({
        id: 'parent-run', status: 'interrupted_needs_retry', safeResume: true, revision: 4,
      }),
      claimChildContinuation: vi.fn().mockResolvedValue(true),
      complete: vi.fn(), fail: vi.fn(), subscribeCompleted: vi.fn(),
    };
    const sessions = {
      get: vi.fn(async (id: string) => id === child.id ? child : parent),
      getMessages: vi.fn().mockResolvedValue(history),
    };
    const messages = { saveToolResult: vi.fn() };
    const llm = { runAgentLoop: vi.fn().mockResolvedValue({ finalText: 'parent resumed', lastMessageId: 'message-1' }) };
    const service = new ChildExecutionContinuationService(
      runs as unknown as RunJournalService,
      sessions as unknown as SessionsService,
      messages as unknown as SessionManagerService,
      { assembleForSessionRuntime: vi.fn().mockResolvedValue({ effectiveSystemPrompt: 'system', toolMetas: [], model: 'mock' }) } as unknown as ContextAssemblyService,
      llm as unknown as LLMTurnRuntimeService,
      { getMaxToolAttempts: vi.fn().mockResolvedValue(30) } as unknown as CredentialsService,
    );
    const childRun = {
      id: 'child-run', sessionId: child.id, turnId: 'child-turn', status: 'completed',
      outcome: { finalText: 'child result' },
    } as ChatRunSnapshot;

    await expect(service.continueParent(childRun)).resolves.toBe(true);
    expect(messages.saveToolResult).not.toHaveBeenCalled();
    expect(llm.runAgentLoop).toHaveBeenCalledTimes(1);
    expect(runs.complete).toHaveBeenCalledTimes(1);
  });
});
