import { BadRequestException, Logger } from '@nestjs/common';
import type { ArchitectureExecutionEvent, ArchitectureRouterOutput, ArchitectureRun, ArchitectureSchema, ChatMessage, ChatSession, CreateArchitectureRunDto, CreateSessionDto, LLMToolCall } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import type { SessionsService } from '../chat/sessions.service';
import type { SessionManagerService } from '../chat/session-manager.service';
import type { AuditLogEntry, AuditService } from '../chat/audit.service';
import { RuntimeAuditLogger } from '../chat/runtime-audit-logger.service';
import type { VFSService } from '../vfs/vfs.service';
import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { createArchitectureGraphEvents } from './architecture-graph-runtime';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import { createWorkflowError } from '../../common/utils/workflow-error.util';

describe('ArchitectureRuntimeService', () => {
  it('creates a deterministic completed run with chat branches, router, and final artifact events', async () => {
    const { service, executor, sessions } = createService();

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Choose the architecture for orchestration.',
      context: { priority: 'ship_mvp' },
    });

    expect(run.status).toBe('completed');
    expect(run.executionMode).toBe('session_branches');
    expect(run.prompt).toBe('Choose the architecture for orchestration.');
    expect(run.slotOverrides).toBeUndefined();
    expect(run.rootSessionId).toBe(`arch-${run.id}-root`);
    expect(Object.keys(run.branchSessionIds ?? {})).toEqual([
      'pragmatist',
      'innovator',
      'analyst',
      'user_advocate',
      'shadow',
    ]);
    expect(sessions.createWithId).toHaveBeenCalledTimes(6);
    expect(sessions.created[0]?.dto).toMatchObject({
      personaId: 'default',
      kind: 'chat',
    });
    expect(sessions.created.slice(1).map((entry) => entry.dto.kind)).toEqual([
      'subagent',
      'subagent',
      'subagent',
      'subagent',
      'subagent',
    ]);
    expect(sessions.created.find((entry) => entry.id === run.branchSessionIds?.['shadow'])?.dto.personaId).toBe('orchestrator');

    const events = service.getEvents(run.id);
    const semantic = semanticEvents(events);
    expect(semantic.map((event) => event.type)).toEqual([
      'run_created',
      'router_decision',
      'participant_output',
      'participant_output',
      'participant_output',
      'participant_output',
      'participant_output',
      'router_decision',
      'final_artifact',
    ]);
    expect(events.map((event) => event.type)).toContain('node_started');
    expect(events.map((event) => event.type)).toContain('node_completed');
    expect(events.map((event) => event.type)).toContain('agent_started');
    expect(semantic.find((event) => event.nodeId === 'parallel-deliberation')?.data).toMatchObject({
      selectedNodeIds: ['pragmatist', 'innovator', 'analyst', 'user-advocate', 'shadow'],
      convergeToNodeId: 'router',
    });
    expect(semantic.find((event) => event.nodeId === 'parallel-deliberation')?.route).toMatchObject({
      source: 'parallel',
      fromNodeId: 'parallel-deliberation',
      selectedNodeIds: ['pragmatist', 'innovator', 'analyst', 'user-advocate', 'shadow'],
      nextNodeId: 'pragmatist',
      convergeToNodeId: 'router',
      mode: 'fan_out_all',
    });
    expect(service.getGraph(run.id)?.nodes.find((node) => node.id === 'parallel-deliberation')?.eventIds.length).toBeGreaterThanOrEqual(1);
    expect(semantic.find((event) => event.roleSlotId === 'shadow')?.data).toMatchObject({
      branchSessionId: run.branchSessionIds?.['shadow'],
      personaId: 'orchestrator',
      sessionPersonaId: 'orchestrator',
      rootSessionId: run.rootSessionId,
      slotType: 'critic',
      executionMode: 'session_branches',
    });
    const routerEvent = semantic.find((event) => event.roleSlotId === 'router');
    expect(routerEvent?.message).toContain('Router ranked and merged');
    expect(routerEvent?.data).toMatchObject({
      incomingNodeIds: ['pragmatist', 'innovator', 'analyst', 'user-advocate', 'shadow'],
      nextNodeId: 'final-artifact',
      selectedNodeIds: ['final-artifact'],
    });
    expect(routerEvent?.route).toMatchObject({
      source: 'router',
      fromNodeId: 'router',
      selectedNodeIds: ['final-artifact'],
      nextNodeId: 'final-artifact',
      mode: 'rank_then_merge',
    });
    expect(routerEvent?.routerOutput).toMatchObject({
      selectedStrategy: 'final-artifact',
      nextAction: 'finalize',
      acceptedInputs: expect.arrayContaining([
        expect.objectContaining({ fromSlot: 'shadow' }),
      ]),
    });
    expect(semantic.at(-1)?.roleSlotId).toBe('finalizer');
    expect(executor.execute).toHaveBeenCalledTimes(5);
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'pragmatist' }),
    }));
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'innovator' }),
    }));
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'analyst' }),
    }));
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'user_advocate' }),
    }));
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'shadow' }),
    }));
    expect(executor.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'router' }),
    }));
    expect(executor.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'finalizer' }),
    }));
  });

  it('executes the seeded Five Minds Council with five participant branches and a synthesizer', async () => {
    const { service, executor, sessions } = createService();

    const run = await service.createRun({
      schemaId: 'five-minds-council',
      prompt: 'Smoke Five Minds Council.',
      context: { model: 'mimo-v2.5-pro' },
    });

    expect(run.status).toBe('completed');
    expect(run.rootSessionId).toBe(`arch-${run.id}-root`);
    expect(Object.keys(run.branchSessionIds ?? {})).toEqual([
      'pragmatist',
      'innovator',
      'analyst',
      'user_advocate',
      'devil_advocate',
    ]);
    expect(sessions.createWithId).toHaveBeenCalledTimes(6);
    expect(sessions.created.find((entry) => entry.id === run.branchSessionIds?.['devil_advocate'])?.dto.personaId).toBe('orchestrator');

    const events = service.getEvents(run.id);
    const semantic = semanticEvents(events);
    expect(semantic.find((event) => event.nodeId === 'five-minds-debate')?.data).toMatchObject({
      selectedNodeIds: ['pragmatist', 'innovator', 'analyst', 'user-advocate', 'devil-advocate'],
      convergeToNodeId: 'synthesizer',
    });
    expect(semantic.find((event) => event.roleSlotId === 'synthesizer')?.data).toMatchObject({
      incomingNodeIds: ['pragmatist', 'innovator', 'analyst', 'user-advocate', 'devil-advocate'],
      nextNodeId: 'final-artifact',
      selectedNodeIds: ['final-artifact'],
    });
    expect(service.getGraph(run.id)?.nodes.map((node) => node.id)).toEqual([
      'five-minds-debate',
      'pragmatist',
      'innovator',
      'analyst',
      'user-advocate',
      'devil-advocate',
      'synthesizer',
      'final-artifact',
    ]);
    expect(executor.execute).toHaveBeenCalledTimes(5);
    expect(executor.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'synthesizer' }),
    }));
  });

  it('persists standalone architecture projections into the root chat session', async () => {
    const { service, sessionManager } = createService();

    const run = await service.createRun({
      schemaId: 'five-minds-council',
      prompt: 'Show the architecture result in chat.',
    });

    expect(sessionManager.persistMessage).toHaveBeenCalled();
    const persistedMessages = sessionManager.persistMessage.mock.calls.map(([message]) => message as { sessionId: string; role: string; content: string });
    expect(persistedMessages.every((message) => message.sessionId === run.rootSessionId)).toBe(true);
    expect(persistedMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('### Finalizer'),
      }),
    ]));
  });

  it('falls back to the architecture root session when the AgentFlow parent session is synthetic', async () => {
    const { service, sessions, sessionManager } = createService();
    sessions.getMessages.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'architect-ui') {
        throw new Error('Session not found: architect-ui');
      }
      return [];
    });

    const run = await service.createRun({
      schemaId: 'five-minds-council',
      prompt: 'Show AgentFlow proof from Architect UI.',
      context: {
        parentSessionId: 'architect-ui',
        subAgentFlow: {
          flowId: 'goal_guard_delivery_loop',
          vfsMode: 'isolated',
          copyBack: false,
          returnMode: 'summary',
        },
      },
    });

    const persistedMessages = sessionManager.persistMessage.mock.calls.map(([message]) => message as { sessionId: string });
    expect(run.status).toBe('completed');
    expect(persistedMessages.length).toBeGreaterThan(0);
    expect(persistedMessages.every((message) => message.sessionId === run.rootSessionId)).toBe(true);
  });

  it('creates agent-flow root sessions for sub_agentflow architecture runs', async () => {
    const { service, sessions } = createService();

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Deliver with implementer and goal guard.',
      context: {
        parentSessionId: 'parent-chat',
        parentToolCallId: 'call-agentflow-root',
        subAgentFlow: {
          flowId: 'goal_guard_delivery_loop',
          vfsMode: 'isolated',
          copyBack: false,
          returnMode: 'summary',
        },
      },
    });

    expect(sessions.created.find((entry) => entry.id === run.rootSessionId)?.dto).toMatchObject({
      kind: 'agent-flow',
      parentSessionId: 'parent-chat',
      parentToolCallId: 'call-agentflow-root',
      runtimeContext: {
        runtimeKind: 'agent-flow-root',
        architectureContext: {
          architectureRunId: run.id,
          hostSessionId: 'parent-chat',
          historySessionId: 'parent-chat',
          sessionSurface: 'technical-node',
        },
      },
    });
    expect(sessions.created.find((entry) => entry.id === run.branchSessionIds?.['pragmatist'])?.dto).toMatchObject({
      parentSessionId: run.rootSessionId,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        parentSessionId: run.rootSessionId,
        architectureSlotId: 'pragmatist',
        architectureContext: {
          architectureRunId: run.id,
          roleSlotId: 'pragmatist',
          hostSessionId: 'parent-chat',
          historySessionId: 'parent-chat',
          sessionSurface: 'conversation-branch',
        },
      },
    });
  });

  it('inherits parent allowance context into nested architecture runs', async () => {
    const { service, sessions } = createService({
      sessionById: {
        'parent-chat': {
          id: 'parent-chat',
          personaId: 'orchestrator',
          title: 'Parent chat',
          kind: 'chat',
          runtimeContext: {
            runtimeKind: 'agent-flow-branch',
            architectureContext: {
              projectPath: 'C:\\Projekty\\FamilyQuest',
              executionCwd: 'C:\\Projekty\\FamilyQuest',
              launchAllowedToolNames: ['vfs_read', 'fs_read', 'fs_list'],
              allowArchitectureOrchestratorSubagents: true,
            },
          },
          createdAt: 1,
          updatedAt: 1,
        },
      },
    });

    const run = await service.createRun({
      schemaId: 'architecture_debate',
      prompt: 'Review the project.',
      executionMode: 'subagent_execution',
      context: {
        parentSessionId: 'parent-chat',
      },
    });

    expect(run.context).toMatchObject({
      parentSessionId: 'parent-chat',
      projectPath: 'C:\\Projekty\\FamilyQuest',
      executionCwd: 'C:\\Projekty\\FamilyQuest',
      launchAllowedToolNames: ['vfs_read', 'fs_read', 'fs_list'],
      allowArchitectureOrchestratorSubagents: true,
    });
    expect(sessions.get).toHaveBeenCalledWith('parent-chat');
  });

  it('does not infer local project scope from prompt text when explicit scope is absent', async () => {
    const { service } = createService();

    const run = await service.createRun({
      schemaId: 'architecture_debate',
      prompt: 'C:\\Projekty\\FamilyQuest oceń architekturę i użyj FS.',
      executionMode: 'subagent_execution',
      context: {
        parentSessionId: 'parent-chat',
      },
    });

    expect(run.context).toMatchObject({
      parentSessionId: 'parent-chat',
    });
    expect(run.context?.['projectPath']).toBeUndefined();
    expect(run.context?.['executionCwd']).toBeUndefined();
  });

  it('adds only enabled CLI agents to architecture runtime context', async () => {
    const { service, executor } = createService({
      cliConfigs: {
        copilot: { enabled: false },
        codex: { enabled: true, model: 'gpt-5.4-mini', architecturePreference: 'Use Codex for verification.' },
        gemini: { enabled: false },
        claude: { enabled: false },
      },
    });

    await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Plan with configured CLI backends.',
      executionMode: 'subagent_execution',
    });

    const context = vi.mocked(executor.execute).mock.calls[0]?.[0].run.context;
    expect(context).toMatchObject({
      availableCliAgents: ['codex'],
      cliAgentToolPreferences: {
        codex: {
          model: 'gpt-5.4-mini',
          preference: 'Use Codex for verification.',
        },
      },
    });
  });

  it('uses routerPolicy to route rejected fallback paths into typed research follow-up', async () => {
    const { service } = createService();
    const schema = routerPolicySchema({
      mustAddressCriticFindings: true,
      canReturnNeedsMoreResearch: true,
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Decide with competing route candidates.',
      schema,
    });

    const routerEvent = semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'router');
    expect(routerEvent?.routerOutput).toMatchObject({
      selectedStrategy: 'research',
      targetNodeId: 'research',
      rejectedInputs: [
        expect.objectContaining({ fromSlot: 'artifact' }),
      ],
      unresolvedConflicts: [
        expect.stringContaining('Research'),
      ],
      risks: [
        expect.objectContaining({ sourceSlot: 'shadow' }),
      ],
      nextAction: 'run_more_research',
    });
    expect(routerEvent?.route).toMatchObject({
      selectedNodeIds: ['research'],
      rejectedNodeIds: ['artifact'],
      nextNodeId: 'research',
    });
    expect(routerEvent?.routerOutput?.confidence).toBeLessThan(0.55);
  });

  it('uses routerPolicy to ask the human when fallback routing has conflicts but research escalation is disabled', async () => {
    const { service } = createService();
    const schema = routerPolicySchema({
      mustAddressCriticFindings: true,
      canReturnNeedsMoreResearch: false,
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Decide with competing route candidates and no research escape hatch.',
      schema,
    });

    const routerEvent = semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'router');
    expect(routerEvent?.routerOutput).toMatchObject({
      selectedStrategy: 'artifact',
      nextAction: 'ask_human',
      unresolvedConflicts: [
        expect.stringContaining('Research'),
      ],
    });
  });

  it('turns typed ask_human router decisions into a human gate instead of finalizing by fallback route', async () => {
    const { service } = createService();
    const schema = routerPolicySchema({
      mustAddressCriticFindings: true,
      canReturnNeedsMoreResearch: false,
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Pause for a human when routing conflicts remain unresolved.',
      schema,
    });
    const events = service.getEvents(run.id);
    const humanGate = events.find((event) => event.type === 'human_gate');

    expect(humanGate).toMatchObject({
      nodeId: 'router',
      reasonCode: 'runtime_pause',
      runtimeDecision: {
        status: 'waiting_on_orchestrator',
        reasonCode: 'runtime_pause',
      },
    });
    expect(events.some((event) => event.type === 'final_artifact')).toBe(false);
    expect(run.status).toBe('running');
  });

  it('turns router-role structured ask_human output into a human gate instead of finalizing by fallback route', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      const baseData = {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      };
      if (slot.slotType !== 'router') {
        return {
          message: `${slot.label} branch prepared for: ${run.prompt}`,
          data: baseData,
        };
      }
      const routerOutput: ArchitectureRouterOutput = {
        selectedStrategy: 'human-review',
        mergedDecision: 'Human approval is required before finalization.',
        acceptedInputs: [],
        rejectedInputs: [],
        unresolvedConflicts: ['Research and critique disagree about release readiness.'],
        risks: [],
        confidence: 0.42,
        nextAction: 'ask_human',
      };
      return {
        message: 'Human approval is required before finalization.',
        data: {
          ...baseData,
          routerOutput,
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Pause the subagent router for human approval.',
      executionMode: 'subagent_execution',
    });
    const events = service.getEvents(run.id);
    const humanGate = events.find((event) => event.type === 'human_gate' && event.nodeId === 'router');

    expect(humanGate).toMatchObject({
      roleSlotId: 'router',
      reasonCode: 'runtime_pause',
      runtimeDecision: {
        status: 'waiting_on_orchestrator',
        reasonCode: 'runtime_pause',
      },
    });
    expect(events.some((event) => event.type === 'final_artifact')).toBe(false);
    expect(run.status).toBe('running');
  });

  it('turns router-role structured rerun_with_different_personas output into a runtime pause', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      const baseData = {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      };
      if (slot.slotType !== 'router') {
        return {
          message: `${slot.label} branch prepared for: ${run.prompt}`,
          data: baseData,
        };
      }
      const routerOutput: ArchitectureRouterOutput = {
        selectedStrategy: 'persona-rerun',
        mergedDecision: 'A different persona set is required before finalization.',
        acceptedInputs: [],
        rejectedInputs: [],
        unresolvedConflicts: ['The current persona set did not cover release risk.'],
        risks: [],
        confidence: 0.39,
        nextAction: 'rerun_with_different_personas',
      };
      return {
        message: 'A different persona set is required before finalization.',
        data: {
          ...baseData,
          routerOutput,
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Pause for a persona rerun instead of finalizing.',
      executionMode: 'subagent_execution',
    });
    const events = service.getEvents(run.id);
    const humanGate = events.find((event) => event.type === 'human_gate' && event.nodeId === 'router');

    expect(humanGate).toMatchObject({
      roleSlotId: 'router',
      reasonCode: 'runtime_pause',
      routerOutput: {
        nextAction: 'rerun_with_different_personas',
      },
      runtimeDecision: {
        status: 'waiting_on_orchestrator',
        reasonCode: 'runtime_pause',
      },
      data: {
        nextAction: 'rerun_with_different_personas',
      },
    });
    expect(events.some((event) => event.type === 'final_artifact')).toBe(false);
    expect(run.status).toBe('running');
  });

  it('routes router-role structured run_more_research output through its typed target node', async () => {
    const { service, executor } = createService();
    const schema = routerPolicySchema({
      mustAddressCriticFindings: true,
      canReturnNeedsMoreResearch: true,
    });
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      const baseData = {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      };
      if (slot.slotType !== 'router') {
        return {
          message: `${slot.label} branch prepared for: ${run.prompt}`,
          data: baseData,
        };
      }
      const routerOutput: ArchitectureRouterOutput = {
        selectedStrategy: 'research',
        targetNodeId: 'research',
        mergedDecision: 'Run a research follow-up before finalization.',
        acceptedInputs: [],
        rejectedInputs: [{ fromSlot: 'artifact', insight: 'Artifact needs stronger evidence.' }],
        unresolvedConflicts: ['Release readiness requires more evidence.'],
        risks: [],
        confidence: 0.48,
        nextAction: 'run_more_research',
      };
      return {
        message: 'Run a research follow-up before finalization.',
        data: {
          ...baseData,
          routerOutput,
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Route the subagent router toward more research.',
      executionMode: 'subagent_execution',
      schema,
    });
    const routerEvent = semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'router');

    expect(routerEvent?.routerOutput).toMatchObject({
      nextAction: 'run_more_research',
      selectedStrategy: 'research',
      targetNodeId: 'research',
    });
    expect(routerEvent?.route).toMatchObject({
      selectedNodeIds: ['research'],
      rejectedNodeIds: ['artifact'],
      nextNodeId: 'research',
    });
  });

  it('returns run, graph, and chat projections for a created run', async () => {
    const { service } = createService();
    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Decide whether to persist runs now.',
      slotOverrides: { router: 'persona.security_router' },
    });

    expect(service.findRun(run.id)).toEqual(run);
    expect(run.slotOverrides).toEqual({ router: 'persona.security_router' });

    const graph = service.getGraph(run.id);
    if (!graph) throw new Error('Expected graph projection');
    expect(graph.runId).toBe(run.id);
    expect(graph.nodes.find((node) => node.id === 'router')?.status).toBe('completed');
    expect(graph.nodes.find((node) => node.id === 'final-artifact')?.eventIds.length).toBeGreaterThanOrEqual(1);

    const chat = service.getChat(run.id);
    if (!chat) throw new Error('Expected chat projection');
    expect(chat.messages.map((message) => message.speaker)).toEqual([
      'system',
      'router',
      'participant',
      'participant',
      'participant',
      'participant',
      'participant',
      'router',
      'finalizer',
    ]);
  });

  it('starts an async run before graph execution completes and exposes live events', async () => {
    const { service, executor, audit } = createService();
    const resolvers: Array<(value: Awaited<ReturnType<ArchitectureRoleExecutor['execute']>>) => void> = [];
    vi.mocked(executor.execute).mockImplementation(({ branchSessionId, personaId, run, slot }) => new Promise((resolve) => {
      resolvers.push(resolve);
      if (resolvers.length > 1) {
        resolve({
          message: `${slot.label} branch prepared for: ${run.prompt}`,
          data: {
            branchSessionId,
            personaId,
            sessionPersonaId: personaId,
            rootSessionId: run.rootSessionId,
            slotType: slot.slotType,
            executionMode: run.executionMode,
          },
        });
      }
    }));

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Show live architecture progress.',
    });

    expect(run.status).toBe('running');
    expect(service.findRun(run.id)).toBe(run);
    await waitUntil(() => service.getEvents(run.id).some((event) => event.type === 'agent_started'));
    await waitUntil(() => audit.log.mock.calls.some(([entry]) => (
      entry.type === 'architecture_event'
      && entry.data?.['architectureRunId'] === run.id
      && entry.data?.['eventType'] === 'agent_started'
    )));
    expect(service.getGraph(run.id)?.nodes.some((node) => node.status === 'completed')).toBe(true);

    resolvers[0]?.({
      message: `Pragmatist branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId: run.branchSessionIds?.['pragmatist'] ?? 'missing',
        personaId: 'dev',
        sessionPersonaId: 'dev',
        rootSessionId: run.rootSessionId,
        slotType: 'participant',
        executionMode: run.executionMode,
      },
    });
    await waitUntil(() => service.findRun(run.id)?.status === 'completed');
    const eventAuditRows = audit.log.mock.calls.filter(([entry]) => (
      entry.type === 'architecture_event'
      && entry.data?.['architectureRunId'] === run.id
    ));
    expect(eventAuditRows).toHaveLength(service.getEvents(run.id).length);
    expect(service.getChat(run.id)?.messages.at(-1)?.speaker).toBe('finalizer');
  });

  it('keeps a stopped async run cancelled when a late role executor rejection arrives', async () => {
    const { service, executor } = createService();
    let rejectFirstBranch: ((error: Error) => void) | undefined;
    vi.mocked(executor.execute).mockImplementation(({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'pragmatist') {
        return new Promise((_resolve, reject) => {
          rejectFirstBranch = reject;
        });
      }
      return Promise.resolve({
        message: `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
        },
      });
    });

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Stop before late branch failure.',
    });
    await waitUntil(() => service.getEvents(run.id).some((event) => event.type === 'agent_started'));

    await service.stopRun(run.id);
    rejectFirstBranch?.(new Error('late branch failure after stop'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.findRun(run.id)?.status).toBe('cancelled');
    expect(service.getEvents(run.id).at(-1)).toMatchObject({
      type: 'run_stopped',
      message: 'Architecture run stopped by user.',
    });
  });

  it('stops active runs by root or branch session id for chat stop integration', async () => {
    const { service, executor } = createService();
    let rejectFirstBranch: ((error: Error) => void) | undefined;
    vi.mocked(executor.execute).mockImplementation(({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'pragmatist') {
        return new Promise((_resolve, reject) => {
          rejectFirstBranch = reject;
        });
      }
      return Promise.resolve({
        message: `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
        },
      });
    });

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Stop active architecture workflow from chat.',
      context: { parentSessionId: 'host-session' },
    });
    await waitUntil(() => service.getEvents(run.id).some((event) => event.type === 'agent_started'));

    const stoppedRunIds = await service.stopRunsForSessions(['host-session', run.rootSessionId ?? 'missing']);
    rejectFirstBranch?.(new Error('late branch failure after session stop'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stoppedRunIds).toEqual([run.id]);
    expect(service.findRun(run.id)).toMatchObject({
      id: run.id,
      status: 'cancelled',
      reasonCode: 'user_stop',
    });
    expect(service.getEvents(run.id).at(-1)).toMatchObject({
      type: 'run_stopped',
      reasonCode: 'user_stop',
    });
  });

  it('persists an async run start projection to parent chat before graph execution completes', async () => {
    const { service, executor, sessionManager } = createService();
    const resolvers: Array<(value: Awaited<ReturnType<ArchitectureRoleExecutor['execute']>>) => void> = [];
    vi.mocked(executor.execute).mockImplementation(({ branchSessionId, personaId, run, slot }) => new Promise((resolve) => {
      resolvers.push(resolve);
      if (resolvers.length > 1) {
        resolve({
          message: `${slot.label} branch prepared for: ${run.prompt}`,
          data: {
            branchSessionId,
            personaId,
            sessionPersonaId: personaId,
            rootSessionId: run.rootSessionId,
            slotType: slot.slotType,
            executionMode: run.executionMode,
          },
        });
      }
    }));

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Show this architecture run in parent chat immediately.',
      context: { parentSessionId: 'parent-chat-start' },
    });

    expect(sessionManager.persistMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: `architecture:${run.id}:user`,
      sessionId: 'parent-chat-start',
      role: 'user',
      content: 'Show this architecture run in parent chat immediately.',
    }));
    expect(service.findRun(run.id)?.status).toBe('running');

    resolvers[0]?.({
      message: `Pragmatist branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId: run.branchSessionIds?.['pragmatist'] ?? 'missing',
        personaId: 'dev',
        sessionPersonaId: 'dev',
        rootSessionId: run.rootSessionId,
        slotType: 'participant',
        executionMode: run.executionMode,
      },
    });
  });

  it('refreshes async run updatedAt when live graph events arrive', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const { service, executor } = createService();
    const resolvers: Array<(value: Awaited<ReturnType<ArchitectureRoleExecutor['execute']>>) => void> = [];
    vi.mocked(executor.execute).mockImplementation(({ branchSessionId, personaId, run, slot }) => new Promise((resolve) => {
      resolvers.push(resolve);
      if (resolvers.length > 1) {
        resolve({
          message: `${slot.label} branch prepared for: ${run.prompt}`,
          data: {
            branchSessionId,
            personaId,
            sessionPersonaId: personaId,
            rootSessionId: run.rootSessionId,
            slotType: slot.slotType,
            executionMode: run.executionMode,
          },
        });
      }
    }));

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Track live progress timestamps.',
    });
    const initialUpdatedAt = run.updatedAt;

    nowSpy.mockReturnValue(5_000);
    await waitUntil(() => service.getEvents(run.id).some((event) => event.type === 'agent_started'));

    expect(service.findRun(run.id)?.updatedAt).toBeGreaterThan(initialUpdatedAt);
    resolvers[0]?.({
      message: `Pragmatist branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId: run.branchSessionIds?.['pragmatist'] ?? 'missing',
        personaId: 'dev',
        sessionPersonaId: 'dev',
        rootSessionId: run.rootSessionId,
        slotType: 'participant',
        executionMode: run.executionMode,
      },
    });
    nowSpy.mockRestore();
  });

  it('persists async architecture failures to parent chat and audit timeline', async () => {
    const { service, executor, sessionManager, audit } = createService();
    vi.mocked(executor.execute).mockRejectedValue(new Error('provider rejected credentials'));

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Verify failed runs are visible.',
      context: { parentSessionId: 'parent-chat' },
    });

    await waitUntil(() => service.findRun(run.id)?.status === 'failed');

    expect(service.getEvents(run.id).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'UNKNOWN',
      failure: {
        code: 'UNKNOWN',
        retryable: false,
        message: 'provider rejected credentials',
      },
      data: {
        errorCode: 'UNKNOWN',
        failure: {
          code: 'UNKNOWN',
          retryable: false,
          message: 'provider rejected credentials',
        },
      },
    });
    expect(service.getChat(run.id)?.messages.at(-1)).toMatchObject({
      speaker: 'router',
      content: 'Architecture run failed.',
    });
    expect(sessionManager.persistMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-chat',
      role: 'assistant',
      content: expect.stringContaining('Architecture run failed.'),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-chat',
      type: 'error',
      label: expect.stringContaining(`architecture:error:strategic-decision-council:${run.id}`),
      data: expect.objectContaining({
        kind: 'architecture_error',
        architectureRunId: run.id,
        errorCode: 'UNKNOWN',
        failure: expect.objectContaining({
          code: 'UNKNOWN',
          retryable: false,
          message: 'provider rejected credentials',
        }),
        errorMessage: 'provider rejected credentials',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-chat',
      type: 'architecture_event',
      label: expect.stringContaining('architecture_event:router_decision:runtime'),
      data: expect.objectContaining({
        kind: 'architecture_event',
        architectureRunId: run.id,
        eventType: 'router_decision',
        messagePreview: 'Architecture run failed.',
      }),
    }));
  });

  it('degrades a single rate-limited branch without failing the whole architecture run', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'innovator') {
        throw createWorkflowError('RATE_LIMITED', 'provider throttled branch execution', {
          source: 'llm-provider',
        });
      }
      return {
        message: `${slot.label} branch completed for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'five-minds-council',
      prompt: 'Continue after one rate-limited branch.',
      executionMode: 'subagent_execution',
    });

    expect(run.status).toBe('completed');
    expect(service.getEvents(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'participant_output',
        nodeId: 'innovator',
        data: expect.objectContaining({
          runtimeGuard: 'recoverable_node_error',
          errorCode: 'RATE_LIMITED',
          failure: expect.objectContaining({
            code: 'RATE_LIMITED',
            retryable: true,
          }),
          incompleteReason: 'Recoverable runtime error prevented this node from producing a final answer.',
        }),
      }),
      expect.objectContaining({
        type: 'final_artifact',
      }),
    ]));
  });

  it('routes a recoverable Goal Master error back to implementation instead of finalizing', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop')!;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'goal_master') {
        throw createWorkflowError('RATE_LIMITED', 'provider throttled goal master', {
          source: 'llm-provider',
        });
      }
      return {
        message: `${slot.label} branch completed for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          toolEvidence: toolEvidenceForSlot(slot.id),
        },
      };
    });

    const run = await service.createRun({
      schemaId: baseSchema.id,
      schema: {
        ...baseSchema,
      },
      prompt: 'Do not finalize when Goal Master is rate limited.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 16,
      },
    });
    const events = service.getEvents(run.id);
    const goalDecision = semanticEvents(events).find((event) => event.nodeId === 'goal-master');

    expect(goalDecision).toMatchObject({
      type: 'router_decision',
      route: expect.objectContaining({
        source: 'runtime_fallback',
        selectedNodeIds: ['implementer'],
        rejectedNodeIds: ['final-artifact'],
        nextNodeId: 'implementer',
      }),
      data: expect.objectContaining({
        runtimeGuard: 'recoverable_node_error',
        errorCode: 'RATE_LIMITED',
      }),
    });
    expect(events.some((event) => event.type === 'final_artifact')).toBe(false);
  });

  it('synthesizes incoming evidence when a finalizer hits a recoverable provider error', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => ['pragmatist', 'finalizer'].includes(slot.id));
    const schema: ArchitectureSchema = {
      ...baseSchema,
      id: 'recoverable-finalizer',
      name: 'Recoverable Finalizer',
      roleSlots,
      nodes: [
        { id: 'auditor', label: 'Auditor', kind: 'role', roleSlotId: 'pragmatist' },
        { id: 'artifact', label: 'Decision Artifact', kind: 'artifact', roleSlotId: 'finalizer', behavior: { mode: 'finalize' } },
      ],
      edges: [
        { id: 'auditor-artifact', fromNodeId: 'auditor', toNodeId: 'artifact' },
      ],
    };
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'finalizer') {
        throw createWorkflowError('RATE_LIMITED', 'provider throttled finalizer', {
          source: 'llm-provider',
        });
      }
      return {
        message: 'Auditor found README.md and MainMenu.tsx evidence.',
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Synthesize even when finalizer is rate limited.',
      executionMode: 'subagent_execution',
      schema,
    });
    const finalEvent = service.getEvents(run.id).find((event) => event.type === 'final_artifact');

    expect(run.status).toBe('completed');
    expect(finalEvent?.message).toContain('Decision Artifact degraded after recoverable runtime error');
    expect(finalEvent?.message).toContain('From pragmatist:');
    expect(finalEvent?.message).toContain('README.md and MainMenu.tsx evidence');
  });

  it('keeps failed async architecture runs observable when parent failure projection persistence fails', async () => {
    const { service, executor, sessionManager, audit } = createService();
    vi.mocked(executor.execute).mockRejectedValue(new Error('provider rejected credentials'));
    vi.mocked(sessionManager.persistMessage).mockRejectedValue(new Error('parent write failed'));

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Verify failed runs survive parent projection errors.',
      context: { parentSessionId: 'parent-chat' },
    });

    await waitUntil(() => service.findRun(run.id)?.status === 'failed');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.findRun(run.id)?.status).toBe('failed');
    expect(service.findRun(run.id)).toMatchObject({
      errorCode: 'UNKNOWN',
      failure: {
        code: 'UNKNOWN',
        retryable: false,
        message: 'provider rejected credentials',
      },
    });
    expect(service.getEvents(run.id).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'UNKNOWN',
      failure: {
        code: 'UNKNOWN',
        retryable: false,
        message: 'provider rejected credentials',
      },
      data: {
        errorCode: 'UNKNOWN',
        failure: {
          code: 'UNKNOWN',
          retryable: false,
          message: 'provider rejected credentials',
        },
      },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'parent-chat',
      type: 'error',
      label: expect.stringContaining(`architecture:error:strategic-decision-council:${run.id}`),
    }));
  });

  it('persists typed node and run failures for provider structured-output errors', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockRejectedValue(Object.assign(new Error('provider wording changed'), {
      code: 'LLM_BAD_STRUCTURED_OUTPUT',
    }));

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Verify structured output failures are typed.',
      context: { parentSessionId: 'parent-chat' },
    });

    await waitUntil(() => service.findRun(run.id)?.status === 'failed');

    expect(service.findRun(run.id)).toMatchObject({
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: {
        code: 'CONTRACT_VIOLATION',
        source: 'llm-provider',
        retryable: false,
        message: 'provider wording changed',
      },
    });
    expect(service.getEvents(run.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'node_failed',
        nodeId: expect.any(String),
        status: 'failed',
        errorCode: 'CONTRACT_VIOLATION',
      }),
      expect.objectContaining({
        type: 'router_decision',
        message: 'Architecture run failed.',
        status: 'failed',
        errorCode: 'CONTRACT_VIOLATION',
      }),
    ]));
    expect(service.getGraph(run.id)?.nodes.some((node) => node.status === 'failed')).toBe(true);
  });

  it('does not reclassify a completed async run when parent chat persistence fails', async () => {
    const { service, sessionManager, audit } = createService();
    vi.mocked(sessionManager.persistMessage).mockRejectedValue(new Error('parent write failed'));

    const run = await service.createRunAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Complete even if parent projection persistence fails.',
      context: { parentSessionId: 'parent-chat' },
    });

    await waitUntil(() => service.findRun(run.id)?.status === 'completed');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(service.findRun(run.id)?.status).toBe('completed');
    expect(semanticEvents(service.getEvents(run.id)).at(-1)?.type).toBe('final_artifact');
    expect(audit.log).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      label: expect.stringContaining(`architecture:error:strategic-decision-council:${run.id}`),
    }));
  });

  it('marks async runs failed when finalization is blocked by an unresolved CLI child', async () => {
    const { service, executor, audit } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master incorrectly accepts delegated CLI proof. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer delegated host writes to a CLI child that is still running.'
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-async-finalizer-block', 'running') }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRunAsync({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Async finalizer must not accept unresolved CLI child.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });

    await waitUntil(() => service.findRun(run.id)?.status === 'failed');

    expect(service.findRun(run.id)?.status).toBe('failed');
    expect(service.getEvents(run.id).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'UNKNOWN',
      data: {
        errorCode: 'UNKNOWN',
        failure: expect.objectContaining({
          code: 'UNKNOWN',
          retryable: false,
          message: expect.stringContaining('Architecture finalization blocked: CLI child implementation is incomplete'),
        }),
      },
    });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      label: expect.stringContaining(`architecture:error:goal-master-delivery-loop:${run.id}`),
    }));
  });

  it('follows a linear agent router graph into the flat chat projection', async () => {
    const { service, executor, audit } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => [
      'pragmatist',
      'innovator',
      'router',
      'finalizer',
    ].includes(slot.id));
    const linearSchema = {
      ...baseSchema,
      id: 'linear-router-chain',
      name: 'Linear Router Chain',
      roleSlots,
      nodes: [
        { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
        {
          id: 'router-1',
          label: 'Router 1',
          kind: 'router' as const,
          roleSlotId: 'router',
          behavior: { mode: 'choose_one' as const },
        },
        { id: 'agent-2', label: 'Agent 2', kind: 'role' as const, roleSlotId: 'innovator' },
        {
          id: 'router-2',
          label: 'Router 2',
          kind: 'router' as const,
          roleSlotId: 'router',
          behavior: { mode: 'rank_then_merge' as const },
        },
        {
          id: 'artifact',
          label: 'Decision Artifact',
          kind: 'artifact' as const,
          roleSlotId: 'finalizer',
          behavior: { mode: 'finalize' as const },
        },
      ],
      edges: [
        { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
        { id: 'router-1-agent-2', fromNodeId: 'router-1', toNodeId: 'agent-2' },
        { id: 'agent-2-router-2', fromNodeId: 'agent-2', toNodeId: 'router-2' },
        { id: 'router-2-artifact', fromNodeId: 'router-2', toNodeId: 'artifact' },
      ],
    };

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Route this as a chain.',
      schema: linearSchema,
    });

    expect(semanticEvents(service.getEvents(run.id)).map((event) => event.nodeId)).toEqual([
      undefined,
      'agent-1',
      'router-1',
      'agent-2',
      'router-2',
      'artifact',
    ]);
    expect(semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'router-1')?.data).toMatchObject({
      nextNodeId: 'agent-2',
      selectedNodeIds: ['agent-2'],
    });
    expect(service.getChat(run.id)?.messages.map((message) => message.speaker)).toEqual([
      'system',
      'participant',
      'router',
      'participant',
      'router',
      'finalizer',
    ]);
    expect(service.getChat(run.id)?.messages.find((message) =>
      message.route?.source === 'router'
      && message.route.selectedNodeIds.includes('agent-2'))?.route).toMatchObject({
      source: 'router',
      selectedNodeIds: ['agent-2'],
    });
    expect(service.getGraph(run.id)?.routeHops).toEqual([
      expect.objectContaining({ source: 'runtime_fallback', fromNodeId: 'agent-1', toNodeId: 'router-1' }),
      expect.objectContaining({ source: 'router', fromNodeId: 'router-1', toNodeId: 'agent-2' }),
      expect.objectContaining({ source: 'runtime_fallback', fromNodeId: 'agent-2', toNodeId: 'router-2' }),
      expect.objectContaining({ source: 'router', fromNodeId: 'router-2', toNodeId: 'artifact' }),
    ]);
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(executor.execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      slot: expect.objectContaining({ id: 'pragmatist' }),
    }));
    expect(executor.execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      slot: expect.objectContaining({ id: 'innovator' }),
    }));
  });

  it('lets an agent output route_to bypass an unused fallback router', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => [
      'pragmatist',
      'innovator',
      'router',
      'finalizer',
    ].includes(slot.id));
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'pragmatist' ? routerData('agent-2', 'Send this to Agent 2.') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Let the first agent choose the next node.',
      schema: {
        ...baseSchema,
        id: 'agent-directed-routing',
        name: 'Agent Directed Routing',
        roleSlots,
        nodes: [
          { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
          {
            id: 'fallback-router',
            label: 'Fallback Router',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'choose_one' as const },
          },
          { id: 'agent-2', label: 'Agent 2', kind: 'role' as const, roleSlotId: 'innovator' },
          {
            id: 'artifact',
            label: 'Decision Artifact',
            kind: 'artifact' as const,
            roleSlotId: 'finalizer',
            behavior: { mode: 'finalize' as const },
          },
        ],
        edges: [
          { id: 'agent-1-fallback-router', fromNodeId: 'agent-1', toNodeId: 'fallback-router' },
          { id: 'agent-1-agent-2', fromNodeId: 'agent-1', toNodeId: 'agent-2' },
          { id: 'fallback-router-artifact', fromNodeId: 'fallback-router', toNodeId: 'artifact' },
          { id: 'agent-2-artifact', fromNodeId: 'agent-2', toNodeId: 'artifact' },
        ],
      },
    });

    expect(semanticEvents(service.getEvents(run.id)).map((event) => event.nodeId)).toEqual([
      undefined,
      'agent-1',
      'agent-2',
      'artifact',
    ]);
    expect(semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'agent-1')?.data).toMatchObject({
      selectedNodeIds: ['agent-2'],
      routerOutput: expect.objectContaining({
        targetNodeId: 'agent-2',
        response: 'Send this to Agent 2.',
      }),
    });
    expect(semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'agent-1')?.route).toMatchObject({
      source: 'agent',
      fromNodeId: 'agent-1',
      selectedNodeIds: ['agent-2'],
      rejectedNodeIds: ['fallback-router'],
      nextNodeId: 'agent-2',
      response: 'Send this to Agent 2.',
    });
    expect(service.getGraph(run.id)?.nodes.find((node) => node.id === 'fallback-router')?.status).toBe('pending');
    expect(service.getGraph(run.id)?.routeHops).toEqual([
      expect.objectContaining({ source: 'agent', fromNodeId: 'agent-1', toNodeId: 'agent-2' }),
      expect.objectContaining({ source: 'runtime_fallback', fromNodeId: 'agent-2', toNodeId: 'artifact' }),
    ]);
  });

  it('allows explicit route_to loops and stops by graph routing instead of one-shot completion', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => [
      'pragmatist',
      'innovator',
      'router',
      'finalizer',
    ].includes(slot.id));
    let router2Runs = 0;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => {
      const routeData = node?.id === 'router-2'
        ? routerData(router2Runs++ === 0 ? 'agent-1' : 'artifact', 'Router 2 selected the next graph node.')
        : {};
      return {
        message: `${slot.label} response for ${node?.id ?? 'unknown'}`,
        data: {
          branchSessionId,
          personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...routeData,
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Loop once before finalizing.',
      executionMode: 'subagent_execution',
      schema: {
        ...baseSchema,
        id: 'looping-router-chain',
        name: 'Looping Router Chain',
        roleSlots,
        nodes: [
          { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
          {
            id: 'router-1',
            label: 'Router 1',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'choose_one' as const },
          },
          { id: 'agent-2', label: 'Agent 2', kind: 'role' as const, roleSlotId: 'innovator' },
          {
            id: 'router-2',
            label: 'Router 2',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'choose_one' as const },
          },
          {
            id: 'artifact',
            label: 'Decision Artifact',
            kind: 'artifact' as const,
            roleSlotId: 'finalizer',
            behavior: { mode: 'finalize' as const },
          },
        ],
        edges: [
          { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
          { id: 'router-1-agent-2', fromNodeId: 'router-1', toNodeId: 'agent-2' },
          { id: 'agent-2-router-2', fromNodeId: 'agent-2', toNodeId: 'router-2' },
          { id: 'router-2-agent-1', fromNodeId: 'router-2', toNodeId: 'agent-1' },
          { id: 'router-2-artifact', fromNodeId: 'router-2', toNodeId: 'artifact' },
        ],
      },
    });

    expect(semanticEvents(service.getEvents(run.id)).map((event) => event.nodeId)).toEqual([
      undefined,
      'agent-1',
      'router-1',
      'agent-2',
      'router-2',
      'agent-1',
      'router-1',
      'agent-2',
      'router-2',
      'artifact',
    ]);
    expect(service.getGraph(run.id)?.routeHops).toEqual([
      expect.objectContaining({ fromNodeId: 'agent-1', toNodeId: 'router-1' }),
      expect.objectContaining({ fromNodeId: 'router-1', toNodeId: 'agent-2' }),
      expect.objectContaining({ fromNodeId: 'agent-2', toNodeId: 'router-2' }),
      expect.objectContaining({ source: 'agent', fromNodeId: 'router-2', toNodeId: 'agent-1' }),
      expect.objectContaining({ fromNodeId: 'agent-1', toNodeId: 'router-1' }),
      expect.objectContaining({ fromNodeId: 'router-1', toNodeId: 'agent-2' }),
      expect.objectContaining({ fromNodeId: 'agent-2', toNodeId: 'router-2' }),
      expect.objectContaining({ source: 'agent', fromNodeId: 'router-2', toNodeId: 'artifact' }),
    ]);
    expect(executor.execute).toHaveBeenCalledTimes(9);
  });

  it('starts fan_out_all role branches as a parallel batch before the downstream router runs', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => [
      'pragmatist',
      'innovator',
      'router',
      'finalizer',
    ].includes(slot.id));
    const releases = new Map<string, () => void>();
    const startedSlots: string[] = [];
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => {
      startedSlots.push(slot.id);
      if (slot.id === 'router') {
        expect(startedSlots).toEqual(['pragmatist', 'innovator', 'router']);
      }
      if (slot.id === 'pragmatist' || slot.id === 'innovator') {
        await new Promise<void>((resolve) => releases.set(slot.id, resolve));
      }
      return {
        message: `${slot.label} response for ${node?.id ?? 'unknown'}`,
        data: {
          branchSessionId,
          personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        },
      };
    });

    const runPromise = service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run branches in parallel before routing.',
      executionMode: 'subagent_execution',
      schema: {
        ...baseSchema,
        id: 'parallel-batch-routing',
        name: 'Parallel Batch Routing',
        roleSlots,
        nodes: [
          {
            id: 'parallel',
            label: 'Parallel',
            kind: 'parallel' as const,
            behavior: { mode: 'fan_out_all' as const },
          },
          { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
          { id: 'agent-2', label: 'Agent 2', kind: 'role' as const, roleSlotId: 'innovator' },
          {
            id: 'router',
            label: 'Router',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'rank_then_merge' as const },
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
          { id: 'parallel-agent-1', fromNodeId: 'parallel', toNodeId: 'agent-1' },
          { id: 'parallel-agent-2', fromNodeId: 'parallel', toNodeId: 'agent-2' },
          { id: 'agent-1-router', fromNodeId: 'agent-1', toNodeId: 'router' },
          { id: 'agent-2-router', fromNodeId: 'agent-2', toNodeId: 'router' },
          { id: 'router-artifact', fromNodeId: 'router', toNodeId: 'artifact' },
        ],
      },
    });

    try {
      await waitUntil(() => startedSlots.includes('pragmatist'));
      await waitUntil(() => startedSlots.includes('innovator'));
      expect(startedSlots).toEqual(['pragmatist', 'innovator']);
    } finally {
      releases.get('pragmatist')?.();
      releases.get('innovator')?.();
    }

    const run = await runPromise;
    const routerEvent = semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'router');
    expect(routerEvent?.data).toMatchObject({
      incomingNodeIds: ['agent-1', 'agent-2'],
      selectedNodeIds: ['artifact'],
    });
    expect(startedSlots).toEqual(['pragmatist', 'innovator', 'router', 'finalizer']);
  });

  it('does not let a router-role narrow fan_out_all to a single branch', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => {
      if (slot.id === 'orchestrator') {
        return {
          message: 'Route to researcher first. route_to(researcher, deep architecture analysis)',
          data: {
            branchSessionId,
            personaId,
            rootSessionId: run.rootSessionId,
            slotType: slot.slotType,
            executionMode: run.executionMode,
            ...routerData('researcher', 'deep architecture analysis'),
          },
        };
      }

      return {
        message: `${slot.label} completed.`,
        data: {
          branchSessionId,
          personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'architecture_debate',
      prompt: 'oceń architekturę',
      executionMode: 'subagent_execution',
      context: {
        projectPath: 'C:\\Projekty\\FamilyQuest',
        executionCwd: 'C:\\Projekty\\FamilyQuest',
      },
    });

    const orchestratorEvent = semanticEvents(service.getEvents(run.id))
      .find((event) => event.nodeId === 'orchestrator' && event.type === 'router_decision');
    expect(orchestratorEvent?.route).toMatchObject({
      mode: 'fan_out_all',
      source: 'router',
      selectedNodeIds: ['researcher', 'pragmatist', 'user-advocate'],
      rejectedNodeIds: [],
    });
    expect(orchestratorEvent?.route?.selectedNodeIds).not.toEqual(['researcher']);
  });

  it('waits for every active fan-out branch to reach a convergence router before routing onward', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => [
      'pragmatist',
      'innovator',
      'analyst',
      'router',
      'finalizer',
    ].includes(slot.id));

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Route only after every active branch finishes.',
      executionMode: 'subagent_execution',
      schema: {
        ...baseSchema,
        id: 'uneven-fanout-convergence',
        name: 'Uneven Fan-out Convergence',
        roleSlots,
        nodes: [
          {
            id: 'parallel',
            label: 'Parallel',
            kind: 'parallel' as const,
            behavior: { mode: 'fan_out_all' as const },
          },
          { id: 'short-agent', label: 'Short Agent', kind: 'role' as const, roleSlotId: 'pragmatist' },
          { id: 'long-agent', label: 'Long Agent', kind: 'role' as const, roleSlotId: 'innovator' },
          { id: 'validator', label: 'Validator', kind: 'role' as const, roleSlotId: 'analyst' },
          {
            id: 'router',
            label: 'Router',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'rank_then_merge' as const },
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
          { id: 'parallel-short-agent', fromNodeId: 'parallel', toNodeId: 'short-agent' },
          { id: 'parallel-long-agent', fromNodeId: 'parallel', toNodeId: 'long-agent' },
          { id: 'short-agent-router', fromNodeId: 'short-agent', toNodeId: 'router' },
          { id: 'long-agent-validator', fromNodeId: 'long-agent', toNodeId: 'validator' },
          { id: 'validator-router', fromNodeId: 'validator', toNodeId: 'router' },
          { id: 'router-artifact', fromNodeId: 'router', toNodeId: 'artifact' },
        ],
      },
    });

    expect(semanticEvents(service.getEvents(run.id)).map((event) => event.nodeId)).toEqual([
      undefined,
      'parallel',
      'short-agent',
      'long-agent',
      'validator',
      'router',
      'artifact',
    ]);
    expect(semanticEvents(service.getEvents(run.id)).find((event) => event.nodeId === 'router')?.data).toMatchObject({
      incomingNodeIds: ['short-agent', 'validator'],
      selectedNodeIds: ['artifact'],
    });
    expect(executor.execute).toHaveBeenCalledTimes(5);
  });

  it('stops bounded continuation routes with a configurable max graph step guard', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => ['pragmatist', 'router'].includes(slot.id));
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => ({
      message: `${slot.label} response for ${node?.id ?? 'unknown'}`,
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(node?.id === 'router-1'
          ? routerData('agent-1', 'Loop back.')
          : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Loop until the guard stops it.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 5, maxArchitectureNodeVisits: 10 },
      schema: {
        ...baseSchema,
        id: 'guarded-loop',
        name: 'Guarded Loop',
        roleSlots,
        nodes: [
          { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
          {
            id: 'router-1',
            label: 'Router 1',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'choose_one' as const },
          },
        ],
        edges: [
          { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
          { id: 'router-1-agent-1', fromNodeId: 'router-1', toNodeId: 'agent-1' },
        ],
      },
    });

    const events = service.getEvents(run.id);
    expect(run.status).toBe('failed');
    expect(run.completedAt).toBeDefined();
    expect(events.at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Runtime stopped after 5 graph steps.',
      reasonCode: 'max_steps',
    });
    expect(events.at(-1)?.data).toMatchObject({
      reasonCode: 'max_steps',
      maxNodeVisits: 10,
      maxSteps: 5,
    });
    expect(semanticEvents(events).filter((event) => event.nodeId === 'agent-1')).toHaveLength(3);
    expect(semanticEvents(events).filter((event) => event.nodeId === 'router-1')).toHaveLength(2);
  });

  it('resumes from the continuation cursor without replaying completed root nodes', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => ['pragmatist', 'router'].includes(slot.id));
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => ({
      message: `${slot.label} response for ${node?.id ?? 'unknown'}`,
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(node?.id === 'router-1'
          ? routerData('agent-1', 'Loop back.')
          : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Pause and resume from the pending router.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 1, maxArchitectureNodeVisits: 10 },
      schema: {
        ...baseSchema,
        id: 'resume-loop',
        name: 'Resume Loop',
        roleSlots,
        nodes: [
          { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
          {
            id: 'router-1',
            label: 'Router 1',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'choose_one' as const },
          },
        ],
        edges: [
          { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
          { id: 'router-1-agent-1', fromNodeId: 'router-1', toNodeId: 'agent-1' },
        ],
      },
    });
    const pauseEvent = service.getEvents(run.id).at(-1);
    expect(pauseEvent).toMatchObject({
      type: 'router_decision',
      data: {
        pendingNodeIds: ['router-1'],
        visitCounts: { 'agent-1': 1 },
      },
    });

    vi.mocked(executor.execute).mockClear();
    await service.resumeRun(run.id, {
      maxSteps: 1,
      continuation: {
        reason: 'max_steps',
        waitingNodeId: 'router-1',
        pendingNodeIds: ['router-1'],
        visitCounts: { 'agent-1': 1 },
        lastCompletedNodeId: 'agent-1',
        message: pauseEvent?.message,
      },
    });

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'router' }),
      node: expect.objectContaining({ id: 'router-1' }),
    }));
    expect(executor.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'pragmatist' }),
    }));

    const semantic = semanticEvents(service.getEvents(run.id));
    expect(semantic.filter((event) => event.nodeId === 'agent-1')).toHaveLength(1);
    expect(semantic.filter((event) => event.nodeId === 'router-1')).toHaveLength(1);
    expect(semantic.at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Runtime stopped after 1 graph steps.',
      data: {
        pendingNodeIds: ['agent-1'],
        visitCounts: { 'agent-1': 1, 'router-1': 1 },
      },
    });
  });

  it('fails resumed runs with a typed max_node_visits event when the pending node is already capped', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => ['pragmatist', 'router'].includes(slot.id));
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => ({
      message: `${slot.label} response for ${node?.id ?? 'unknown'}`,
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(node?.id === 'router-1'
          ? routerData('agent-1', 'Loop back.')
          : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Resume should fail when pending node is visit-capped.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 1, maxArchitectureNodeVisits: 1 },
      schema: {
        ...baseSchema,
        id: 'resume-max-node-visits',
        name: 'Resume Max Node Visits',
        roleSlots,
        nodes: [
          { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
          {
            id: 'router-1',
            label: 'Router 1',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'choose_one' as const },
          },
        ],
        edges: [
          { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
          { id: 'router-1-agent-1', fromNodeId: 'router-1', toNodeId: 'agent-1' },
        ],
      },
    });

    vi.mocked(executor.execute).mockClear();
    const resumed = await service.resumeRun(run.id, {
      maxSteps: 5,
      continuation: {
        reason: 'max_steps',
        waitingNodeId: 'router-1',
        pendingNodeIds: ['router-1'],
        visitCounts: { 'agent-1': 1, 'router-1': 1 },
        lastCompletedNodeId: 'agent-1',
        message: 'Router 1 was pending after a previous pause.',
      },
    });

    expect(executor.execute).not.toHaveBeenCalled();
    expect(resumed.status).toBe('failed');
    expect(resumed.completedAt).toBeDefined();
    expect(service.findRun(run.id)?.status).toBe('failed');
    expect(service.getEvents(run.id).at(-1)).toMatchObject({
      type: 'router_decision',
      reasonCode: 'max_node_visits',
      data: {
        reasonCode: 'max_node_visits',
        pendingNodeIds: ['router-1'],
        visitCounts: { 'agent-1': 1, 'router-1': 1 },
      },
    });
  });

  it('re-enters Goal Master after passed external QA instead of replaying the pending implementer', async () => {
    const executor = { execute: vi.fn() } satisfies ArchitectureRoleExecutor;
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop')!;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => {
      return {
        message: slot.id === 'goal_master'
          ? 'Goal Master still asks for another implementation loop. route_to(implementer, continue)'
          : `${slot.label} completed.`,
        data: {
          branchSessionId,
          personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.id === 'goal_master'
            ? {
                ...routerData('implementer', 'continue'),
                toolEvidence: {
                  toolResultCount: 1,
                  successfulToolNames: ['vfs_read'],
                  targetPaths: ['src/runtime-proof-demo57.ts'],
                },
              }
            : {}),
        },
      };
    });
    const run: ArchitectureRun = {
      id: 'resume-acceptance-run',
      schemaId: schema.id,
      prompt: 'Resume after external QA passed.',
      status: 'running',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-resume-acceptance-root',
      branchSessionIds: Object.fromEntries(schema.roleSlots.map((slot) => [slot.id, `branch-${slot.id}`])),
      createdAt: 1,
      updatedAt: 1,
      context: {
        externalQualityGate: {
          source: 'external-build',
          status: 'passed',
          highFindings: 0,
          blocking: false,
          summary: 'Host build passed.',
        },
        requireGoalMasterLoopProof: true,
        requireImplementerWriteProof: true,
      },
    };
    const priorEvents: ArchitectureExecutionEvent[] = [
      {
        id: 'prior-1',
        runId: run.id,
        sequence: 1,
        type: 'participant_output',
        message: 'Implementer wrote proof.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolEvidence: {
            toolResultCount: 1,
            successfulToolNames: ['vfs_write', 'spawn_cli_agent'],
            targetPaths: ['src/runtime-proof-demo57.ts'],
            childCliSessions: [{ status: 'running' }],
          },
        },
        createdAt: 1,
      },
      {
        id: 'prior-2',
        runId: run.id,
        sequence: 2,
        type: 'participant_output',
        message: 'Implementer wrote proof.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolEvidence: {
            toolResultCount: 1,
            successfulToolNames: ['vfs_write'],
            targetPaths: ['src/runtime-proof-demo57.ts'],
          },
        },
        createdAt: 2,
      },
      {
        id: 'prior-3',
        runId: run.id,
        sequence: 3,
        type: 'router_decision',
        message: 'Goal Master returned control to the orchestrator.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        data: {
          pendingNodeIds: ['implementer'],
          returnToOrchestrator: true,
          visitCounts: {
            orchestrator: 1,
            implementer: 1,
            verifier: 1,
            tester: 1,
            'goal-master': 1,
          },
        },
        createdAt: 3,
      },
    ];

    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: 10,
      roleExecutor: executor,
      personaForSlot: () => 'default',
      priorEvents,
      resumeFrom: {
        reason: 'return_to_orchestrator',
        waitingNodeId: 'implementer',
        pendingNodeIds: ['implementer'],
        visitCounts: {
          orchestrator: 1,
          implementer: 1,
          verifier: 1,
          tester: 1,
          'goal-master': 1,
        },
        lastCompletedNodeId: 'goal-master',
        message: 'Goal Master returned control to the orchestrator.',
      },
    });

    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'goal_master' }),
      node: expect.objectContaining({ id: 'goal-master' }),
    }));
    expect(executor.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'implementer' }),
    }));

    const semantic = semanticEvents(events);
    const goalDecision = [...semantic].reverse()
      .find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');
    expect(goalDecision).toMatchObject({
      route: expect.objectContaining({
        source: 'runtime_fallback',
        selectedNodeIds: ['final-artifact'],
        nextNodeId: 'final-artifact',
      }),
      data: expect.objectContaining({
        runtimeGuard: expect.stringContaining('external-build quality gate passed'),
      }),
    });
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('re-enters the last completed Goal Master after a later orchestrator resume attempt misses the final artifact', async () => {
    const executor = { execute: vi.fn() } satisfies ArchitectureRoleExecutor;
    const schema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop')!;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master still asks for another implementation loop. route_to(implementer, continue)'
        : `${slot.label} completed.`,
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master'
          ? {
              ...routerData('implementer', 'continue'),
              toolEvidence: {
                toolResultCount: 1,
                successfulToolNames: ['vfs_read'],
                targetPaths: ['src/runtime-proof-demo57.ts'],
              },
            }
          : {}),
      },
    }));
    const run: ArchitectureRun = {
      id: 'resume-after-missing-final-artifact-run',
      schemaId: schema.id,
      prompt: 'Resume after a later attempt missed final artifact.',
      status: 'running',
      executionMode: 'subagent_execution',
      rootSessionId: 'arch-resume-after-missing-final-artifact-root',
      branchSessionIds: Object.fromEntries(schema.roleSlots.map((slot) => [slot.id, `branch-${slot.id}`])),
      createdAt: 1,
      updatedAt: 1,
      context: {
        externalQualityGate: {
          source: 'external-build',
          status: 'passed',
          highFindings: 0,
          blocking: false,
          summary: 'Host build and visual QA passed.',
        },
        requireGoalMasterLoopProof: true,
        requireImplementerWriteProof: true,
      },
    };
    const priorEvents: ArchitectureExecutionEvent[] = [
      {
        id: 'prior-node-completed-goal-master',
        runId: run.id,
        sequence: 1,
        type: 'node_completed',
        message: 'Goal Master completed.',
        nodeId: 'goal-master',
        roleSlotId: 'goal_master',
        data: { selectedNodeIds: ['implementer'] },
        createdAt: 1,
      },
      {
        id: 'prior-implementer-proof',
        runId: run.id,
        sequence: 2,
        type: 'participant_output',
        message: 'Implementer wrote proof.',
        nodeId: 'implementer',
        roleSlotId: 'implementer',
        data: {
          toolEvidence: {
            toolResultCount: 1,
            successfulToolNames: ['vfs_write'],
            targetPaths: ['src/runtime-proof-demo57.ts'],
          },
        },
        createdAt: 2,
      },
      {
        id: 'prior-later-orchestrator',
        runId: run.id,
        sequence: 3,
        type: 'node_completed',
        message: 'Orchestrator completed without a final artifact.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        data: { selectedNodeIds: ['implementer'] },
        createdAt: 3,
      },
    ];

    const events = await createArchitectureGraphEvents({
      schema,
      run,
      now: 10,
      roleExecutor: executor,
      personaForSlot: () => 'default',
      priorEvents,
      resumeFrom: {
        reason: 'return_to_orchestrator',
        waitingNodeId: 'implementer',
        pendingNodeIds: ['implementer'],
        visitCounts: {
          orchestrator: 1,
          implementer: 1,
          verifier: 1,
          tester: 1,
          'goal-master': 1,
        },
        lastCompletedNodeId: 'orchestrator',
        message: 'Blocked because the latest architecture attempt completed without a final artifact.',
      },
    });

    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'goal_master' }),
      node: expect.objectContaining({ id: 'goal-master' }),
    }));
    expect(executor.execute).not.toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'implementer' }),
    }));

    const semantic = semanticEvents(events);
    const goalDecision = [...semantic].reverse()
      .find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');
    expect(goalDecision).toMatchObject({
      route: expect.objectContaining({
        source: 'runtime_fallback',
        selectedNodeIds: ['final-artifact'],
        nextNodeId: 'final-artifact',
      }),
      data: expect.objectContaining({
        runtimeGuard: expect.stringContaining('external-build quality gate passed'),
      }),
    });
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('marks max-node-visit guard stops as failed instead of leaving the run running', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => ['pragmatist', 'router'].includes(slot.id));
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'router'
        ? 'Router loops back. route_to(agent-1, continue)'
        : 'Pragmatist needs review.',
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'router' ? routerData('agent-1') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Stop after max node visits.',
      executionMode: 'subagent_execution',
      context: { maxArchitectureSteps: 10, maxArchitectureNodeVisits: 1 },
      schema: {
        ...baseSchema,
        id: 'max-visits-loop',
        name: 'Max Visits Loop',
        roleSlots,
        nodes: [
          { id: 'agent-1', label: 'Agent 1', kind: 'role' as const, roleSlotId: 'pragmatist' },
          {
            id: 'router-1',
            label: 'Router 1',
            kind: 'router' as const,
            roleSlotId: 'router',
            behavior: { mode: 'choose_one' as const },
          },
        ],
        edges: [
          { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
          { id: 'router-1-agent-1', fromNodeId: 'router-1', toNodeId: 'agent-1' },
        ],
      },
    });

    expect(run.status).toBe('failed');
    expect(run.completedAt).toBeDefined();
    expect(service.getEvents(run.id).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Runtime stopped after reaching max node visits.',
      data: {
        pendingNodeIds: ['agent-1'],
        visitCounts: { 'agent-1': 1, 'router-1': 1 },
      },
    });
  });

  it('uses slot override personas and parent session context when creating branches', async () => {
    const { service, sessions } = createService();
    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Tune branch personas.',
      context: { parentSessionId: 'parent-chat-1' },
      slotOverrides: { pragmatist: 'persona.delivery_override' },
    });

    expect(sessions.created[0]?.dto.parentSessionId).toBe('parent-chat-1');
    expect(sessions.created.find((entry) => entry.id === run.branchSessionIds?.['pragmatist'])?.dto).toMatchObject({
      personaId: 'persona.delivery_override',
      parentSessionId: run.rootSessionId,
      kind: 'subagent',
      runtimeContext: {
        architectureContext: {
          roleSlotId: 'pragmatist',
          roleSlotType: 'participant',
        },
      },
    });
  });

  it('preserves explicit subagent execution mode through runtime and participant events', async () => {
    const { service, executor } = createService();
    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run live architecture branches.',
      executionMode: 'subagent_execution',
    });

    expect(run.executionMode).toBe('subagent_execution');
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      run: expect.objectContaining({ executionMode: 'subagent_execution' }),
    }));
    expect(semanticEvents(service.getEvents(run.id)).find((event) => event.roleSlotId === 'pragmatist')?.data).toMatchObject({
      executionMode: 'subagent_execution',
    });
  });

  it('persists a parent chat turn with architecture branches as subagent tool calls', async () => {
    const { service, sessionManager } = createService();

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'What can you do?',
      executionMode: 'subagent_execution',
      context: { parentSessionId: 'parent-chat-1' },
    });

    const persisted = sessionManager.persistMessage.mock.calls.map(([message]) => message);
    expect(persisted[0]).toMatchObject({
      id: `architecture:${run.id}:user`,
      sessionId: 'parent-chat-1',
      role: 'user',
      content: 'What can you do?',
    });
    const toolHost = persisted.find((message) => message.id === `architecture:${run.id}:tool-calls`);
    const toolCalls = toolHost?.toolCalls ?? [];
    expect(toolCalls.map((toolCall: LLMToolCall) => toolCall.name)).toEqual([
      'run_subagent',
      'run_subagent',
      'run_subagent',
      'run_subagent',
      'run_subagent',
    ]);
    expect(toolCalls.map((toolCall: LLMToolCall) => toolCall.args.roleSlotId)).toEqual([
      'pragmatist',
      'innovator',
      'analyst',
      'user_advocate',
      'shadow',
    ]);
    const toolResults = persisted.filter((message) => message.role === 'tool_result');
    expect(toolResults).toHaveLength(5);
    expect(JSON.parse(toolResults[0]?.content ?? '{}')).toMatchObject({
      parentSessionId: 'parent-chat-1',
      vfsMode: 'shared',
      vfsSessionId: run.rootSessionId,
    });
    expect(persisted.some((message) => (
      message.role === 'assistant'
      && message.content.includes('### Router')
    ))).toBe(true);
    expect(persisted.some((message) => (
      message.role === 'assistant'
      && message.content.includes('### Finalizer')
    ))).toBe(true);
  });

  it('hydrates the architecture root VFS from a source session before branch execution', async () => {
    const { service, audit, vfs } = createService();

    const run = await service.createRun({
      schemaId: 'five-minds-council',
      prompt: 'Analyze hydrated target files.',
      executionMode: 'subagent_execution',
      context: {
        hydrateFromSessionId: 'source-session',
        hydrateTargetPrefix: 'target',
        hydrateFilePaths: ['target/README.md', 'package.json'],
      },
    });

    expect(vfs.readBinary).toHaveBeenCalledWith('source-session', 'README.md');
    expect(vfs.writeBinary).toHaveBeenCalledWith(run.rootSessionId, 'target/README.md', Buffer.from('hydrated'));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      label: `architecture_hydration:${run.id}`,
      data: expect.objectContaining({
        kind: 'architecture_hydration',
        runId: run.id,
        copiedCount: 2,
        skippedCount: 0,
      }),
    }));
  });

  it('logs individual architecture runtime events for timeline/audit inspection', async () => {
    const { service, audit } = createService();

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Audit runtime routing.',
      executionMode: 'subagent_execution',
      context: { parentSessionId: 'parent-session' },
    });

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      label: expect.stringMatching(/^architecture_event:/),
      type: 'architecture_event',
      sessionId: 'parent-session',
      data: expect.objectContaining({
        kind: 'architecture_event',
        runId: run.id,
        architectureRunId: run.id,
        schemaId: 'strategic-decision-council',
        eventType: expect.any(String),
        sequence: expect.any(Number),
        messagePreview: expect.any(String),
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      label: 'workflow.run.started',
      type: 'runtime_event',
      sessionId: 'parent-session',
      data: expect.objectContaining({
        domain: 'runtime',
        eventName: 'workflow.run.started',
        runId: run.id,
        schemaId: 'strategic-decision-council',
        executionMode: 'subagent_execution',
        status: 'started',
      }),
    }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      label: 'workflow.node.started',
      type: 'runtime_event',
      sessionId: 'parent-session',
      data: expect.objectContaining({
        domain: 'runtime',
        eventName: 'workflow.node.started',
        runId: run.id,
        nodeId: expect.any(String),
        schemaId: 'strategic-decision-council',
        eventType: 'node_started',
        status: 'started',
      }),
    }));
    const runtimeRows = audit.log.mock.calls
      .map(([entry]) => entry)
      .filter((entry) => entry.type === 'runtime_event');
    expect(runtimeRows.length).toBeGreaterThan(0);
    expect(runtimeRows.every((entry) => !('prompt' in (entry.data ?? {})))).toBe(true);
  });

  it('executes the Goal Master loop with bounded continuation routing', async () => {
    const { service, executor } = createService();
    let goalMasterVisits = 0;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'goal_master') {
        goalMasterVisits += 1;
        return {
          message: goalMasterVisits === 1
            ? 'Goal Master found missing evidence and routes back to implementation.'
            : 'Goal Master accepts the evidence and routes to final artifact.',
          data: {
            branchSessionId,
            personaId,
            sessionPersonaId: personaId,
            rootSessionId: run.rootSessionId,
            slotType: slot.slotType,
            executionMode: run.executionMode,
            ...routerData(goalMasterVisits === 1 ? 'implementer' : 'final-artifact'),
          },
        };
      }

      return {
        message: `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Finish the feature and keep working until accepted.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 3,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));

    expect(run.status).toBe('completed');
    expect(goalMasterVisits).toBe(2);
    expect(semantic.filter((event) => event.nodeId === 'implementer' && event.type === 'participant_output')).toHaveLength(2);
    expect(semantic.filter((event) => event.nodeId === 'tester' && event.type === 'participant_output')).toHaveLength(2);
    expect(semantic.filter((event) => event.nodeId === 'goal-master' && event.type === 'router_decision')).toHaveLength(2);
    expect(semantic.find((event) => event.nodeId === 'goal-master')?.route?.selectedNodeIds).toEqual(['implementer']);
    expect(semantic.filter((event) => event.nodeId === 'goal-master').at(-1)?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(semantic.at(-1)?.type).toBe('final_artifact');
    expect(service.getGraph(run.id)?.edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)).toContain('goal-master->implementer');
  });

  it('executes the root orchestrator as an agent in the Goal Master delivery loop', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'orchestrator'
        ? 'Acceptance criteria defined and first implementation pass delegated. route_to(implementer, start implementation)'
        : slot.id === 'goal_master'
          ? 'Goal Master accepts visible tool proof. route_to(final-artifact, accepted)'
          : slot.slotType === 'tool_executor'
            ? `${slot.label} completed with ${slot.id === 'implementer' ? 'vfs_write' : 'vfs_read'} tool evidence.`
            : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'orchestrator' ? routerData('implementer', 'start implementation') : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Run the orchestrator as the first delivery agent.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const orchestratorDecision = semantic.find((event) => event.nodeId === 'orchestrator' && event.type === 'router_decision');

    expect(orchestratorDecision?.route).toMatchObject({
      source: 'agent',
      selectedNodeIds: ['implementer'],
      response: 'start implementation',
    });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      slot: expect.objectContaining({ id: 'orchestrator' }),
      incomingEvents: [],
      outgoingNodeIds: ['implementer'],
    }));
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('surfaces branch tool progress as architecture events while a role executes', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, emit, personaId, run, slot }) => {
      if (slot.id === 'orchestrator') {
        emit?.('tool:start', {
          callId: 'cli-call-1',
          toolName: 'run_cli_agent',
          args: { workdir: 'C:\\Projekty\\TurboProject2' },
          sessionId: branchSessionId,
        });
        emit?.('tool:result', {
          callId: 'cli-call-1',
          toolName: 'run_cli_agent',
          status: 'success',
          data: { childSessionId: 'cli-child-1' },
          sessionId: branchSessionId,
        });
      }
      return {
        message: slot.id === 'orchestrator'
          ? 'CLI child finished. route_to(implementer, continue)'
          : slot.id === 'goal_master'
            ? 'Goal Master accepts. route_to(final-artifact, accepted)'
            : slot.slotType === 'tool_executor'
              ? `${slot.label} completed with ${slot.id === 'implementer' ? 'vfs_write' : 'vfs_read'} tool evidence.`
              : `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.id === 'orchestrator' ? routerData('implementer') : {}),
          ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
          ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Proxy branch tool progress into architecture events.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const toolEvents = service.getEvents(run.id).filter((event) => event.type === 'tool_call');

    expect(toolEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        message: 'Orchestrator started run_cli_agent.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        data: expect.objectContaining({
          kind: 'branch_stream',
          event: 'tool:start',
          toolName: 'run_cli_agent',
          toolPath: 'C:\\Projekty\\TurboProject2',
        }),
      }),
      expect.objectContaining({
        message: 'Orchestrator run_cli_agent success.',
        nodeId: 'orchestrator',
        roleSlotId: 'orchestrator',
        data: expect.objectContaining({
          kind: 'branch_stream',
          event: 'tool:result',
          toolName: 'run_cli_agent',
          status: 'success',
        }),
      }),
    ]));
  });

  it('accepts CLI-agent implementation evidence from prior architecture nodes', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'orchestrator'
        ? 'Delegated implementation to Copilot CLI and inspected changed files. route_to(implementer, cli implementation complete)'
        : slot.id === 'goal_master'
          ? 'Goal Master accepts CLI implementation and verifier evidence. route_to(final-artifact, accepted)'
          : slot.id === 'implementer'
            ? 'Implementer confirmed files already exist from CLI child and avoided redundant host writes.'
            : slot.slotType === 'tool_executor'
              ? `${slot.label} completed with vfs_read tool evidence.`
              : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'orchestrator' ? {
          ...routerData('implementer', 'cli implementation complete'),
          toolEvidence: {
            toolCallCount: 2,
            toolResultCount: 2,
            toolNames: ['run_cli_agent', 'fs_read'],
            successfulToolNames: ['run_cli_agent', 'fs_read'],
            targetPaths: ['C:\\Projekty\\TurboProject2\\package.json', 'C:\\Projekty\\TurboProject2\\src\\App.tsx'],
          },
        } : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer' ? {
          toolEvidence: {
            toolCallCount: 1,
            toolResultCount: 1,
            toolNames: ['fs_read'],
            successfulToolNames: ['fs_read'],
            targetPaths: ['C:\\Projekty\\TurboProject2\\src\\App.tsx'],
          },
        } : {}),
        ...(slot.slotType === 'tool_executor' && slot.id !== 'implementer' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Accept CLI child implementation as architecture-level write proof.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));

    expect(run.status).toBe('completed');
    expect(semantic.find((event) => event.nodeId === 'implementer')?.message).toContain('CLI child');
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('continues a still-running durable CLI child as incomplete implementation evidence', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'implementer'
        ? 'Implementer hit a recoverable branch error: Sub-agent timed out after 120000ms.'
        : slot.id === 'goal_master'
          ? 'Goal Master sees running CLI child and routes back. route_to(implementer, cli child still running)'
        : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('implementer', 'cli child still running') : {}),
        ...(slot.id === 'implementer' ? {
          toolEvidence: {
            toolCallCount: 1,
            toolResultCount: 1,
            toolNames: ['spawn_cli_agent'],
            successfulToolNames: ['spawn_cli_agent'],
            targetPaths: ['C:\\Projekty\\TurboProject2'],
            childCliSessions: [{
              childSessionId: 'cli-child-running',
              agentId: 'copilot',
              workdir: 'C:\\Projekty\\TurboProject2',
              status: 'running',
            }],
          },
        } : slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Continue running CLI child as incomplete delegation evidence.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));

    expect(run.status).toBe('failed');
    expect(semantic.find((event) => event.nodeId === 'implementer')?.message).toContain('recoverable branch error');
    expect(semantic.find((event) => event.nodeId === 'goal-master')?.route?.nextNodeId).toBe('implementer');
  });

  it('does not treat a running CLI child implementer as completed proof when Goal Master tries to finalize', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts delegated CLI proof. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer completed spawn_cli_agent delegation; child is still running.'
          : slot.slotType === 'tool_executor'
            ? `${slot.label} completed with vfs_read tool evidence.`
            : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-running-proof', 'running') }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not finish while the CLI implementer is still running.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(run.status).toBe('failed');
    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      rejectedNodeIds: ['final-artifact'],
    });
    expect(goalDecision?.data).toMatchObject({
      runtimeGuard: expect.stringContaining('CLI child implementation is incomplete'),
    });
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('allows finalization when later verifier evidence independently proves host files and build output despite a stale CLI child', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master independently verified files and dist build output. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer delegated host writes to a CLI child that is still reported as running.'
          : slot.id === 'verifier'
            ? 'Verifier confirmed npm build output through terminal and dist reads.'
            : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master'
          ? {
            ...routerData('final-artifact'),
            toolEvidence: {
              toolCallCount: 3,
              toolResultCount: 3,
              toolNames: ['fs_list', 'fs_read'],
              successfulToolNames: ['fs_list', 'fs_read'],
              targetPaths: [
                'C:\\Projekty\\TurboProject2\\dist',
                'C:\\Projekty\\TurboProject2\\dist\\index.html',
                'C:\\Projekty\\TurboProject2\\src\\App.tsx',
              ],
            },
          }
          : {}),
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-stale-after-build', 'running') }
          : slot.id === 'verifier'
            ? {
              evidence: [buildResultEvidence()],
              toolEvidence: {
                toolCallCount: 4,
                toolResultCount: 4,
                toolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                successfulToolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                targetPaths: [
                  'C:\\Projekty\\TurboProject2',
                  'C:\\Projekty\\TurboProject2\\dist',
                  'C:\\Projekty\\TurboProject2\\dist\\index.html',
                ],
              },
            }
            : slot.slotType === 'tool_executor'
              ? { toolEvidence: toolEvidenceForSlot(slot.id) }
              : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Allow independent verifier build evidence to override stale CLI projection.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(run.status).toBe('completed');
    expect(goalDecision?.route).toMatchObject({
      selectedNodeIds: ['final-artifact'],
      rejectedNodeIds: ['implementer'],
    });
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('does not treat dist target paths as host build proof without typed build evidence', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts a path-only build claim. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer delegated host writes to a CLI child that is still reported as running.'
          : slot.id === 'verifier'
            ? 'Verifier read dist paths and saw terminal tool names but did not emit typed build evidence.'
            : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-path-only-build', 'running') }
          : slot.id === 'verifier'
            ? {
              toolEvidence: {
                toolCallCount: 4,
                toolResultCount: 4,
                toolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                successfulToolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                targetPaths: [
                  'C:\\Projekty\\TurboProject2',
                  'C:\\Projekty\\TurboProject2\\dist',
                  'C:\\Projekty\\TurboProject2\\dist\\index.html',
                ],
              },
            }
            : slot.slotType === 'tool_executor'
              ? { toolEvidence: toolEvidenceForSlot(slot.id) }
              : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Reject path-only dist build evidence.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(run.status).toBe('failed');
    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      rejectedNodeIds: ['final-artifact'],
    });
    expect(goalDecision?.data).toMatchObject({
      runtimeGuard: expect.stringContaining('CLI child implementation is incomplete'),
    });
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('does not crash a resumed implementer pass when prior verifier evidence already proves host build output', async () => {
    const { service, executor } = createService();
    let goalMasterVisits = 0;
    let implementerVisits = 0;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'goal_master') {
        goalMasterVisits += 1;
      }
      if (slot.id === 'implementer') {
        implementerVisits += 1;
      }
      return {
        message: slot.id === 'goal_master'
          ? goalMasterVisits === 1
            ? 'Goal Master requests one more implementation pass. route_to(implementer, continue)'
            : 'Goal Master accepts independently verified host build evidence. route_to(final-artifact, accepted)'
          : slot.id === 'implementer'
            ? implementerVisits === 1
              ? 'Implementer delegated host writes to a CLI child that is still reported as running.'
              : 'Implementer resumed after checkpoint and inspected the already built host project.'
            : slot.id === 'verifier'
              ? 'Verifier confirmed source files and dist output through reads and terminal build evidence.'
              : `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.id === 'goal_master'
            ? routerData(goalMasterVisits === 1 ? 'implementer' : 'final-artifact')
            : {}),
          ...(slot.id === 'implementer'
            ? {
              toolEvidence: implementerVisits === 1
                ? cliChildToolEvidence('cli-child-stale-after-checkpoint', 'running')
                : {
                  toolCallCount: 1,
                  toolResultCount: 1,
                  toolNames: ['fs_read'],
                  successfulToolNames: ['fs_read'],
                  targetPaths: ['C:\\Projekty\\TurboProject2\\dist\\index.html'],
                },
            }
            : slot.id === 'verifier'
              ? {
                evidence: [buildResultEvidence()],
                toolEvidence: {
                  toolCallCount: 4,
                  toolResultCount: 4,
                  toolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                  successfulToolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                  targetPaths: [
                    'C:\\Projekty\\TurboProject2',
                    'C:\\Projekty\\TurboProject2\\dist',
                    'C:\\Projekty\\TurboProject2\\dist\\index.html',
                  ],
                },
              }
              : slot.slotType === 'tool_executor'
                ? { toolEvidence: toolEvidenceForSlot(slot.id) }
                : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Resume without requiring duplicate implementer writes after build proof.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 2,
        maxArchitectureSteps: 30,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));

    expect(run.status).toBe('completed');
    expect(implementerVisits).toBe(2);
    expect(semantic.filter((event) => event.nodeId === 'goal-master' && event.type === 'router_decision')).toHaveLength(2);
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('does not crash a no-op resumed implementer pass after independent host build proof exists', async () => {
    const { service, executor } = createService();
    let goalMasterVisits = 0;
    let implementerVisits = 0;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'goal_master') {
        goalMasterVisits += 1;
      }
      if (slot.id === 'implementer') {
        implementerVisits += 1;
      }
      return {
        message: slot.id === 'goal_master'
          ? goalMasterVisits === 1
            ? 'Goal Master requests one more implementation pass. route_to(implementer, continue)'
            : 'Goal Master accepts independently verified host build evidence. route_to(final-artifact, accepted)'
          : slot.id === 'implementer'
            ? implementerVisits === 1
              ? 'Implementer delegated host writes to a CLI child that is still reported as running.'
              : 'Implementer resumed and reported no further writes were needed.'
            : slot.id === 'verifier'
              ? 'Verifier confirmed source files and dist output through reads and terminal build evidence.'
              : `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.id === 'goal_master'
            ? routerData(goalMasterVisits === 1 ? 'implementer' : 'final-artifact')
            : {}),
          ...(slot.id === 'implementer' && implementerVisits === 1
            ? { toolEvidence: cliChildToolEvidence('cli-child-stale-after-noop', 'running') }
            : slot.id === 'verifier'
              ? {
                evidence: [buildResultEvidence()],
                toolEvidence: {
                  toolCallCount: 4,
                  toolResultCount: 4,
                  toolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                  successfulToolNames: ['fs_list', 'fs_read', 'terminal_spawn', 'terminal_output'],
                  targetPaths: [
                    'C:\\Projekty\\TurboProject2',
                    'C:\\Projekty\\TurboProject2\\dist',
                    'C:\\Projekty\\TurboProject2\\dist\\index.html',
                  ],
                },
              }
              : slot.slotType === 'tool_executor' && slot.id !== 'implementer'
                ? { toolEvidence: toolEvidenceForSlot(slot.id) }
                : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Resume no-op implementer after build proof.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 2,
        maxArchitectureSteps: 30,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));

    expect(run.status).toBe('completed');
    expect(implementerVisits).toBe(2);
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('does not treat an unknown CLI child status as completed proof', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts delegated CLI proof. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer delegated host writes to a CLI child with unknown status.'
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-unknown-proof', 'unknown') }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not finish while CLI child status is unknown.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(run.status).toBe('failed');
    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      rejectedNodeIds: ['final-artifact'],
    });
    expect(goalDecision?.data).toMatchObject({
      runtimeGuard: expect.stringContaining('child status is unknown'),
    });
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('does not finalize with direct writes while a CLI child status is unknown', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts visible write proof. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer wrote files directly but delegated CLI child status is unknown.'
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer'
          ? {
              toolEvidence: {
                ...cliChildToolEvidence('cli-child-unknown-with-write', 'unknown'),
                toolNames: ['spawn_cli_agent', 'fs_write'],
                successfulToolNames: ['spawn_cli_agent', 'fs_write'],
              },
            }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not finish while an unknown CLI child is linked to direct writes.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(run.status).toBe('failed');
    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      rejectedNodeIds: ['final-artifact'],
    });
    expect(goalDecision?.data).toMatchObject({
      runtimeGuard: expect.stringContaining('child status is unknown'),
    });
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('fails finalization if a running CLI child reaches the finalizer despite router guards', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master incorrectly accepts delegated CLI proof. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer delegated host writes to a CLI child that is still running.'
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-finalizer-block', 'running') }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Finalizer must not accept an unresolved CLI child.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });

    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'UNKNOWN',
      failure: expect.objectContaining({
        code: 'UNKNOWN',
        retryable: false,
        message: expect.stringContaining('Architecture finalization blocked: CLI child implementation is incomplete'),
      }),
    });
    expect(semanticEvents(service.getEvents(run.id)).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'UNKNOWN',
    });
  });

  it('passes all prior childCliSessions into Goal Master and finalizer inputs', async () => {
    const { service, executor } = createService();
    let goalMasterVisits = 0;
    let implementerVisits = 0;
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      if (slot.id === 'goal_master') {
        goalMasterVisits += 1;
      }
      if (slot.id === 'implementer') {
        implementerVisits += 1;
      }
      return {
        message: slot.id === 'goal_master'
          ? goalMasterVisits === 1
            ? 'Goal Master needs another pass. route_to(implementer, continue)'
            : 'Goal Master accepts all CLI evidence. route_to(final-artifact, accepted)'
          : slot.id === 'implementer'
            ? `Implementer completed spawn_cli_agent child cli-child-${implementerVisits}.`
            : `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.id === 'goal_master'
            ? routerData(goalMasterVisits === 1 ? 'implementer' : 'final-artifact')
            : {}),
          ...(slot.id === 'implementer'
            ? { toolEvidence: cliChildToolEvidence(`cli-child-${implementerVisits}`, 'completed') }
            : slot.slotType === 'tool_executor'
              ? { toolEvidence: toolEvidenceForSlot(slot.id) }
              : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Carry CLI child session evidence through every review pass.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 2,
        maxArchitectureSteps: 30,
      },
    });
    const inputs = vi.mocked(executor.execute).mock.calls.map(([input]) => input);
    const secondGoalMasterInput = inputs.filter((input) => input.slot.id === 'goal_master').at(-1);
    const finalizerInput = inputs.find((input) => input.slot.id === 'finalizer');

    expect(run.status).toBe('completed');
    expect(childCliSessionIds(secondGoalMasterInput?.incomingEvents)).toEqual(expect.arrayContaining([
      'cli-child-1',
      'cli-child-2',
    ]));
    expect(childCliSessionIds(finalizerInput?.incomingEvents)).toEqual(expect.arrayContaining([
      'cli-child-1',
      'cli-child-2',
    ]));
  });

  it.each(['stopped', 'failed'] as const)(
    'does not count a %s CLI child as completed implementation',
    async (status) => {
      const { service, executor } = createService();
      vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
        message: slot.id === 'goal_master'
          ? 'Goal Master accepts delegated CLI proof. route_to(final-artifact, accepted)'
          : slot.id === 'implementer'
            ? `Implementer completed spawn_cli_agent delegation; child ${status}.`
            : slot.slotType === 'tool_executor'
              ? `${slot.label} completed with vfs_read tool evidence.`
              : `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
          ...(slot.id === 'implementer'
            ? { toolEvidence: cliChildToolEvidence(`cli-child-${status}`, status) }
            : slot.slotType === 'tool_executor'
              ? { toolEvidence: toolEvidenceForSlot(slot.id) }
              : {}),
        },
      }));

      const run = await service.createRun({
        schemaId: 'goal-master-delivery-loop',
        prompt: `Do not finish from a ${status} CLI implementer.`,
        executionMode: 'subagent_execution',
        context: {
          requireGoalMasterLoopProof: true,
          maxArchitectureNodeVisits: 1,
          maxArchitectureSteps: 20,
        },
      });
      const semantic = semanticEvents(service.getEvents(run.id));
      const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

      expect(run.status).toBe('failed');
      expect(goalDecision?.route).toMatchObject({
        source: 'runtime_fallback',
        selectedNodeIds: ['implementer'],
        rejectedNodeIds: ['final-artifact'],
      });
      expect(semantic.at(-1)?.type).not.toBe('final_artifact');
    },
  );

  it('does not finalize while any prior CLI child is unresolved even when direct writes exist', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts visible write proof. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer wrote files directly but still has a running delegated CLI child.'
          : slot.slotType === 'tool_executor'
            ? `${slot.label} completed with vfs_read tool evidence.`
            : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        ...(slot.id === 'implementer'
          ? {
              toolEvidence: {
                ...cliChildToolEvidence('cli-child-running-with-write', 'running'),
                toolNames: ['spawn_cli_agent', 'fs_write'],
                successfulToolNames: ['spawn_cli_agent', 'fs_write'],
              },
            }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not finish while any delegated CLI child is still unresolved.',
      executionMode: 'subagent_execution',
      context: {
        requireGoalMasterLoopProof: true,
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      rejectedNodeIds: ['final-artifact'],
    });
    expect(goalDecision?.data).toMatchObject({
      runtimeGuard: expect.stringContaining('CLI child'),
    });
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('can enforce one visible Goal Master continuation before finalization', async () => {
    const { service, executor, audit } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!baseSchema) throw new Error('Expected Goal Master schema');
    const schemaWithoutToolExecutors: ArchitectureSchema = {
      ...baseSchema,
      roleSlots: baseSchema.roleSlots.map((slot) => (
        slot.id === 'implementer' || slot.id === 'verifier'
          ? { ...slot, slotType: 'participant' }
          : slot
      )),
    };
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master would finalize immediately. route_to(final-artifact, accepted)'
        : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Enforce one continuation before finalization.',
      executionMode: 'subagent_execution',
      schema: schemaWithoutToolExecutors,
      context: {
        maxArchitectureNodeVisits: 3,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecisions = semantic.filter((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecisions).toHaveLength(2);
    expect(goalDecisions[0]?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      response: expect.stringContaining('Runtime Goal Master guard required one visible continuation'),
    });
    expect(goalDecisions[0]?.data).toMatchObject({
      runtimeGuard: expect.stringContaining('Runtime Goal Master guard required one visible continuation'),
    });
    expect(goalDecisions[1]?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(semantic.filter((event) => event.nodeId === 'implementer' && event.type === 'participant_output')).toHaveLength(2);
    expect(semantic.filter((event) => event.nodeId === 'tester' && event.type === 'participant_output')).toHaveLength(2);
    expect(semantic.at(-1)?.type).toBe('final_artifact');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      type: 'architecture_event',
      label: expect.stringContaining('architecture_event:router_decision:goal-master'),
      data: expect.objectContaining({
        runtimeGuard: expect.stringContaining('Runtime Goal Master guard required one visible continuation'),
      }),
    }));
  });

  it('routes incomplete subagent results through runtime fallback instead of agent finalization', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Sub-agent stopped after 1 tool iteration without producing a final answer. Last assistant text before stopping: route_to(final-artifact, accepted)'
        : slot.slotType === 'tool_executor'
          ? `${slot.label} completed with vfs_read tool evidence.`
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        ...(slot.id === 'goal_master' ? { reasonCode: 'max_steps', ...routerData('final-artifact') } : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not finalize from incomplete subagent output.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      response: 'Subagent exhausted its tool loop without producing a final answer.',
    });
    expect(goalDecision?.data).toMatchObject({
      incompleteReason: 'Subagent exhausted its tool loop without producing a final answer.',
      runtimeGuard: 'Subagent exhausted its tool loop without producing a final answer.',
      selectedNodeIds: ['implementer'],
    });
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('does not treat Goal Master risk notes about another exhausted slot as its own incomplete result', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts the evidence. Verifier slot exhausted its tool loop without producing a final answer, but independent build evidence mitigates it. route_to(final-artifact, accepted)'
        : slot.slotType === 'tool_executor'
          ? `${slot.label} verified with fs_read and terminal_output tool evidence.`
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Finalize despite a mitigated exhausted verifier note.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route).toMatchObject({
      source: 'agent',
      selectedNodeIds: ['final-artifact'],
    });
    expect(goalDecision?.data?.runtimeGuard).toBeUndefined();
    expect(goalDecision?.data?.incompleteReason).toBeUndefined();
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('treats recoverable branch errors as incomplete even when the agent asks to finalize', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master degraded after recoverable runtime error: 429 Too Many Requests. route_to(final-artifact, accepted)'
        : slot.slotType === 'tool_executor'
          ? `${slot.label} completed with vfs_read tool evidence.`
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        ...(slot.id === 'goal_master'
          ? {
              errorCode: 'RATE_LIMITED',
              failure: {
                code: 'RATE_LIMITED',
                message: '429 Too Many Requests',
                retryable: true,
              },
              ...routerData('final-artifact'),
            }
          : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not finalize from degraded Goal Master output.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['implementer'],
      response: 'Recoverable runtime error prevented this node from producing a final answer.',
    });
    expect(goalDecision?.data).toMatchObject({
      incompleteReason: 'Recoverable runtime error prevented this node from producing a final answer.',
      runtimeGuard: 'Recoverable runtime error prevented this node from producing a final answer.',
      selectedNodeIds: ['implementer'],
    });
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('allows Goal Master finalization when tool executor proof is visible', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts visible tool proof. route_to(final-artifact, accepted)'
        : slot.slotType === 'tool_executor'
          ? `${slot.label} verified with vfs_list and vfs_read tool evidence.`
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Finalize when tool proof exists.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(goalDecision?.route?.source).toBe('agent');
    expect(goalDecision?.data?.runtimeGuard).toBeUndefined();
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('routes Goal Master back to implementation when external Playwright QA evidence is failing', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts visible tool proof. route_to(final-artifact, accepted)'
        : slot.slotType === 'tool_executor'
          ? `${slot.label} verified with vfs_list and vfs_read tool evidence.`
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not finalize while browser QA still has high findings.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 2,
        maxArchitectureSteps: 12,
        requireGoalMasterLoopProof: true,
        externalQualityGate: {
          source: 'playwright',
          status: 'failed',
          highFindings: 3,
          summary: 'Focus audit still finds offscreen footer links.',
        },
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) =>
      event.nodeId === 'goal-master'
      && event.type === 'router_decision'
      && typeof event.data?.['runtimeGuard'] === 'string'
      && event.data['runtimeGuard'].includes('playwright quality gate failed'));

    expect(goalDecision?.route?.selectedNodeIds).toEqual(['implementer']);
    expect(goalDecision?.route?.source).toBe('runtime_fallback');
    expect(goalDecision?.data?.runtimeGuard).toContain('playwright quality gate failed with 3 high finding(s)');
    expect(semantic.at(-1)?.type).not.toBe('final_artifact');
  });

  it('routes Goal Master to final artifact when external QA passed and tool proof is visible', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master asks for another implementation pass despite external QA. route_to(implementer, continue)'
        : slot.slotType === 'tool_executor'
          ? `${slot.label} verified with structured tool evidence.`
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        ...(slot.id === 'goal_master' ? routerData('implementer') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Finalize after external QA passed.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 2,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
        externalQualityGate: {
          source: 'external-build',
          status: 'passed',
          highFindings: 0,
          summary: 'Branch, sentinel file, and build passed.',
        },
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route).toMatchObject({
      source: 'runtime_fallback',
      selectedNodeIds: ['final-artifact'],
      response: expect.stringContaining('external-build quality gate passed'),
    });
    expect(goalDecision?.data?.runtimeGuard).toContain('external-build quality gate passed');
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('allows Goal Master finalization from structured write evidence even when the role summary omits tool names', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts structured implementation evidence. route_to(final-artifact, accepted)'
        : slot.slotType === 'tool_executor'
          ? `${slot.label} completed the assigned evidence step.`
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.slotType === 'tool_executor' ? { toolEvidence: toolEvidenceForSlot(slot.id) } : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Finalize from structured tool proof.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(goalDecision?.route?.source).toBe('agent');
    expect(goalDecision?.data?.runtimeGuard).toBeUndefined();
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('does not accept tool-name prose as Goal Master proof without structured tool evidence', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!baseSchema) throw new Error('Expected Goal Master schema');
    const schemaWithOneSpoofableToolSlot: ArchitectureSchema = {
      ...baseSchema,
      roleSlots: baseSchema.roleSlots.map((slot) => (
        slot.id === 'implementer' || slot.id === 'tester'
          ? { ...slot, slotType: 'participant' }
          : slot
      )),
    };
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts prose-only evidence. route_to(final-artifact, accepted)'
        : slot.id === 'verifier'
          ? 'Verifier says vfs_read and terminal_output were successful, but provides no structured proof.'
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'verifier'
          ? {
            toolEvidence: {
              toolCallCount: 1,
              toolResultCount: 1,
              toolNames: [],
              successfulToolNames: [],
              targetPaths: [],
            },
          }
          : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Reject prose-only proof.',
      executionMode: 'subagent_execution',
      schema: schemaWithOneSpoofableToolSlot,
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
      },
    });

    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: expect.objectContaining({
        code: 'CONTRACT_VIOLATION',
        source: 'architecture-graph-runtime',
        retryable: false,
        message: expect.stringContaining('verifier did not produce a successful read or terminal evidence result'),
      }),
    });
    expect(semanticEvents(service.getEvents(run.id)).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
    });
  });

  it('allows Goal Master finalization when host project file proof is visible', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      const toolNames = slot.id === 'implementer'
        ? ['fs_write']
        : slot.id === 'verifier'
          ? ['fs_read']
          : [];
      return {
        message: slot.id === 'goal_master'
          ? 'Goal Master accepts visible host project proof. route_to(final-artifact, accepted)'
          : slot.slotType === 'tool_executor'
            ? `${slot.label} completed with ${toolNames.join(' and ')} tool evidence.`
            : `${slot.label} branch prepared for: ${run.prompt}`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(toolNames.length > 0
            ? {
              toolEvidence: {
                toolCallCount: 1,
                toolResultCount: 1,
                toolNames,
                successfulToolNames: toolNames,
              },
            }
            : {}),
          ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Finalize when host file proof exists.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
      },
    });
    const semantic = semanticEvents(service.getEvents(run.id));
    const goalDecision = semantic.find((event) => event.nodeId === 'goal-master' && event.type === 'router_decision');

    expect(goalDecision?.route?.selectedNodeIds).toEqual(['final-artifact']);
    expect(goalDecision?.data?.runtimeGuard).toBeUndefined();
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('fails tool executor nodes that complete without tool evidence', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: `${slot.label} completed with prose only.`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Reject prose-only implementer.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });

    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: expect.objectContaining({
        code: 'CONTRACT_VIOLATION',
        source: 'architecture-graph-runtime',
        retryable: false,
        message: expect.stringContaining('completed without required tool evidence'),
      }),
    });
    expect(semanticEvents(service.getEvents(run.id)).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
    });
  });

  it('allows strict Implementer proof mode to continue when a downstream Implementer writes', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      const toolNames = slot.id === 'implementer'
        ? ['vfs_write']
        : slot.id === 'verifier'
          ? ['vfs_read']
          : [];
      return {
        message: slot.id === 'goal_master'
          ? 'Goal Master accepts. route_to(final-artifact, accepted)'
          : `${slot.label} completed${toolNames.length > 0 ? ` with ${toolNames.join(' and ')} tool evidence` : ' with prose only'}.`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(toolNames.length > 0
            ? {
              toolEvidence: {
                toolCallCount: 1,
                toolResultCount: 1,
                toolNames,
                successfulToolNames: toolNames,
                targetPaths: ['proof/goal-guard-proof.md'],
              },
            }
            : {}),
          ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Let Implementer provide write proof in Goal Guard proof mode.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
        requireImplementerWriteProof: true,
      },
    });

    const semantic = semanticEvents(service.getEvents(run.id));
    expect(semantic.some((event) => event.nodeId === 'implementer' && event.type === 'participant_output')).toBe(true);
    expect(semantic.at(-1)?.type).toBe('final_artifact');
  });

  it('still fails strict Implementer proof mode when there is no downstream Implementer', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('goal-master-delivery-loop');
    if (!baseSchema) {
      throw new Error('goal-master-delivery-loop seed schema missing');
    }
    const schema: ArchitectureSchema = {
      ...baseSchema,
      name: 'Two Agent Guard',
      description: 'Strict implementer proof without a implementer.',
      roleSlots: baseSchema.roleSlots.filter((slot) => (
        slot.id === 'implementer'
        || slot.id === 'goal_master'
        || slot.id === 'finalizer'
      )),
      nodes: baseSchema.nodes.filter((node) => (
        node.id === 'implementer'
        || node.id === 'goal-master'
        || node.id === 'final-artifact'
      )),
      edges: [
        { id: 'implementer-goal-master', fromNodeId: 'implementer', toNodeId: 'goal-master' },
        { id: 'goal-master-final', fromNodeId: 'goal-master', toNodeId: 'final-artifact', label: 'goal complete' },
      ],
    };

    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: `${slot.label} completed with prose only.`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      schema,
      prompt: 'Reject read-only Implementer in a two-agent proof flow.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 10,
        requireImplementerWriteProof: true,
      },
    });

    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: expect.objectContaining({
        code: 'CONTRACT_VIOLATION',
        source: 'architecture-graph-runtime',
        retryable: false,
        message: expect.stringContaining('implementer did not produce a successful write result'),
      }),
    });
    expect(semanticEvents(service.getEvents(run.id)).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
    });
  });

  it('fails Goal Guard proof mode when Implementer only reads files and never writes', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => {
      const toolNames = slot.id === 'implementer'
        ? ['fs_read']
        : slot.id === 'verifier'
          ? ['fs_read']
          : [];
      return {
        message: slot.id === 'goal_master'
          ? 'Goal Master accepts. route_to(final-artifact, accepted)'
          : `${slot.label} completed${toolNames.length > 0 ? ` with ${toolNames.join(' and ')} tool evidence` : ' with prose only'}.`,
        data: {
          branchSessionId,
          personaId,
          sessionPersonaId: personaId,
          rootSessionId: run.rootSessionId,
          slotType: slot.slotType,
          executionMode: run.executionMode,
          ...(toolNames.length > 0
            ? {
              toolEvidence: {
                toolCallCount: 1,
                toolResultCount: 1,
                toolNames,
                successfulToolNames: toolNames,
                targetPaths: ['src/App.tsx'],
              },
            }
            : {}),
          ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
        },
      };
    });

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Reject read-only Implementer in Goal Guard proof mode.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
        requireGoalMasterLoopProof: true,
      },
    });

    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
      failure: expect.objectContaining({
        code: 'CONTRACT_VIOLATION',
        source: 'architecture-graph-runtime',
        retryable: false,
        message: expect.stringContaining('implementer did not produce a successful write result'),
      }),
    });
    expect(semanticEvents(service.getEvents(run.id)).at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run failed.',
      status: 'failed',
      errorCode: 'CONTRACT_VIOLATION',
    });
  });

  it('uses an inline draft schema for run graph projections without changing the registry schema', async () => {
    const { service } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    if (!baseSchema) throw new Error('Expected seeded schema');
    const draftSchema = {
      ...baseSchema,
      nodes: [
        ...baseSchema.nodes,
        { id: 'custom-review', label: 'Custom Review', kind: 'role' as const, roleSlotId: 'analyst', x: 520, y: 420 },
      ],
      edges: [
        ...baseSchema.edges,
        { id: 'custom-review-router', fromNodeId: 'custom-review', toNodeId: 'router' },
      ],
    };

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run unsaved draft graph.',
      schema: draftSchema,
    });

    expect(service.getGraph(run.id)?.nodes.find((node) => node.id === 'custom-review')?.label).toBe('Custom Review');
    expect(service.getGraph(run.id)?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-review-router', fromNodeId: 'custom-review', toNodeId: 'router' }),
    ]));
    expect(new ArchitectureRegistryService().findOne('strategic-decision-council')?.nodes.some((node) => node.id === 'custom-review')).toBe(false);
  });

  it('translates imported persona aliases before creating branch sessions and executing roles', async () => {
    const { service, executor, sessions } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots
      .filter((slot) => ['pragmatist', 'finalizer'].includes(slot.id))
      .map((slot) => ({
        ...slot,
        defaultPersonaId: slot.id === 'pragmatist' ? 'persona.pragmatist' : 'persona.adr_writer',
      }));
    const schema: ArchitectureSchema = {
      ...baseSchema,
      id: 'imported-persona-aliases',
      name: 'Imported Persona Aliases',
      roleSlots,
      nodes: [
        { id: 'reader', label: 'Reader', kind: 'role', roleSlotId: 'pragmatist' },
        { id: 'artifact', label: 'Artifact', kind: 'artifact', roleSlotId: 'finalizer', behavior: { mode: 'finalize' } },
      ],
      edges: [
        { id: 'reader-artifact', fromNodeId: 'reader', toNodeId: 'artifact' },
      ],
    };

    await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run imported aliases.',
      executionMode: 'subagent_execution',
      schema,
    });

    expect(sessions.created.find((entry) => entry.id.endsWith('-pragmatist'))?.dto.personaId).toBe('dev');
    expect(sessions.created.find((entry) => entry.id.endsWith('-finalizer'))?.dto.personaId).toBe('dev');
    expect(vi.mocked(executor.execute).mock.calls.map((call) => call[0].personaId)).toEqual(expect.arrayContaining(['dev']));
  });

  it('rejects malformed run input before creating chat sessions', async () => {
    const { service, sessions } = createService();

    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: null,
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with invalid overrides.',
      slotOverrides: { pragmatist: 123 },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with invalid context.',
      context: [],
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with invalid mode.',
      executionMode: 'live',
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with invalid inline schema.',
      schema: { id: 'bad' },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with invalid inline schema entries.',
      schema: {
        ...baseSchema,
        roleSlots: [null],
      },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with invalid inline node behavior.',
      schema: {
        ...baseSchema,
        nodes: [{ ...baseSchema.nodes[0], behavior: { mode: 'fork_magic' } }],
      },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with unknown slot override.',
      slotOverrides: { unknown_slot: 'persona.shadow_override' },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with non-overridable slot.',
      schema: {
        ...baseSchema,
        id: 'slot-lock-test',
        roleSlots: baseSchema.roleSlots.map((slot) => slot.id === 'router'
          ? { ...slot, canOverrideAtRunStart: false }
          : slot),
      } as unknown as ArchitectureSchema,
      slotOverrides: { router: 'persona.security_router' },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with role node routing behavior.',
      schema: {
        ...baseSchema,
        nodes: [{ ...baseSchema.nodes[1], behavior: { mode: 'rank_then_merge' } }],
      },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with role node missing slot.',
      schema: {
        ...baseSchema,
        nodes: [{ id: 'unbound-role', label: 'Unbound Role', kind: 'role' }],
      },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with invalid edge selection metadata.',
      schema: {
        ...baseSchema,
        edges: [
          ...baseSchema.edges,
          {
            id: 'bad-edge-selection',
            fromNodeId: 'router',
            toNodeId: 'final-artifact',
            selection: 'legacy',
          },
        ],
      },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    await expect(service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Run with an edge pointing at a missing node.',
      schema: {
        ...baseSchema,
        edges: [{ id: 'bad-edge', fromNodeId: 'parallel-deliberation', toNodeId: 'missing-node' }],
      },
    } as unknown as CreateArchitectureRunDto)).rejects.toThrow(BadRequestException);
    expect(sessions.createWithId).not.toHaveBeenCalled();
  });

  it('marks graph nodes complete only from exact node execution evidence', async () => {
    const { service, executor } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const roleSlots = baseSchema.roleSlots.filter((slot) => ['pragmatist', 'router', 'finalizer'].includes(slot.id));
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, node, personaId, run, slot }) => ({
      message: `${slot.label} response for ${node?.id ?? 'unknown'}`,
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(node?.id === 'agent-1' ? routerData('router-1') : {}),
      },
    }));
    const schema: ArchitectureSchema = {
      ...baseSchema,
      id: 'shared-slot-projection',
      name: 'Shared Slot Projection',
      roleSlots,
      nodes: [
        { id: 'agent-1', label: 'Agent 1', kind: 'role', roleSlotId: 'pragmatist' },
        { id: 'unused-agent', label: 'Unused Agent', kind: 'role', roleSlotId: 'pragmatist' },
        {
          id: 'router-1',
          label: 'Router 1',
          kind: 'router',
          roleSlotId: 'router',
          behavior: { mode: 'rank_then_merge' },
        },
        { id: 'artifact', label: 'Artifact', kind: 'artifact', roleSlotId: 'finalizer', behavior: { mode: 'finalize' } },
      ],
      edges: [
        { id: 'agent-1-unused-agent', fromNodeId: 'agent-1', toNodeId: 'unused-agent' },
        { id: 'agent-1-router-1', fromNodeId: 'agent-1', toNodeId: 'router-1' },
        { id: 'router-1-artifact', fromNodeId: 'router-1', toNodeId: 'artifact' },
      ],
    };

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Do not complete unused shared-slot nodes.',
      schema,
    });

    const graph = service.getGraph(run.id);
    expect(graph?.nodes.find((node) => node.id === 'agent-1')).toMatchObject({ status: 'completed' });
    expect(graph?.nodes.find((node) => node.id === 'unused-agent')).toMatchObject({
      status: 'pending',
      eventIds: [],
    });
  });

  it('synthesizes no-finalizer artifact nodes from incoming graph outputs', async () => {
    const { service, executor } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: 'Auditor inspected App.tsx and README.md. Next safest step is wiring the existing logo into MainMenu.tsx.',
      data: {
        branchSessionId,
        personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      },
    }));
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const schema: ArchitectureSchema = {
      ...baseSchema,
      id: 'no-finalizer-artifact',
      name: 'No Finalizer Artifact',
      roleSlots: baseSchema.roleSlots.filter((slot) => slot.id === 'pragmatist'),
      nodes: [
        { id: 'auditor', label: 'Auditor', kind: 'role', roleSlotId: 'pragmatist' },
        { id: 'artifact', label: 'Final Artifact', kind: 'artifact', behavior: { mode: 'finalize' } },
      ],
      edges: [
        { id: 'auditor-artifact', fromNodeId: 'auditor', toNodeId: 'artifact' },
      ],
    };

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Surface incoming output in final artifact.',
      schema,
    });
    const finalEvent = service.getEvents(run.id).find((event) => event.type === 'final_artifact');

    expect(finalEvent?.message).toContain('From pragmatist:');
    expect(finalEvent?.message).toContain('Next safest step is wiring the existing logo into MainMenu.tsx.');
    expect(service.getChat(run.id)?.messages.at(-1)?.content).toContain('MainMenu.tsx');
  });

  it('falls back to default artifact synthesis message when no qualifying upstream outputs exist', async () => {
    const { service } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const schema: ArchitectureSchema = {
      ...baseSchema,
      id: 'artifact-no-upstream-events',
      name: 'Artifact Without Upstream Outputs',
      nodes: [
        { id: 'artifact', label: 'Final Artifact', kind: 'artifact', behavior: { mode: 'finalize' } },
      ],
      edges: [],
    };

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Use fallback synthesis text when no upstream output exists.',
      schema,
    });
    const finalEvent = service.getEvents(run.id).find((event) => event.type === 'final_artifact');

    expect(finalEvent?.message).toBe('Final Artifact synthesized from graph execution.');
    expect(service.getChat(run.id)?.messages.at(-1)?.content).toBe('Final Artifact synthesized from graph execution.');
  });

  it('includes router output in synthesized no-finalizer artifact message', async () => {
    const { service } = createService();
    const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
    const schema: ArchitectureSchema = {
      ...baseSchema,
      id: 'artifact-with-router-output',
      name: 'Artifact With Router Output',
      nodes: [
        {
          id: 'router',
          label: 'Router',
          kind: 'router',
          behavior: { mode: 'choose_one' },
        },
        { id: 'artifact', label: 'Final Artifact', kind: 'artifact', behavior: { mode: 'finalize' } },
      ],
      edges: [
        { id: 'router-artifact', fromNodeId: 'router', toNodeId: 'artifact' },
      ],
    };

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Surface router output in synthesized artifact.',
      schema,
    });
    const finalEvent = service.getEvents(run.id).find((event) => event.type === 'final_artifact');
    const fromRouterSections = finalEvent?.message.match(/From router:/g) ?? [];

    expect(finalEvent?.message).toContain('From router:');
    expect(finalEvent?.message).toContain('Router selected Final Artifact.');
    expect(fromRouterSections).toHaveLength(2);
    expect(service.getChat(run.id)?.messages.at(-1)?.content).toContain('Router selected Final Artifact.');
  });

  it('returns null projections for unknown runs', () => {
    const { service } = createService();

    expect(service.findRun('missing')).toBeNull();
    expect(service.getGraph('missing')).toBeNull();
    expect(service.getChat('missing')).toBeNull();
  });

  it('warns and returns null when durable graph reconstruction times out', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const { service, sessions } = createService();
      sessions.list.mockImplementation(() => new Promise(() => {}));

      const graphPromise = service.getGraphDurable('stalled-graph-run');
      await vi.advanceTimersByTimeAsync(1500);

      await expect(graphPromise).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('persisted architecture graph recovery timed out after 1500ms'),
      );
    } finally {
      warnSpy.mockRestore();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('recovers completed architecture run projections from audit rows after runtime memory is gone', async () => {
    const { service, audit } = createService();
    const createdAt = 1_779_999_000_000;
    audit.listEntries.mockResolvedValue([
      auditRow({
        id: 'audit-1',
        createdAt,
        label: 'architecture_event:run_created:runtime',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId: 'durable-run',
          architectureRunId: 'durable-run',
          schemaId: 'five-minds-council',
          executionMode: 'subagent_execution',
          eventId: 'durable-run:event:1',
          eventType: 'run_created',
          sequence: 1,
          messagePreview: 'Architecture run created for: Verify durable reopen.',
        },
      }),
      auditRow({
        id: 'audit-2',
        createdAt: createdAt + 1,
        label: 'architecture_event:participant_output:analyst',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId: 'durable-run',
          architectureRunId: 'durable-run',
          schemaId: 'five-minds-council',
          executionMode: 'subagent_execution',
          eventId: 'durable-run:event:2',
          eventType: 'participant_output',
          sequence: 2,
          nodeId: 'analyst',
          roleSlotId: 'analyst',
          messagePreview: 'Analyst found evidence in src/App.tsx.',
          route: {
            source: 'runtime_fallback',
            fromNodeId: 'analyst',
            selectedNodeIds: ['synthesizer'],
            nextNodeId: 'synthesizer',
          },
        },
      }),
      auditRow({
        id: 'audit-3',
        createdAt: createdAt + 2,
        label: 'architecture_event:final_artifact:final-artifact',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId: 'durable-run',
          architectureRunId: 'durable-run',
          schemaId: 'five-minds-council',
          executionMode: 'subagent_execution',
          eventId: 'durable-run:event:3',
          eventType: 'final_artifact',
          sequence: 3,
          nodeId: 'final-artifact',
          roleSlotId: 'finalizer',
          messagePreview: 'Final answer preserved from audit.',
        },
      }),
      auditRow({
        id: 'audit-4',
        createdAt: createdAt + 3,
        label: 'architecture:five-minds-council:durable-run',
        type: 'tool_result',
        data: {
          domain: 'architecture',
          kind: 'architecture_runtime',
          runId: 'durable-run',
          schemaId: 'five-minds-council',
          executionMode: 'subagent_execution',
          rootSessionId: 'arch-durable-run-root',
          branchSessionIds: { analyst: 'arch-durable-run-analyst' },
          eventCount: 3,
        },
      }),
    ]);

    await expect(service.findRunDurable('durable-run')).resolves.toMatchObject({
      id: 'durable-run',
      schemaId: 'five-minds-council',
      prompt: 'Verify durable reopen.',
      status: 'completed',
      rootSessionId: 'arch-durable-run-root',
      branchSessionIds: { analyst: 'arch-durable-run-analyst' },
    });
    await expect(service.getEventsDurable('durable-run')).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'durable-run:event:2',
        type: 'participant_output',
        roleSlotId: 'analyst',
        message: 'Analyst found evidence in src/App.tsx.',
      }),
      expect.objectContaining({
        id: 'durable-run:event:3',
        type: 'final_artifact',
        roleSlotId: 'finalizer',
        message: 'Final answer preserved from audit.',
      }),
    ]));
    await expect(service.getChatDurable('durable-run')).resolves.toMatchObject({
      runId: 'durable-run',
      messages: expect.arrayContaining([
        expect.objectContaining({
          speaker: 'participant',
          content: 'Analyst found evidence in src/App.tsx.',
          action: 'participant_completed',
          detail: 'Ready for synthesizer.',
        }),
        expect.objectContaining({
          speaker: 'finalizer',
          content: 'Final answer preserved from audit.',
          action: 'finalizer_completed',
          detail: 'Final answer ready.',
        }),
      ]),
    });
    await expect(service.getGraphDurable('durable-run')).resolves.toMatchObject({
      runId: 'durable-run',
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'analyst', status: 'completed' }),
        expect.objectContaining({ id: 'final-artifact', status: 'completed' }),
      ]),
    });
  });

  it('reconstructs failed architecture runs from max-step guard audit rows after runtime memory is gone', async () => {
    const { service, audit } = createService();
    const runId = 'durable-failed-run';
    const createdAt = 1_780_002_000_000;
    audit.listEntries.mockResolvedValue([
      auditRow({
        id: 'audit-1',
        createdAt,
        label: 'architecture_event:run_created:runtime',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:1`,
          eventType: 'run_created',
          sequence: 1,
          messagePreview: 'Architecture run created for: Stop after max steps.',
        },
      }),
      auditRow({
        id: 'audit-2',
        createdAt: createdAt + 1,
        label: 'architecture_event:participant_output:analyst',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:2`,
          eventType: 'participant_output',
          sequence: 2,
          nodeId: 'analyst',
          roleSlotId: 'analyst',
          messagePreview: 'Analyst gathered evidence from src/App.tsx.',
          route: {
            source: 'agent',
            fromNodeId: 'analyst',
            selectedNodeIds: ['router'],
            nextNodeId: 'router',
          },
        },
      }),
      auditRow({
        id: 'audit-3',
        createdAt: createdAt + 2,
        label: 'architecture_event:router_decision:router',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:3`,
          eventType: 'router_decision',
          sequence: 3,
          nodeId: 'router',
          roleSlotId: 'router',
          reasonCode: 'max_steps',
          messagePreview: 'Runtime stopped after 5 graph steps.',
          route: {
            source: 'runtime_fallback',
            fromNodeId: 'router',
            selectedNodeIds: ['analyst'],
            nextNodeId: 'analyst',
          },
        },
      }),
      auditRow({
        id: 'audit-4',
        createdAt: createdAt + 3,
        label: 'architecture:strategic-decision-council:durable-failed-run',
        type: 'tool_result',
        data: {
          domain: 'architecture',
          kind: 'architecture_runtime',
          runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          rootSessionId: `arch-${runId}-root`,
          branchSessionIds: { analyst: `arch-${runId}-analyst` },
          eventCount: 3,
        },
      }),
    ]);

    await expect(service.findRunDurable(runId)).resolves.toMatchObject({
      id: runId,
      schemaId: 'strategic-decision-council',
      prompt: 'Stop after max steps.',
      status: 'failed',
      rootSessionId: `arch-${runId}-root`,
      branchSessionIds: { analyst: `arch-${runId}-analyst` },
    });
    await expect(service.getChatDurable(runId)).resolves.toMatchObject({
      runId,
      messages: expect.arrayContaining([
        expect.objectContaining({
          speaker: 'router',
          content: 'Runtime stopped after 5 graph steps.',
        }),
      ]),
    });
    await expect(service.getGraphDurable(runId)).resolves.toMatchObject({
      runId,
      status: 'failed',
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'analyst', status: 'completed' }),
        expect.objectContaining({ id: 'router', status: 'pending' }),
      ]),
    });
  });

  it('reconstructs cancelled architecture runs from stop audit rows after runtime memory is gone', async () => {
    const { service, audit } = createService();
    const runId = 'durable-cancelled-run';
    const createdAt = 1_780_003_000_000;
    audit.listEntries.mockResolvedValue([
      auditRow({
        id: 'audit-1',
        createdAt,
        label: 'architecture_event:run_created:runtime',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:1`,
          eventType: 'run_created',
          sequence: 1,
          messagePreview: 'Architecture run created for: Cancel durable replay.',
        },
      }),
      auditRow({
        id: 'audit-2',
        createdAt: createdAt + 1,
        label: 'architecture_event:participant_output:analyst',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:2`,
          eventType: 'participant_output',
          sequence: 2,
          nodeId: 'analyst',
          roleSlotId: 'analyst',
          messagePreview: 'Analyst started work before cancellation.',
        },
      }),
      auditRow({
        id: 'audit-3',
        createdAt: createdAt + 2,
        label: 'architecture_event:run_stopped:runtime',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:3`,
          eventType: 'run_stopped',
          sequence: 3,
          messagePreview: 'Architecture run stopped by user.',
        },
      }),
      auditRow({
        id: 'audit-4',
        createdAt: createdAt + 3,
        label: 'architecture:strategic-decision-council:durable-cancelled-run',
        type: 'tool_result',
        data: {
          domain: 'architecture',
          kind: 'architecture_runtime',
          runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          rootSessionId: `arch-${runId}-root`,
          branchSessionIds: { analyst: `arch-${runId}-analyst` },
          eventCount: 3,
        },
      }),
    ]);

    await expect(service.findRunDurable(runId)).resolves.toMatchObject({
      id: runId,
      status: 'cancelled',
      rootSessionId: `arch-${runId}-root`,
    });
    await expect(service.getGraphDurable(runId)).resolves.toMatchObject({
      runId,
      status: 'cancelled',
    });
    await expect(service.getChatDurable(runId)).resolves.toMatchObject({
      runId,
      messages: expect.arrayContaining([
        expect.objectContaining({ speaker: 'system', content: 'Architecture run stopped by user.' }),
      ]),
    });
  });

  it('REGRESSION: reconstructs a resumed run as running when newer audit activity exists after run_stopped', async () => {
    const { service, audit } = createService();
    const runId = 'durable-resumed-run';
    const createdAt = 1_780_004_000_000;
    audit.listEntries.mockResolvedValue([
      auditRow({
        id: 'audit-1',
        createdAt,
        label: 'architecture_event:run_created:runtime',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:1`,
          eventType: 'run_created',
          sequence: 1,
          messagePreview: 'Architecture run created for: Resume after stop.',
        },
      }),
      auditRow({
        id: 'audit-2',
        createdAt: createdAt + 1,
        label: 'architecture_event:run_stopped:runtime',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:2`,
          eventType: 'run_stopped',
          sequence: 2,
          messagePreview: 'Architecture run stopped by user.',
        },
      }),
      auditRow({
        id: 'audit-3',
        createdAt: createdAt + 2,
        label: 'architecture_event:participant_output:analyst',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:3`,
          eventType: 'participant_output',
          sequence: 3,
          nodeId: 'analyst',
          roleSlotId: 'analyst',
          messagePreview: 'Resume picked up the analyst branch again.',
        },
      }),
      auditRow({
        id: 'audit-4',
        createdAt: createdAt + 3,
        label: `architecture:strategic-decision-council:${runId}`,
        type: 'tool_result',
        data: {
          domain: 'architecture',
          kind: 'architecture_runtime',
          runId,
          schemaId: 'strategic-decision-council',
          executionMode: 'subagent_execution',
          rootSessionId: `arch-${runId}-root`,
          branchSessionIds: { analyst: `arch-${runId}-analyst` },
          eventCount: 3,
        },
      }),
    ]);

    await expect(service.findRunDurable(runId)).resolves.toMatchObject({
      id: runId,
      status: 'running',
      rootSessionId: `arch-${runId}-root`,
    });
  });

  it('returns a live graph without legacy persisted child-agent reconstruction when the schema cannot spawn CLI children', async () => {
    const { service, executor, sessions } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'router'
        ? 'Router selected the final artifact path.'
        : slot.id === 'finalizer'
          ? 'Finalizer produced the concise project assessment.'
          : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'router' ? routerData('final-artifact') : {}),
      },
    }));
    sessions.list.mockRejectedValue(new Error('legacy reconstruction should not run for this live graph'));

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Assess the project architecture without CLI child agents.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });

    const graph = await service.getGraphDurable(run.id);

    expect(graph).toMatchObject({
      runId: run.id,
      status: 'completed',
      childAgents: [],
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'final-artifact', status: 'completed' }),
      ]),
    });
    expect(sessions.list).not.toHaveBeenCalled();
  });

  it('prefers audit-event node state while overlaying persisted CLI child agents', async () => {
    const { service, audit, sessions } = createService();
    const runId = 'durable-cli-running-run';
    const createdAt = 1_780_001_000_000;
    const toolCallId = `architecture:${runId}:${runId}:event:4`;
    const persistedMessages: ChatMessage[] = [
      {
        id: `architecture:${runId}:user`,
        sessionId: `arch-${runId}-implementer`,
        role: 'user',
        content: 'Architecture: Goal Master Delivery Loop v0.1.0\nSlot: Implementer\nTask: create project.',
        createdAt,
      },
      {
        id: `architecture:${runId}:tool-calls`,
        sessionId: `arch-${runId}-implementer`,
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: toolCallId,
          name: 'spawn_cli_agent',
          args: {
            architectureRunId: runId,
            schemaId: 'goal-master-delivery-loop',
            nodeId: 'implementer',
            roleSlotId: 'implementer',
            agentId: 'copilot',
            workdir: 'C:\\Projekty\\TurboProject2',
            expectedChangedFiles: ['src/App.tsx'],
          },
        }],
        createdAt: createdAt + 1,
      },
      {
        id: `architecture:${runId}:tool-result`,
        sessionId: `arch-${runId}-implementer`,
        role: 'tool_result',
        toolCallId,
        content: JSON.stringify({
          childSessionId: 'cli-child-running',
          agentId: 'copilot',
          status: 'running',
          workdir: 'C:\\Projekty\\TurboProject2',
        }),
        createdAt: createdAt + 2,
      },
    ];
    sessions.list.mockResolvedValue([{
      id: `arch-${runId}-implementer`,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch',
        architectureContext: { architectureRunId: runId },
      },
    }]);
    sessions.getMessages.mockResolvedValue(persistedMessages);
    audit.listEntries.mockResolvedValue([
      auditRow({
        id: 'audit-1',
        createdAt,
        label: 'architecture_event:run_created:runtime',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'goal-master-delivery-loop',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:1`,
          eventType: 'run_created',
          sequence: 1,
          messagePreview: 'Architecture run created for: create project.',
        },
      }),
      auditRow({
        id: 'audit-2',
        createdAt: createdAt + 1,
        label: 'architecture_event:participant_output:implementer',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'goal-master-delivery-loop',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:2`,
          eventType: 'participant_output',
          sequence: 2,
          nodeId: 'implementer',
          roleSlotId: 'implementer',
          messagePreview: 'Implementer prepared the React/Vite/Tailwind plan and file map.',
          route: {
            source: 'runtime_fallback',
            fromNodeId: 'implementer',
            selectedNodeIds: ['verifier'],
            nextNodeId: 'verifier',
          },
        },
      }),
      auditRow({
        id: 'audit-3',
        createdAt: createdAt + 2,
        label: 'architecture_event:participant_output:implementer',
        data: {
          domain: 'architecture',
          kind: 'architecture_event',
          runId,
          architectureRunId: runId,
          schemaId: 'goal-master-delivery-loop',
          executionMode: 'subagent_execution',
          eventId: `${runId}:event:3`,
          eventType: 'participant_output',
          sequence: 3,
          nodeId: 'implementer',
          roleSlotId: 'implementer',
          messagePreview: 'Implementer delegated host writes to a running Copilot CLI child.',
          incompleteReason: 'CLI child cli-child-running is still running',
        },
      }),
      auditRow({
        id: 'audit-4',
        createdAt: createdAt + 3,
        label: `architecture:goal-master-delivery-loop:${runId}`,
        type: 'tool_result',
        data: {
          domain: 'architecture',
          kind: 'architecture_runtime',
          runId,
          schemaId: 'goal-master-delivery-loop',
          executionMode: 'subagent_execution',
          rootSessionId: `arch-${runId}-root`,
          branchSessionIds: { implementer: `arch-${runId}-implementer` },
          eventCount: 3,
        },
      }),
    ]);

    const graph = await service.getGraphDurable(runId);

    expect(graph).toMatchObject({
      runId,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'implementer',
          status: 'completed',
          incompleteReason: 'CLI child cli-child-running is still running',
        }),
      ]),
      childAgents: [expect.objectContaining({
        id: 'cli-child-running',
        parentNodeId: 'implementer',
        parentRoleSlotId: 'implementer',
        kind: 'cli-agent',
        backend: 'copilot',
        status: 'running',
        toolName: 'spawn_cli_agent',
        workdir: 'C:\\Projekty\\TurboProject2',
        targetPaths: ['src/App.tsx'],
      })],
    });
  });

  it('does not let persisted child-agent projections erase live parent metadata', async () => {
    const { service, executor, sessions } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'implementer'
        ? 'Implementer delegated to an existing CLI child and inspected status.'
        : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-overlay', 'completed') }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Keep live child-agent graph metadata.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    sessions.list.mockResolvedValue([{ id: `arch-${run.id}-implementer` }]);
    sessions.getMessages.mockResolvedValue([
      {
        id: `architecture:${run.id}:user`,
        sessionId: `arch-${run.id}-implementer`,
        role: 'user',
        content: 'Architecture: Goal Master Delivery Loop v0.1.0\nSlot: Implementer\nTask: Keep live child-agent graph metadata.',
        createdAt: run.createdAt,
      },
      {
        id: `architecture:${run.id}:tool-calls`,
        sessionId: `arch-${run.id}-implementer`,
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: `architecture:${run.id}:status`,
          name: 'get_cli_agent_status',
          args: {
            architectureRunId: run.id,
            childSessionId: 'cli-child-overlay',
          },
        }],
        createdAt: run.createdAt + 1,
      },
      {
        id: `architecture:${run.id}:tool-result`,
        sessionId: `arch-${run.id}-implementer`,
        role: 'tool_result',
        toolCallId: `architecture:${run.id}:status`,
        content: JSON.stringify({
          childSessionId: 'cli-child-overlay',
          status: 'running',
        }),
        createdAt: run.createdAt + 2,
      },
    ] satisfies ChatMessage[]);

    const graph = await service.getGraphDurable(run.id);

    expect(graph?.childAgents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'cli-child-overlay',
        parentNodeId: 'implementer',
        parentRoleSlotId: 'implementer',
        backend: 'copilot',
        status: 'completed',
        workdir: 'C:\\Projekty\\TurboProject2',
        targetPaths: ['C:\\Projekty\\TurboProject2\\src\\App.tsx'],
      }),
    ]));
  });

  it('does not project architecture branch subagent results as CLI child agents', async () => {
    const { service, executor, sessions } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'goal_master'
        ? 'Goal Master accepts the evidence. route_to(final-artifact, accepted)'
        : slot.id === 'implementer'
          ? 'Implementer completed with fs_write tool evidence.'
          : slot.id === 'verifier' || slot.id === 'tester'
            ? `${slot.label} completed with fs_read tool evidence.`
            : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'implementer'
          ? { toolEvidence: toolEvidenceForSlot(slot.id) }
          : (slot.id === 'verifier' || slot.id === 'tester')
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
        ...(slot.id === 'goal_master' ? routerData('final-artifact') : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Do not project architecture branches as CLI children.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    sessions.list.mockResolvedValue([{ id: `arch-${run.id}-implementer` }]);
    sessions.getMessages.mockResolvedValue([{
      id: `architecture:${run.id}:branch-result`,
      sessionId: `arch-${run.id}-implementer`,
      role: 'tool_result',
      toolCallId: `architecture:${run.id}:implementer`,
      content: JSON.stringify({
        childSessionId: `arch-${run.id}-implementer`,
        parentSessionId: `arch-${run.id}-root`,
        taskId: 'task-implementer',
        vfsMode: 'shared',
      }),
      createdAt: run.createdAt + 1,
    }] satisfies ChatMessage[]);

    const graph = await service.getGraphDurable(run.id);

    expect(graph?.childAgents?.map((child) => child.id)).not.toContain(`arch-${run.id}-implementer`);
  });

  it('does not let persisted running status overwrite a live completed CLI child status', async () => {
    const { service, executor, sessions } = createService();
    vi.mocked(executor.execute).mockImplementation(async ({ branchSessionId, personaId, run, slot }) => ({
      message: slot.id === 'implementer'
        ? 'Implementer delegated to a CLI child that completed successfully.'
        : `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
        ...(slot.id === 'implementer'
          ? { toolEvidence: cliChildToolEvidence('cli-child-reconciled', 'completed') }
          : slot.slotType === 'tool_executor'
            ? { toolEvidence: toolEvidenceForSlot(slot.id) }
            : {}),
      },
    }));

    const run = await service.createRun({
      schemaId: 'goal-master-delivery-loop',
      prompt: 'Keep terminal child-agent status after durable overlay.',
      executionMode: 'subagent_execution',
      context: {
        maxArchitectureNodeVisits: 1,
        maxArchitectureSteps: 20,
      },
    });
    sessions.list.mockResolvedValue([{ id: `arch-${run.id}-implementer` }]);
    sessions.getMessages.mockResolvedValue([
      {
        id: `architecture:${run.id}:tool-calls`,
        sessionId: `arch-${run.id}-implementer`,
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: `architecture:${run.id}:status`,
          name: 'get_cli_agent_status',
          args: {
            architectureRunId: run.id,
            childSessionId: 'cli-child-reconciled',
          },
        }],
        createdAt: run.createdAt + 1,
      },
      {
        id: `architecture:${run.id}:tool-result`,
        sessionId: `arch-${run.id}-implementer`,
        role: 'tool_result',
        toolCallId: `architecture:${run.id}:status`,
        content: JSON.stringify({
          childSessionId: 'cli-child-reconciled',
          status: 'running',
        }),
        createdAt: run.createdAt + 2,
      },
    ] satisfies ChatMessage[]);

    const graph = await service.getGraphDurable(run.id);

    expect(graph?.childAgents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'cli-child-reconciled',
        status: 'completed',
      }),
    ]));
  });
});

function auditRow(params: {
  id: string;
  label: string;
  data: Record<string, unknown>;
  createdAt: number;
  type?: AuditLogEntry['type'];
}): AuditLogEntry {
  return {
    id: params.id,
    sessionId: 'arch-durable-run-root',
    type: params.type ?? 'architecture_event',
    label: params.label,
    data: params.data,
    durationMs: null,
    chunkCount: null,
    createdAt: params.createdAt,
  };
}

function createService(options: {
  cliConfigs?: Record<string, { enabled: boolean; model?: string; architecturePreference?: string }>;
  sessionById?: Record<string, ChatSession>;
} = {}): {
  service: ArchitectureRuntimeService;
  executor: ArchitectureRoleExecutor;
  sessions: Pick<SessionsService, 'createWithId' | 'list' | 'getMessages' | 'get'> & {
    created: Array<{ id: string; dto: CreateSessionDto }>;
    list: ReturnType<typeof vi.fn>;
    getMessages: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
  sessionManager: Pick<SessionManagerService, 'persistMessage'> & {
    persistMessage: ReturnType<typeof vi.fn>;
  };
  audit: Pick<AuditService, 'log' | 'listEntries'> & {
    log: ReturnType<typeof vi.fn>;
    listEntries: ReturnType<typeof vi.fn>;
  };
  vfs: Pick<VFSService, 'copySessionFiles' | 'listFiles' | 'readBinary' | 'writeBinary'> & {
    copySessionFiles: ReturnType<typeof vi.fn>;
    listFiles: ReturnType<typeof vi.fn>;
    readBinary: ReturnType<typeof vi.fn>;
    writeBinary: ReturnType<typeof vi.fn>;
  };
} {
  const created: Array<{ id: string; dto: CreateSessionDto }> = [];
  const sessions = {
    created,
    createWithId: vi.fn(async (id: string, dto: CreateSessionDto): Promise<ChatSession> => {
      created.push({ id, dto });
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
    list: vi.fn().mockResolvedValue([]),
    getMessages: vi.fn().mockResolvedValue([]),
    get: vi.fn(async (id: string): Promise<ChatSession> => {
      const explicit = options.sessionById?.[id];
      if (explicit) {
        return explicit;
      }
      const createdSession = created.find((entry) => entry.id === id);
      if (createdSession) {
        const now = Date.now();
        return {
          id,
          personaId: createdSession.dto.personaId ?? 'default',
          title: createdSession.dto.title ?? 'New Chat',
          kind: createdSession.dto.kind ?? 'chat',
          parentSessionId: createdSession.dto.parentSessionId,
          parentTurnId: createdSession.dto.parentTurnId,
          parentToolCallId: createdSession.dto.parentToolCallId,
          runtimeContext: createdSession.dto.runtimeContext,
          createdAt: now,
          updatedAt: now,
        };
      }
      throw new Error(`Session not found: ${id}`);
    }),
  };
  const executor: ArchitectureRoleExecutor = {
    execute: vi.fn(async ({ branchSessionId, personaId, run, slot }) => ({
      message: `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      },
    })),
  };
  const sessionManager = {
    persistMessage: vi.fn().mockResolvedValue(undefined),
  };
  const audit = {
    log: vi.fn().mockResolvedValue('audit-id'),
    listEntries: vi.fn().mockResolvedValue([]),
  };
  const vfs = {
    copySessionFiles: vi.fn(() => []),
    listFiles: vi.fn((sessionId: string) => ({
      sessionId,
      files: [
        { sessionId, path: 'README.md', sizeBytes: 8, updatedAt: 1 },
        { sessionId, path: 'package.json', sizeBytes: 8, updatedAt: 1 },
      ],
    })),
    readBinary: vi.fn(() => Buffer.from('hydrated')),
    writeBinary: vi.fn(),
  };
  const cliAgentConfig = options.cliConfigs
    ? {
        getConfig: vi.fn(async (agentId: string) => ({
          enabled: true,
          cliPath: '',
          timeoutMs: 900_000,
          hardTimeoutEnabled: false,
          hardTimeoutMs: 3_600_000,
          autoRecoveryEnabled: false,
          autoRecoveryPrompt: 'continue',
          maxOutputChars: 16_000,
          model: '',
          architecturePreference: '',
          extraArgs: [],
          ...(options.cliConfigs?.[agentId] ?? {}),
        })),
      }
    : undefined;
  return {
    service: new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions as unknown as SessionsService,
      sessionManager as unknown as SessionManagerService,
      executor,
      audit as unknown as AuditService,
      vfs as unknown as VFSService,
      cliAgentConfig,
      new RuntimeAuditLogger(audit as unknown as AuditService),
    ),
    executor,
    sessions,
    sessionManager,
    audit,
    vfs,
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 100): Promise<void> {
  const startedAt = performance.now();
  while (!predicate()) {
    if (performance.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function semanticEvents(events: ArchitectureExecutionEvent[]): ArchitectureExecutionEvent[] {
  return events.filter((event) =>
    event.type === 'run_created'
    || event.type === 'participant_output'
    || event.type === 'router_decision'
    || event.type === 'final_artifact');
}

function routerData(targetNodeId: string, response = targetNodeId): { routerOutput: ArchitectureRouterOutput } {
  return {
    routerOutput: {
      selectedStrategy: targetNodeId,
      mergedDecision: response,
      acceptedInputs: [],
      rejectedInputs: [],
      unresolvedConflicts: [],
      risks: [],
      confidence: 1,
      nextAction: 'route_to',
      targetNodeId,
      response,
    },
  };
}

function toolEvidenceForSlot(slotId: string): Record<string, unknown> {
  const successfulToolNames = slotId === 'implementer'
    ? ['vfs_write']
    : ['vfs_read'];
  return {
    toolCallCount: 1,
    toolResultCount: 1,
    toolNames: successfulToolNames,
    successfulToolNames,
  };
}

function buildResultEvidence(): NonNullable<ArchitectureExecutionEvent['evidence']>[number] {
  return {
    kind: 'BUILD_RESULT',
    source: 'terminal',
    status: 'passed',
    data: { exitCode: 0 },
  };
}

function cliChildToolEvidence(childSessionId: string, status: string): Record<string, unknown> {
  return {
    toolCallCount: 1,
    toolResultCount: 1,
    toolNames: ['spawn_cli_agent'],
    successfulToolNames: ['spawn_cli_agent'],
    targetPaths: ['C:\\Projekty\\TurboProject2\\src\\App.tsx'],
    childCliSessions: [{
      childSessionId,
      agentId: 'copilot',
      workdir: 'C:\\Projekty\\TurboProject2',
      status,
    }],
  };
}

function childCliSessionIds(events: ArchitectureExecutionEvent[] | undefined): string[] {
  return (events ?? []).flatMap((event) => {
    const evidence = event.data?.['toolEvidence'];
    if (!isRecord(evidence)) {
      return [];
    }
    const sessions = evidence['childCliSessions'];
    if (!Array.isArray(sessions)) {
      return [];
    }
    return sessions.flatMap((session) => (
      isRecord(session) && typeof session['childSessionId'] === 'string'
        ? [session['childSessionId']]
        : []
    ));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function routerPolicySchema(policy: {
  mustAddressCriticFindings: boolean;
  canReturnNeedsMoreResearch: boolean;
}): ArchitectureSchema {
  const baseSchema = new ArchitectureRegistryService().findOne('strategic-decision-council')!;
  const roleSlots = baseSchema.roleSlots.filter((slot) => ['pragmatist', 'shadow', 'router'].includes(slot.id));
  return {
    ...baseSchema,
    id: `router-policy-${policy.canReturnNeedsMoreResearch ? 'research' : 'human'}`,
    name: 'Router Policy Contract',
    roleSlots,
    routerPolicy: {
      mode: 'rank_then_merge',
      ...policy,
    },
    nodes: [
      { id: 'pragmatist', label: 'Pragmatist', kind: 'role', roleSlotId: 'pragmatist' },
      { id: 'shadow', label: 'Shadow Critic', kind: 'role', roleSlotId: 'shadow' },
      {
        id: 'router',
        label: 'Router',
        kind: 'router',
        roleSlotId: 'router',
        behavior: { mode: 'rank_then_merge' },
      },
      { id: 'artifact', label: 'Artifact', kind: 'artifact' },
      { id: 'research', label: 'Research', kind: 'artifact' },
    ],
    edges: [
      { id: 'pragmatist-router', fromNodeId: 'pragmatist', toNodeId: 'router' },
      { id: 'shadow-router', fromNodeId: 'shadow', toNodeId: 'router' },
      { id: 'router-artifact', fromNodeId: 'router', toNodeId: 'artifact' },
      { id: 'router-research', fromNodeId: 'router', toNodeId: 'research', selection: 'continuation' },
    ],
  };
}
