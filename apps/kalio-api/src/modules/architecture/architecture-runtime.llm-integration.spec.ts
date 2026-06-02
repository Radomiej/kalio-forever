import type { ArchitectureExecutionEvent, ArchitectureSchema, ChatMessage, ChatSession, CreateSessionDto } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { ChatService } from '../chat/chat.service';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { EmitFn } from '../chat/interfaces/stream-context.interface';
import { MockLLMProvider } from '../llm/providers/mock.provider';
import type { SessionsService } from '../chat/sessions.service';
import type { RunSubagentRequest, RunSubagentResult, SubagentRuntimePort } from '../tool/subagent-runtime.port';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ArchitectureRoleExecutorService } from './architecture-role-executor';
import { ArchitectureRuntimeService } from './architecture-runtime.service';

describe('Architecture graph runtime LLM integration', () => {
  it('runs a graph role through MockLLM-backed chat and preserves normal chat compatibility', async () => {
    const harness = createMockChatHarness(vi.fn().mockResolvedValue(undefined));
    const roleExecutor = new ArchitectureRoleExecutorService(createSubagentRuntime(harness.chat));
    const sessions = createSessionStore();
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions.service as unknown as SessionsService,
      { persistMessage: vi.fn().mockResolvedValue(undefined) } as never,
      roleExecutor,
    );
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const schema = {
      ...baseSchema,
      id: 'mock-llm-graph-runtime',
      name: 'Mock LLM Graph Runtime',
      roleSlots: baseSchema.roleSlots.filter((slot) => ['pragmatist', 'router', 'finalizer'].includes(slot.id)),
      nodes: [
        { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
        {
          id: 'router-1',
          label: 'Router 1',
          kind: 'router' as const,
          roleSlotId: 'router',
          behavior: { mode: 'choose_one' as const, convergeToNodeId: 'artifact' },
        },
        {
          id: 'artifact',
          label: 'Artifact',
          kind: 'artifact' as const,
          roleSlotId: 'finalizer',
          behavior: { mode: 'finalize' as const },
        },
      ],
      edges: [
        { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
        { id: 'router-1-artifact', fromNodeId: 'router-1', toNodeId: 'artifact' },
      ],
    };

    const streamedEvents: Array<{ event: string; data: unknown }> = [];
    const run = await runtime.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Mock LLM should drive the graph role.',
      executionMode: 'subagent_execution',
      schema,
    }, (event, data) => {
      streamedEvents.push({ event, data });
    });

    const events = runtime.getEvents(run.id);
    const roleEvent = semanticEventForNode(events, 'agent-1');
    const routerEvent = semanticEventForNode(events, 'router-1');
    const finalizerEvent = semanticEventForNode(events, 'artifact');
    expect(run.status).toBe('completed');
    expect(Object.keys(run.branchSessionIds ?? {})).toEqual(['pragmatist', 'router', 'finalizer']);
    expect(roleEvent?.message).toContain('[MockLLM] Echo: Architecture: Mock LLM Graph Runtime v');
    expect(roleEvent?.message).toContain('Slot: Pragmatist');
    expect(roleEvent?.message).toContain('Task: Mock LLM should drive the graph role.');
    expect(routerEvent?.message).toContain('[MockLLM] Echo: Architecture: Mock LLM Graph Runtime v');
    expect(routerEvent?.message).toContain('Slot: Router');
    expect(routerEvent?.message).toContain('Incoming graph outputs:');
    expect(finalizerEvent?.message).toContain('[MockLLM] Echo: Architecture: Mock LLM Graph Runtime v');
    expect(finalizerEvent?.message).toContain('Slot: Finalizer');
    expect(finalizerEvent?.message).toContain('Incoming graph outputs:');
    expect(roleEvent?.data?.['stream']).toMatchObject({
      streamGroupId: `architecture:${run.id}:agent-1`,
      status: 'completed',
      chunkCount: expect.any(Number),
    });
    expect(events.map((event) => event.message).join('\n')).not.toContain('branch prepared');
    expect(events.map((event) => event.message).join('\n')).not.toContain('synthesized from graph execution');
    expect(runtime.getGraph(run.id)?.routeHops).toEqual([
      expect.objectContaining({ source: 'runtime_fallback', fromNodeId: 'agent-1', toNodeId: 'router-1' }),
      expect.objectContaining({ source: 'router', fromNodeId: 'router-1', toNodeId: 'artifact' }),
    ]);
    expect(runtime.getChat(run.id)?.messages.map((message) => message.speaker)).toEqual([
      'system',
      'participant',
      'router',
      'finalizer',
    ]);
    expect(streamedEvents.map((entry) => entry.event)).toEqual(expect.arrayContaining([
      'agent:start',
      'chat:chunk',
      'chat:complete',
      'agent:done',
    ]));
    expect(streamedEvents
      .filter((entry) => entry.event === 'chat:chunk')
      .map((entry) => String((entry.data as { delta?: string }).delta ?? ''))
      .join('')).toContain('[MockLLM] Echo: Architecture: Mock LLM Graph Runtime v');

    const normalChatEvents = await harness.sendNormalChatTurn(
      'normal-chat-session',
      'Plain chat must still use MockLLM.',
    );
    expect(normalChatEvents.map((entry) => entry.event)).toContain('chat:complete');
    expect(normalChatEvents.map((entry) => entry.event)).toEqual(expect.arrayContaining([
      'agent:start',
      'chat:context',
      'chat:chunk',
      'chat:complete',
      'agent:done',
    ]));
    expect(normalChatEvents
      .filter((entry) => entry.event === 'chat:chunk')
      .map((entry) => String((entry.data as { delta?: string }).delta ?? ''))
      .join('')).toContain('[MockLLM] Echo: Plain chat must still use MockLLM.');
  }, 60_000);

  it('supports directed MockLLM scripts for staged graph-runtime show runs', async () => {
    const delay = vi.fn().mockResolvedValue(undefined);
    const harness = createMockChatHarness(delay);
    const roleExecutor = new ArchitectureRoleExecutorService(createSubagentRuntime(harness.chat));
    const sessions = createSessionStore();
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions.service as unknown as SessionsService,
      { persistMessage: vi.fn().mockResolvedValue(undefined) } as never,
      roleExecutor,
    );
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const schema = {
      ...baseSchema,
      id: 'scripted-show-runtime',
      name: 'Scripted Show Runtime',
      roleSlots: baseSchema.roleSlots.filter((slot) => ['pragmatist', 'router', 'finalizer'].includes(slot.id)),
      nodes: [
        { id: 'pragmatist', label: 'Pragmatist', kind: 'role' as const, roleSlotId: 'pragmatist' },
        {
          id: 'router',
          label: 'Router',
          kind: 'router' as const,
          roleSlotId: 'router',
          behavior: { mode: 'choose_one' as const, convergeToNodeId: 'final-artifact' },
        },
        {
          id: 'final-artifact',
          label: 'Final Artifact',
          kind: 'artifact' as const,
          roleSlotId: 'finalizer',
          behavior: { mode: 'finalize' as const },
        },
      ],
      edges: [
        { id: 'pragmatist-router', fromNodeId: 'pragmatist', toNodeId: 'router' },
        { id: 'router-final', fromNodeId: 'router', toNodeId: 'final-artifact' },
      ],
    };
    const scriptedPrompt = [
      'Run the scripted show.',
      '[[mock:script]]',
      'when("Slot: Pragmatist") wait(4) return("Pragmatist scripted response")',
      'when("Slot: Router") return("route_to(final-artifact, Router scripted merge)")',
      'when("Slot: Finalizer") return("Final scripted answer")',
      '[[/mock:script]]',
    ].join('\n');

    const run = await runtime.createRun({
      schemaId: 'strategic-decision-council',
      prompt: scriptedPrompt,
      executionMode: 'subagent_execution',
      schema,
    });

    const events = runtime.getEvents(run.id);
    expect(run.status).toBe('completed');
    expect(delay).toHaveBeenCalledWith(4);
    expect(semanticEventForNode(events, 'pragmatist')?.message).toBe('Pragmatist scripted response');
    expect(semanticEventForNode(events, 'router')?.message).toBe('route_to(final-artifact, Router scripted merge)');
    expect(semanticEventForNode(events, 'final-artifact')?.message).toBe('Final scripted answer');
    const chatMessages = runtime.getChat(run.id)?.messages.map((message) => message.content) ?? [];
    expect(chatMessages[0]).toContain('Architecture run created for: Run the scripted show.');
    expect(chatMessages.slice(1)).toEqual([
      'Pragmatist scripted response',
      'route_to(final-artifact, Router scripted merge)',
      'Final scripted answer',
    ]);
  });

  it('runs a dry Goal Master delivery loop with MockLLM rejection before final acceptance', async () => {
    const source = new StatefulDeliveryLoopLLMSource();
    const harness = createMockChatHarness(undefined, source);
    const roleExecutor = new ArchitectureRoleExecutorService(createSubagentRuntime(harness.chat));
    const sessions = createSessionStore();
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions.service as unknown as SessionsService,
      { persistMessage: vi.fn().mockResolvedValue(undefined) } as never,
      roleExecutor,
    );
    const schema = dryGoalMasterLoopSchema();

    const run = await runtime.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Dry-run the two-agent delivery loop before any live Xiaomi run.',
      executionMode: 'subagent_execution',
      schema,
      context: {
        maxArchitectureNodeVisits: 2,
        maxArchitectureSteps: 30,
      },
    });
    const events = runtime.getEvents(run.id);
    const goalDecisions = events.filter((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');
    const finalizerInput = source.prompts.find((prompt) => prompt.includes('Slot: Finalizer')) ?? '';

    expect(run.status).toBe('completed');
    expect(goalDecisions).toHaveLength(2);
    expect(goalDecisions[0]?.route?.selectedNodeIds).toEqual(['implementer']);
    expect(goalDecisions[0]?.message).toContain('missing build evidence');
    expect(goalDecisions[1]?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(goalDecisions[1]?.message).toContain('accepts verified build evidence');
    expect(events.filter((event) => event.nodeId === 'implementer' && event.type === 'participant_output')).toHaveLength(2);
    expect(events.filter((event) => event.nodeId === 'tester' && event.type === 'participant_output')).toHaveLength(2);
    expect(semanticEventForNode(events, 'final-artifact')?.message).toContain('Verified completion report');
    expect(finalizerInput).toContain('Goal Master found missing build evidence');
    expect(finalizerInput).toContain('Goal Master accepts verified build evidence');
  });

  it('runs a dry Goal Master delivery loop with immediate MockLLM acceptance', async () => {
    const source = new GoalMasterScenarioLLMSource('accept-immediately');
    const harness = createMockChatHarness(undefined, source);
    const roleExecutor = new ArchitectureRoleExecutorService(createSubagentRuntime(harness.chat));
    const sessions = createSessionStore();
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions.service as unknown as SessionsService,
      { persistMessage: vi.fn().mockResolvedValue(undefined) } as never,
      roleExecutor,
    );

    const run = await runtime.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Accept once implementation, materialization, verification, and test evidence are visible.',
      executionMode: 'subagent_execution',
      schema: dryGoalMasterLoopSchema(),
      context: {
        maxArchitectureNodeVisits: 2,
        maxArchitectureSteps: 30,
      },
    });
    const events = runtime.getEvents(run.id);
    const goalDecisions = events.filter((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(run.status).toBe('completed');
    expect(goalDecisions).toHaveLength(1);
    expect(goalDecisions[0]?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(goalDecisions[0]?.message).toContain('accepts complete evidence');
    expect(events.filter((event) => event.nodeId === 'implementer' && event.type === 'participant_output')).toHaveLength(1);
    expect(semanticEventForNode(events, 'final-artifact')?.message).toContain('Verified completion report');
  });

  it('fails a dry Goal Master delivery loop when MockLLM keeps rejecting past the step guard', async () => {
    const source = new GoalMasterScenarioLLMSource('reject-forever');
    const harness = createMockChatHarness(undefined, source);
    const roleExecutor = new ArchitectureRoleExecutorService(createSubagentRuntime(harness.chat));
    const sessions = createSessionStore();
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions.service as unknown as SessionsService,
      { persistMessage: vi.fn().mockResolvedValue(undefined) } as never,
      roleExecutor,
    );

    const run = await runtime.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Keep rejecting until the bounded runtime guard stops the graph.',
      executionMode: 'subagent_execution',
      schema: dryGoalMasterLoopSchema(),
      context: {
        maxArchitectureNodeVisits: 10,
        maxArchitectureSteps: 8,
      },
    });
    const events = runtime.getEvents(run.id);
    const goalDecisions = events.filter((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');
    const stopEvent = events.find((event) => (
      event.type === 'router_decision'
      && event.message.startsWith('Runtime stopped after 8 graph steps.')
    ));

    expect(run.status).toBe('failed');
    expect(goalDecisions.length).toBeGreaterThanOrEqual(1);
    expect(goalDecisions.every((event) => event.route?.selectedNodeIds.includes('implementer'))).toBe(true);
    expect(events.filter((event) => event.nodeId === 'implementer' && event.type === 'participant_output').length)
      .toBeGreaterThanOrEqual(2);
    expect(stopEvent).toBeDefined();
    expect(stopEvent?.data).toMatchObject({
      maxSteps: 8,
      maxNodeVisits: 10,
      pendingNodeIds: expect.arrayContaining(['verifier']),
      visitCounts: expect.objectContaining({
        implementer: expect.any(Number),
        'goal-master': expect.any(Number),
      }),
    });
    expect(events.some((event) => event.type === 'final_artifact')).toBe(false);
  });

  it('executes the production Goal Master tool-executor evidence path with deterministic subagent events', async () => {
    const subagentRuntime = new EvidenceProducingSubagentRuntime();
    const roleExecutor = new ArchitectureRoleExecutorService(subagentRuntime);
    const sessions = createSessionStore();
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions.service as unknown as SessionsService,
      { persistMessage: vi.fn().mockResolvedValue(undefined) } as never,
      roleExecutor,
    );

    const run = await runtime.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Produce and verify a deterministic VFS proof artifact.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 30,
      },
    });
    const events = runtime.getEvents(run.id);
    const materializerOutput = events.find((event) => event.nodeId === 'materializer' && event.type === 'participant_output');
    const verifierOutput = events.find((event) => event.nodeId === 'verifier' && event.type === 'participant_output');
    const goalDecision = events.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(run.status).toBe('completed');
    expect(materializerOutput?.data?.['toolEvidence']).toMatchObject({
      toolResultCount: 1,
      successfulToolNames: ['vfs_write'],
      targetPaths: ['evidence/proof.json'],
    });
    expect(verifierOutput?.data?.['toolEvidence']).toMatchObject({
      toolResultCount: 1,
      successfulToolNames: ['vfs_read'],
      targetPaths: ['evidence/proof.json'],
    });
    expect(goalDecision?.data?.['toolEvidence']).toMatchObject({
      successfulToolNames: ['vfs_read'],
    });
    expect(goalDecision?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(semanticEventForNode(events, 'final-artifact')?.message).toContain('Production evidence path accepted');
    expect(subagentRuntime.calls.map((call) => call.slot)).toEqual([
      'orchestrator',
      'implementer',
      'materializer',
      'verifier',
      'tester',
      'goal_master',
      'finalizer',
    ]);
  });
});

function semanticEventForNode(
  events: ArchitectureExecutionEvent[],
  nodeId: string,
): ArchitectureExecutionEvent | undefined {
  return events.find((event) => (
    event.nodeId === nodeId
    && ['participant_output', 'router_decision', 'final_artifact'].includes(event.type)
  ));
}

function createSubagentRuntime(chat: ChatService): SubagentRuntimePort {
  return {
    async runSubagent(request: RunSubagentRequest): Promise<RunSubagentResult> {
      const chunks: string[] = [];
      const emit: EmitFn = (event, data) => {
        if (event === 'chat:chunk') {
          chunks.push((data as { delta?: string }).delta ?? '');
        }
        request.emit?.(event, data);
      };
      await chat.handleTurn(
        request.childSessionId ?? `child-${request.parentToolCallId}`,
        request.objective,
        request.personaId ?? 'default',
        emit,
      );
      return {
        result: chunks.join('').trim(),
        taskId: `task-${request.parentToolCallId}`,
        childSessionId: request.childSessionId ?? `child-${request.parentToolCallId}`,
        parentSessionId: request.parentSessionId,
        vfsMode: request.vfsMode,
        vfsSessionId: request.childSessionId ?? `child-${request.parentToolCallId}`,
        copiedFiles: [],
        durationMs: 1,
      };
    },
  };
}

function createMockChatHarness(delay?: (ms: number) => Promise<void>, source?: ILLMSource): {
  chat: ChatService;
  sendNormalChatTurn: (sessionId: string, content: string) => Promise<Array<{ event: string; data: unknown }>>;
} {
  const messagesBySession = new Map<string, ContextManagedLLMMessage[]>();
  const sessionManager = {
    ensureSession: vi.fn().mockResolvedValue(undefined),
    persistUserMessage: vi.fn().mockImplementation(async (sessionId: string, content: string) => {
      const messages = messagesBySession.get(sessionId) ?? [];
      messages.push({ role: 'user', content });
      messagesBySession.set(sessionId, messages);
      return { id: `user-${messages.length}`, sessionId, role: 'user', content, createdAt: Date.now() };
    }),
    persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
    saveToolResult: vi.fn().mockResolvedValue(undefined),
    loadHistory: vi.fn().mockResolvedValue([]),
    loadHistoryForLLM: vi.fn().mockImplementation(async (sessionId: string, options: { systemPrompt: string }) => {
      const history = [
        ...(options.systemPrompt ? [{ role: 'system' as const, content: options.systemPrompt }] : []),
        ...(messagesBySession.get(sessionId) ?? []),
      ];
      return {
        history,
        unboundedHistoryCount: history.length,
      };
    }),
  };
  const chat = new ChatService(
    source ?? new MockLLMSource(delay),
    {
      process: vi.fn().mockImplementation(async (chunk: InternalLLMChunk, ctx: { state: { appendText: (delta: string) => void }; emit: EmitFn; sessionId: string; messageId: string }) => {
        if (chunk.type !== 'text_delta') return;
        ctx.state.appendText(chunk.delta);
        ctx.emit('chat:chunk', {
          sessionId: ctx.sessionId,
          messageId: ctx.messageId,
          delta: chunk.delta,
          done: false,
        });
      }),
    } as never,
    sessionManager as never,
    { getToolMetas: vi.fn().mockReturnValue([]), dispatch: vi.fn() } as never,
    { getSessionConfig: vi.fn().mockResolvedValue({ systemPrompt: '', availableSkills: [], kv: {} }) } as never,
    { findByIds: vi.fn().mockResolvedValue([]) } as never,
    { getMaxToolAttempts: vi.fn().mockResolvedValue(8), getContextWindowSize: vi.fn().mockResolvedValue(32000) } as never,
    { log: vi.fn().mockResolvedValue('audit-id'), update: vi.fn().mockResolvedValue(undefined) } as never,
  );

  return {
    chat,
    async sendNormalChatTurn(sessionId: string, content: string) {
      const events: Array<{ event: string; data: unknown }> = [];
      const emit: EmitFn = (event, data) => events.push({ event, data });
      await chat.handleTurn(sessionId, content, 'default', emit);
      return events;
    },
  };
}

class StatefulDeliveryLoopLLMSource implements ILLMSource {
  readonly prompts: string[] = [];
  private goalMasterVisits = 0;
  private testerVisits = 0;

  async *stream(params: LLMSourceParams): AsyncIterable<InternalLLMChunk> {
    const prompt = lastUserPrompt(params.messages);
    this.prompts.push(prompt);
    const response = this.responseFor(prompt);
    yield { type: 'text_delta', delta: response };
    yield { type: 'done' };
  }

  private responseFor(prompt: string): string {
    if (prompt.includes('Slot: Orchestrator')) {
      return 'Orchestrator defined acceptance criteria and routes to implementation. route_to(implementer, start delivery)';
    }
    if (prompt.includes('Slot: Implementer')) {
      return 'Implementer prepared React/Vite/Tailwind changes for the salon site.';
    }
    if (prompt.includes('Slot: Materializer')) {
      return 'Materializer produced concrete project files for the salon website.';
    }
    if (prompt.includes('Slot: Verifier')) {
      return this.testerVisits === 0
        ? 'Verifier read files but build evidence is still missing.'
        : 'Verifier confirmed npm install and npm run build evidence.';
    }
    if (prompt.includes('Slot: Tester')) {
      this.testerVisits += 1;
      return this.testerVisits === 1
        ? 'Tester found missing build evidence and weak points.'
        : 'Tester verified npm run build passed and deployment files exist.';
    }
    if (prompt.includes('Slot: Goal Master')) {
      this.goalMasterVisits += 1;
      return this.goalMasterVisits === 1
        ? 'Goal Master found missing build evidence. route_to(implementer, fix verification gap)'
        : 'Goal Master accepts verified build evidence. route_to(final-artifact, accepted)';
    }
    if (prompt.includes('Slot: Finalizer')) {
      return 'Verified completion report: implementation, materialization, tests, and Goal Master acceptance are complete.';
    }
    return 'Unhandled dry loop slot.';
  }
}

class GoalMasterScenarioLLMSource implements ILLMSource {
  readonly prompts: string[] = [];

  constructor(private readonly scenario: 'accept-immediately' | 'reject-forever') {}

  async *stream(params: LLMSourceParams): AsyncIterable<InternalLLMChunk> {
    const prompt = lastUserPrompt(params.messages);
    this.prompts.push(prompt);
    yield { type: 'text_delta', delta: this.responseFor(prompt) };
    yield { type: 'done' };
  }

  private responseFor(prompt: string): string {
    if (prompt.includes('Slot: Orchestrator')) {
      return 'Orchestrator defined acceptance criteria and routes to implementation. route_to(implementer, start delivery)';
    }
    if (prompt.includes('Slot: Implementer')) {
      return 'Implementer delivered a concrete implementation plan and source changes.';
    }
    if (prompt.includes('Slot: Materializer')) {
      return 'Materializer produced concrete artifacts with write evidence.';
    }
    if (prompt.includes('Slot: Verifier')) {
      return 'Verifier confirmed read evidence and build output.';
    }
    if (prompt.includes('Slot: Tester')) {
      return 'Tester confirmed deploy artifact and no remaining weak points.';
    }
    if (prompt.includes('Slot: Goal Master')) {
      return this.scenario === 'accept-immediately'
        ? 'Goal Master accepts complete evidence. route_to(final-artifact, accepted)'
        : 'Goal Master rejects because evidence is still incomplete. route_to(implementer, continue)';
    }
    if (prompt.includes('Slot: Finalizer')) {
      return 'Verified completion report: Goal Guard accepted the implementation.';
    }
    return 'Unhandled dry loop slot.';
  }
}

class EvidenceProducingSubagentRuntime implements SubagentRuntimePort {
  readonly calls: Array<{ slot: string; objective: string }> = [];

  async runSubagent(request: RunSubagentRequest): Promise<RunSubagentResult> {
    const slot = slotIdFromObjective(request.objective);
    this.calls.push({ slot, objective: request.objective });
    const result = this.resultForSlot(slot, request);
    return {
      result,
      taskId: `task-${slot}`,
      childSessionId: request.childSessionId ?? `child-${slot}`,
      parentSessionId: request.parentSessionId,
      vfsMode: request.vfsMode,
      vfsSessionId: request.childSessionId ?? `child-${slot}`,
      copiedFiles: [],
      durationMs: 1,
    };
  }

  private resultForSlot(slot: string, request: RunSubagentRequest): string {
    if (slot === 'orchestrator') {
      return 'Orchestrator routes to implementation. route_to(implementer, start deterministic evidence path)';
    }
    if (slot === 'implementer') {
      return 'Implementer specifies evidence/proof.json and hands it to the materializer.';
    }
    if (slot === 'materializer') {
      emitToolResult(request, 'vfs_write', { filePath: 'evidence/proof.json', bytesWritten: 42 });
      return 'Materializer wrote evidence/proof.json with vfs_write evidence.';
    }
    if (slot === 'verifier') {
      emitToolResult(request, 'vfs_read', { filePath: 'evidence/proof.json', content: '{"ok":true}' });
      return 'Verifier read evidence/proof.json and confirmed content.';
    }
    if (slot === 'tester') {
      emitToolResult(request, 'vfs_read', { filePath: 'evidence/proof.json', content: '{"ok":true}' });
      return 'Tester independently read evidence/proof.json.';
    }
    if (slot === 'goal_master') {
      emitToolResult(request, 'vfs_read', { filePath: 'evidence/proof.json', content: '{"ok":true}' });
      return 'Goal Master accepts visible write/read evidence. route_to(final-artifact, accepted)';
    }
    if (slot === 'finalizer') {
      return 'Production evidence path accepted with vfs_write and vfs_read proof.';
    }
    return `Unhandled slot ${slot}.`;
  }
}

function slotIdFromObjective(objective: string): string {
  const match = objective.match(/^Slot:\s+(.+?)\s+\(/m);
  const label = match?.[1]?.trim().toLowerCase() ?? '';
  if (label.includes('goal master')) return 'goal_master';
  if (label.includes('verified completion artifact') || label.includes('finalizer')) return 'finalizer';
  return label.replace(/\s+/g, '_');
}

function emitToolResult(request: RunSubagentRequest, toolName: string, data: Record<string, unknown>): void {
  const callId = `call-${toolName}-${String(data['filePath'] ?? 'tool').replace(/[^\w-]/g, '-')}`;
  request.emit?.('tool:start', {
    callId,
    toolName,
    args: data,
    sessionId: request.childSessionId,
    agentRun: undefined as never,
  });
  request.emit?.('tool:result', {
    callId,
    toolName,
    status: 'success',
    data,
  } as never);
}

function lastUserPrompt(messages: ContextManagedLLMMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'user') {
      continue;
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
    return message.content
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join(' ')
      .trim();
  }
  return '';
}

function dryGoalMasterLoopSchema(): ArchitectureSchema {
  const baseSchema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop')!;
  return {
    ...baseSchema,
    id: 'dry-goal-master-delivery-loop',
    name: 'Dry Goal Master Delivery Loop',
    roleSlots: baseSchema.roleSlots.map((slot) => (
      slot.id === 'materializer' || slot.id === 'verifier'
        ? { ...slot, slotType: 'participant' as const }
        : slot
    )),
  };
}

class MockLLMSource implements ILLMSource {
  private readonly provider: MockLLMProvider;

  constructor(delay?: (ms: number) => Promise<void>) {
    this.provider = new MockLLMProvider(delay ? { delay } : undefined);
  }

  async *stream(params: LLMSourceParams): AsyncIterable<InternalLLMChunk> {
    const chunks: InternalLLMChunk[] = [];
    const toolCalls = await this.provider.streamChat(params.messages, params.tools, {
      sessionId: params.sessionId,
      messageId: params.messageId,
      abortSignal: params.abortSignal,
      onChunk: (chunk) => {
        if (chunk.delta && !chunk.thinking) {
          chunks.push({ type: 'text_delta', delta: chunk.delta });
        }
      },
    });
    for (const chunk of chunks) {
      yield chunk;
    }
    for (const toolCall of toolCalls) {
      yield { type: 'tool_call', callId: toolCall.id, name: toolCall.name, args: toolCall.args };
    }
    yield { type: 'done' };
  }
}

function createSessionStore(): {
  service: {
    createWithId: (id: string, dto: CreateSessionDto) => Promise<ChatSession>;
    getMessages: (sessionId: string) => Promise<ChatMessage[]>;
  };
} {
  return {
    service: {
      createWithId: vi.fn(async (id: string, dto: CreateSessionDto): Promise<ChatSession> => {
        const now = Date.now();
        return {
          id,
          personaId: dto.personaId,
          title: dto.title ?? 'New Chat',
          kind: dto.kind ?? 'chat',
          parentSessionId: dto.parentSessionId,
          parentTurnId: dto.parentTurnId,
          parentToolCallId: dto.parentToolCallId,
          createdAt: now,
          updatedAt: now,
        };
      }),
      getMessages: vi.fn(async (): Promise<ChatMessage[]> => []),
    },
  };
}
