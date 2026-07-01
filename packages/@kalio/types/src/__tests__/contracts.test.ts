import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ID,
  Timestamp,
  LLMStreamChunk,
  LLMConfig,
  LLMContent,
  LLMContextPreview,
  LLMProviderType,
  LLMToolCall,
  Persona,
  CreatePersonaDto,
  ContextCompactionStrategy,
  ContextPreviewMessage,
  ContextPreviewRequest,
  SessionRuntimeContext,
  ChatMessage,
  ChatSession,
  CreateSessionDto,
  ToolMeta,
  ToolDomain,
  ToolCallRequest,
  ToolResult,
  ToolConfirmationRequest,
  RuntimeWatchReason,
  RuntimeWatchTarget,
  VFSWriteRequest,
  Credential,
  CreateCredentialDto,
  ToolTimeoutSettings,
  MCPServer,
  RAAppBlock,
  SocketEvents,
  ArchitectureNodeKind,
  ArchitectureNodeBehaviorMode,
  ArchitectureNodeFanOutMode,
  ArchitectureNodeScoringPolicy,
  ArchitectureContextCompression,
  ArchitectureSchema,
  ArchitectureSchemaEdgeSelection,
  CreateArchitectureSchemaVariantDto,
  CreateArchitectureRunDto,
  ArchitectureRun,
  ArchitectureRunStatus,
  ArchitectureRouterOutput,
  ArchitectureRouteDecision,
  ArchitectureRouteHop,
  ArchitectureExecutionEvent,
  ArchitectureGraphProjection,
  ArchitectureChatProjection,
  AgentFlowDefinition,
  AgentFlowPhase,
  AgentFlowReturnMode,
  AgentFlowRun,
  AgentFlowRunSnapshot,
  AgentFlowRunStatus,
  AgentFlowStartMode,
  AgentFlowTraceItem,
  ArchitectureChildAgentKind,
  AuditDomain,
  ChildExecutionKind,
  CreateAgentFlowRunDto,
  CLIAgentConfig,
  CLIAgentSessionSnapshot,
  WorkflowErrorCode,
  RunSubAgentFlowArgs,
  ResumeAgentFlowRunDto,
  SubAgentFlowResult,
} from '../index.js';
import {
  architectureSessionIdForRunSlot,
  architectureSessionPrefixForRun,
} from '../index.js';

describe('@kalio/types contract shape', () => {
  it('keeps primitive aliases aligned with serialized API values', () => {
    expectTypeOf<ID>().toEqualTypeOf<string>();
    expectTypeOf<Timestamp>().toEqualTypeOf<number>();
  });

  it('keeps chat message and session contracts compatible with persisted payloads', () => {
    expectTypeOf<Pick<ChatMessage, 'id' | 'sessionId' | 'role' | 'content' | 'createdAt'>>().toEqualTypeOf<{
      id: ID;
      sessionId: ID;
      role: 'user' | 'assistant' | 'tool_result' | 'system';
      content: string;
      createdAt: Timestamp;
    }>();
    expectTypeOf<Pick<ChatSession, 'id' | 'personaId' | 'title' | 'createdAt' | 'updatedAt'>>().toEqualTypeOf<{
      id: ID;
      personaId: ID;
      title: string;
      createdAt: Timestamp;
      updatedAt: Timestamp;
    }>();

    const msg: ChatMessage = {
      id: 'msg-1',
      sessionId: 'sess-1',
      role: 'user',
      content: 'hello',
      createdAt: Date.now(),
    };
    expect(msg.role).toBe('user');
  });

  it('keeps persona creation inputs narrower than stored persona records', () => {
    expectTypeOf<Pick<CreatePersonaDto, 'name' | 'systemPrompt' | 'model' | 'allowedTools'>>().toEqualTypeOf<{
      name: string;
      systemPrompt: string;
      model: string;
      allowedTools: string[];
    }>();
    expectTypeOf<Pick<Persona, 'id' | 'skillIds' | 'mcpPolicy' | 'avatarSeed' | 'avatarVariant' | 'avatarPaletteKey' | 'avatarIndex' | 'createdAt' | 'updatedAt'>>().toEqualTypeOf<{
      id: ID;
      skillIds: string[];
      mcpPolicy: 'allow_all' | 'deny_all' | 'allow_list';
      avatarSeed: string;
      avatarVariant: 'marble' | 'beam' | 'pixel' | 'sunset' | 'ring' | 'bauhaus';
      avatarPaletteKey: 'ocean' | 'sunset' | 'forest' | 'violet' | 'ember' | 'slate' | 'candy' | 'mono';
      avatarIndex: number;
      createdAt: Timestamp;
      updatedAt: Timestamp;
    }>();
  });

  it('keeps tool metadata, calls, results, and confirmations on the shared HITL contract', () => {
    expectTypeOf<ToolMeta>().toEqualTypeOf<{
      name: string;
      description: string;
      serverKey?: ID;
      aliases?: string[];
      domain?: ToolDomain;
      parameters: Record<string, unknown>;
      requiresConfirmation: boolean;
    }>();
    expectTypeOf<ToolDomain>().toEqualTypeOf<
      | 'subagent'
      | 'cli_agent'
      | 'agent_workflow'
      | 'security_audit'
      | 'architecture'
      | 'vfs'
      | 'file_system'
      | 'file_search'
      | 'key_value'
      | 'terminal'
      | 'raapp'
      | 'preview'
      | 'memory'
      | 'search'
      | 'web'
      | 'tool_registry'
      | 'image'
      | 'skill'
      | 'persona'
      | 'mcp'
      | 'generic'
    >();
    expectTypeOf<Pick<ToolCallRequest, 'sessionId' | 'toolName' | 'args' | 'callId'>>().toEqualTypeOf<{
      sessionId: ID;
      toolName: string;
      args: Record<string, unknown>;
      callId: string;
    }>();
    expectTypeOf<ToolResult['status']>().toEqualTypeOf<'success' | 'error' | 'cancelled'>();
    expectTypeOf<Pick<ToolConfirmationRequest, 'requestId' | 'toolCallId' | 'sessionId' | 'toolName' | 'args' | 'timeoutMs'>>().toEqualTypeOf<{
      requestId: string;
      toolCallId: string;
      sessionId: ID;
      toolName: string;
      args: Record<string, unknown>;
      timeoutMs: number;
    }>();
    expectTypeOf<SocketEvents['tool:confirm']>().toEqualTypeOf<{
      requestId: string;
      sessionId: ID;
      message?: string;
    }>();
    expectTypeOf<SocketEvents['tool:cancel']>().toEqualTypeOf<{
      requestId: string;
      sessionId: ID;
      message?: string;
    }>();
  });

  it('keeps runtime watchlist reasons as typed replay causes', () => {
    expectTypeOf<RuntimeWatchReason>().toEqualTypeOf<
      | 'active'
      | 'pending_confirmation'
      | 'pending_budget'
      | 'agent_flow_live'
      | 'run_recovery_required'
    >();
    expectTypeOf<RuntimeWatchTarget>().toEqualTypeOf<{
      sessionId: ID;
      reasons: RuntimeWatchReason[];
    }>();
  });

  it('Credential never exposes apiKey', () => {
    const cred: Credential = {
      id: 'cred-1',
      name: 'CometAPI',
      provider: 'CometAPI',
      createdAt: Date.now(),
    };
    // apiKey is NOT on the Credential interface — compile-time check via type
    expect('apiKey' in cred).toBe(false);
  });

  it('keeps provider and DTO unions aligned with runtime-supported values', () => {
    const providers: LLMProviderType[] = [
      'openai',
      'openrouter',
      'cometapi',
      'xiaomimimo',
      'ollama',
      'deepseek',
      'bitnet',
      'custom',
      'mock',
    ];
    expect(providers).toContain('bitnet');
    expect(providers).toContain('custom');

    expectTypeOf<Pick<CreateSessionDto, 'personaId' | 'title' | 'kind'>>().toEqualTypeOf<{
      personaId: ID;
      title?: string;
      kind?: 'chat' | 'subagent' | 'cli-agent' | 'agent-flow';
    }>();
    const flowSession: ChatSession = {
      id: 'flow-session-1',
      personaId: 'default',
      title: 'Goal Guard flow',
      kind: 'agent-flow',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(flowSession.kind).toBe('agent-flow');
    expectTypeOf<Pick<CreateCredentialDto, 'name' | 'provider' | 'apiKey'>>().toEqualTypeOf<{
      name: string;
      provider: string;
      apiKey?: string;
    }>();
  });

  it('keeps AgentFlow delegation contracts explicit', () => {
    const kinds: ChildExecutionKind[] = ['sub_agent', 'cli_agent', 'sub_agentflow'];
    expect(kinds).toContain('sub_agentflow');
    expectTypeOf<ArchitectureChildAgentKind>().toEqualTypeOf<
      ChildExecutionKind | 'subagent' | 'cli-agent'
    >();
    expectTypeOf<AgentFlowRunStatus>().toEqualTypeOf<
      'queued' | 'running' | 'waiting_on_orchestrator' | 'done' | 'failed' | 'cancelled' | 'blocked'
    >();
    expectTypeOf<ArchitectureRunStatus>().toEqualTypeOf<
      'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    >();
    expectTypeOf<AgentFlowReturnMode>().toEqualTypeOf<'summary' | 'full_trace' | 'artifacts_only'>();
    expectTypeOf<AgentFlowStartMode>().toEqualTypeOf<'durable' | 'blocking'>();
    expectTypeOf<AgentFlowPhase>().toEqualTypeOf<'strategy' | 'research' | 'debate' | 'build' | 'qa' | 'hitl' | 'custom'>();

    const args: RunSubAgentFlowArgs = {
      flowId: 'goal_guard_delivery_loop',
      goal: 'Build and verify the requested website',
      parentSessionId: 'parent-1',
      parentToolCallId: 'call-1',
      startMode: 'durable',
      vfsMode: 'isolated',
      copyBack: true,
      returnMode: 'summary',
      maxSteps: 12,
    };
    const traceItem: AgentFlowTraceItem = {
      id: 'trace-1',
      sequence: 1,
      type: 'flow:node_result',
      lifecycle: 'node_completed',
      message: 'Goal Guard accepted the result.',
      nodeId: 'goal-guard',
      roleSlotId: 'goal_master',
      route: {
        source: 'agent',
        fromNodeId: 'goal-guard',
        selectedNodeIds: ['final-artifact'],
        rejectedNodeIds: ['implementer'],
        nextNodeId: 'final-artifact',
      },
      data: {
        toolEvidence: {
          successfulToolNames: ['vfs_write'],
        },
      },
      status: 'done',
      createdAt: Date.now(),
    };
    const result: SubAgentFlowResult = {
      flowRunId: 'flow-run-1',
      parentSessionId: args.parentSessionId,
      parentToolCallId: args.parentToolCallId,
      childSessionId: 'flow-child-1',
      status: 'done',
      summary: 'Goal Guard accepted the result.',
      decisions: ['Implementation passed verification'],
      nextActions: [],
      artifacts: ['dist/index.html'],
      tracePreview: [traceItem],
      openChatSessionId: 'flow-child-1',
      openGraphRunId: 'flow-run-1',
    };
    const definition: AgentFlowDefinition = {
      id: args.flowId,
      name: 'Goal Guard delivery loop',
      version: '1',
      entryNodeId: 'orchestrator',
      orchestratorNodeId: 'orchestrator',
      maxIterations: 6,
      nodes: [
        { id: 'orchestrator', agentId: 'orchestrator', label: 'Orchestrator', phase: 'strategy', role: 'Plan and route', tools: ['run_sub_agentflow'] },
        { id: 'dev', agentId: 'dev', label: 'Dev/Implementer', phase: 'build', role: 'Implement', tools: ['spawn_cli_agent'] },
        { id: 'guard', agentId: 'guard', label: 'Goal Guard', phase: 'qa', role: 'Verify evidence', tools: ['get_cli_agent_status'] },
      ],
      edges: [
        { id: 'orchestrator-dev', fromNodeId: 'orchestrator', toNodeId: 'dev' },
        { id: 'dev-guard', fromNodeId: 'dev', toNodeId: 'guard' },
        { id: 'guard-orchestrator', fromNodeId: 'guard', toNodeId: 'orchestrator', returnToOrchestrator: true },
      ],
    };
    const run: AgentFlowRun = {
      id: result.flowRunId,
      parentSessionId: args.parentSessionId,
      parentToolCallId: args.parentToolCallId,
      childSessionId: result.childSessionId,
      flowDefinitionId: args.flowId,
      status: 'waiting_on_orchestrator',
      startMode: 'durable',
      returnMode: 'summary',
      activeNodeIds: ['orchestrator'],
      completedNodeIds: ['dev', 'guard'],
      activePhases: ['strategy'],
      completedPhases: ['build', 'qa'],
      nodeVisitCounts: { orchestrator: 2, dev: 1, guard: 1 },
        maxIterations: 6,
        waitingForNodeId: 'orchestrator',
        returnToOrchestratorCount: 1,
        checkpoint: {
          goal: args.goal,
          context: args.context,
          vfsMode: args.vfsMode,
          copyBack: args.copyBack,
          maxSteps: args.maxSteps,
          continuation: {
            reason: 'return_to_orchestrator',
            waitingNodeId: 'orchestrator',
            pendingNodeIds: ['orchestrator'],
            visitCounts: { orchestrator: 2, dev: 1, guard: 1 },
            lastCompletedNodeId: 'guard',
            lastRoute: {
              fromNodeId: 'guard',
              selectedNodeIds: ['orchestrator'],
              nextNodeId: 'orchestrator',
              source: 'agent',
            },
          },
          lastResumeInput: 'Continue after Goal Guard requested more evidence.',
          resumeContext: { retry: 1 },
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    expect(run.flowDefinitionId).toBe('goal_guard_delivery_loop');
    expect(definition.edges.some((edge) => edge.returnToOrchestrator)).toBe(true);
    expect(result.tracePreview?.[0]?.type).toBe('flow:node_result');
    expect(result.tracePreview?.[0]?.lifecycle).toBe('node_completed');
    expect(result.parentSessionId).toBe('parent-1');
    expect(result.parentToolCallId).toBe('call-1');
    expect(result.tracePreview?.[0]?.route?.nextNodeId).toBe('final-artifact');
    expect(result.tracePreview?.[0]?.data?.['toolEvidence']).toEqual({
      successfulToolNames: ['vfs_write'],
    });

    const createDto: CreateAgentFlowRunDto = {
      flowId: args.flowId,
      goal: args.goal,
      parentSessionId: args.parentSessionId,
      parentToolCallId: args.parentToolCallId,
      startMode: 'durable',
      returnMode: 'summary',
    };
    const resumeDto: ResumeAgentFlowRunDto = {
      input: 'Continue after Goal Guard requested more evidence.',
      context: { retry: 1 },
      maxSteps: 5,
    };
    const snapshot: AgentFlowRunSnapshot = {
      run,
      result,
      events: [traceItem],
    };
    expect(createDto.startMode).toBe('durable');
    expect(resumeDto.context?.['retry']).toBe(1);
      expect(snapshot.run.status).toBe('waiting_on_orchestrator');
      expect(snapshot.run.checkpoint?.goal).toBe(args.goal);
    });

  it('keeps cross-feature payload contracts explicit', () => {
    expectTypeOf<VFSWriteRequest>().toEqualTypeOf<{ sessionId: ID; filePath: string; content: string }>();
    expectTypeOf<MCPServer['status']>().toEqualTypeOf<'connecting' | 'connected' | 'disconnected' | 'error' | 'stopped'>();
    expectTypeOf<Pick<RAAppBlock, 'type' | 'mode' | 'content'>>().toEqualTypeOf<{
      type: 'html' | 'gui';
      mode: 'display' | 'interactive';
      content: string;
    }>();
    expectTypeOf<Pick<LLMStreamChunk, 'delta' | 'done' | 'sessionId' | 'messageId' | 'usage'>>().toEqualTypeOf<{
      delta: string;
      done: boolean;
      sessionId: ID;
      messageId: ID;
      usage?: { promptTokens: number; completionTokens: number; totalTokens?: number };
    }>();
    expectTypeOf<LLMConfig>().toEqualTypeOf<{
      provider: LLMProviderType;
      model: string;
      apiKey: string;
      baseUrl: string;
    }>();
    expectTypeOf<ToolTimeoutSettings>().toEqualTypeOf<{
      webSearchTimeoutMs: number;
      providerLocalTimeoutMs: number;
      providerRemoteTimeoutMs: number;
      providerMaxConcurrentStreams: number;
    }>();
    expectTypeOf<Pick<SocketEvents['chat:send'], 'sessionId' | 'content' | 'personaId'>>().toEqualTypeOf<{
      sessionId: ID;
      content: string;
      personaId: ID;
    }>();
  });

  it('keeps LLM context preview contracts explicit', () => {
    expectTypeOf<ContextCompactionStrategy>().toEqualTypeOf<'backend-default' | 'summary' | 'evidence_only'>();
    type SessionContextPreviewRequest = Extract<ContextPreviewRequest, { sessionId: string }>;
    type RuntimeContextPreviewRequest = Extract<ContextPreviewRequest, { target: 'runtime' }>;
    expectTypeOf<SessionContextPreviewRequest>().toMatchTypeOf<{
      target?: 'session';
      sessionId: string;
      personaId: string;
      draftUserMessage?: string;
      attachments?: ChatMessage['attachments'];
      runtimeContext?: never;
    }>();
    expectTypeOf<RuntimeContextPreviewRequest>().toMatchTypeOf<{
      target: 'runtime';
      personaId: string;
      runtimeContext: SessionRuntimeContext;
      draftUserMessage?: string;
      attachments?: ChatMessage['attachments'];
      sessionId?: never;
    }>();
    expectTypeOf<ContextPreviewMessage>().toEqualTypeOf<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: LLMContent;
      reasoningContent?: string;
      toolCalls?: LLMToolCall[];
      toolCallId?: string;
      source: 'system_prompt' | 'history' | 'draft';
      estimatedTokens: number;
    }>();
    expectTypeOf<Pick<LLMContextPreview, 'sessionId' | 'personaId' | 'model' | 'contextLimit' | 'effectiveSystemPrompt'>>().toEqualTypeOf<{
      sessionId: ID;
      personaId: ID;
      model: string;
      contextLimit: number;
      effectiveSystemPrompt: string;
    }>();
    expectTypeOf<LLMContextPreview['estimatedTokens']>().toEqualTypeOf<{
      total: number;
      systemPrompt: number;
      tools: number;
      history: number;
      images: number;
      reasoning: number;
    }>();
    expectTypeOf<LLMContextPreview['compaction']>().toEqualTypeOf<{
      applied: boolean;
      unboundedMessageCount: number;
      finalMessageCount: number;
      safeTargetTokens: number;
    }>();
  });

  it('keeps CLI agent supervision contracts explicit', () => {
    expectTypeOf<Pick<CLIAgentConfig, 'timeoutMs' | 'hardTimeoutEnabled' | 'hardTimeoutMs' | 'autoRecoveryEnabled' | 'autoRecoveryPrompt'>>().toEqualTypeOf<{
      timeoutMs: number;
      hardTimeoutEnabled?: boolean;
      hardTimeoutMs?: number;
      autoRecoveryEnabled?: boolean;
      autoRecoveryPrompt?: string;
    }>();
    expectTypeOf<Pick<CLIAgentConfig, 'model' | 'architecturePreference'>>().toEqualTypeOf<{
      model: string;
      architecturePreference: string;
    }>();
    expectTypeOf<Pick<CLIAgentSessionSnapshot, 'status' | 'errorCode' | 'lastOutput' | 'recoveryAttempts'>>().toEqualTypeOf<{
      status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped';
      errorCode?: WorkflowErrorCode;
      lastOutput?: string;
      recoveryAttempts?: number;
    }>();
  });

  it('keeps audit domain contracts explicit for observability routing', () => {
    const domains: AuditDomain[] = [
      'llm',
      'tool',
      'subagent',
      'architecture',
      'hitl',
      'hook',
      'vfs',
      'file',
      'raapp',
      'error',
      'generic',
    ];
    expect(domains).toContain('architecture');
    expect(domains).toContain('subagent');
    expect(domains).toContain('hitl');
  });

  it('keeps architecture orchestration contracts explicit', () => {
    expectTypeOf<ArchitectureSchema>().toEqualTypeOf<{
      id: ID;
      name: string;
      description: string;
      version: string;
      roleSlots: Array<{
        id: string;
        label: string;
        description: string;
        slotType: 'participant' | 'router' | 'judge' | 'finalizer' | 'critic' | 'tool_executor';
        defaultPersonaId: ID;
        allowedPersonaTags: string[];
        required: boolean;
        canOverrideAtRunStart: boolean;
      }>;
      nodes: Array<{
        id: string;
        label: string;
        kind: 'parallel' | 'role' | 'router' | 'artifact';
        roleSlotId?: string;
        maxToolAttempts?: number;
        toolOverride?: {
          allowedToolNames?: string[];
        };
        behavior?: {
          mode: ArchitectureNodeBehaviorMode;
          fanOut?: ArchitectureNodeFanOutMode;
          maxBranches?: number;
          scoringPolicy?: ArchitectureNodeScoringPolicy;
          description?: string;
        };
        x?: number;
        y?: number;
      }>;
      edges: Array<{
        id: string;
        fromNodeId: string;
        toNodeId: string;
        label?: string;
        selection?: ArchitectureSchemaEdgeSelection;
        returnToOrchestrator?: boolean;
      }>;
      routerPolicy: {
        mode: 'rank_then_merge' | 'evidence_first' | 'risk_weighted';
        mustAddressCriticFindings: boolean;
        canReturnNeedsMoreResearch: boolean;
      };
      contextPolicy: {
        includeUserTask: boolean;
        includeProjectMemory: boolean;
        includeBrowserSession: boolean;
        includePriorDecisions: boolean;
        includeOtherAgentOutputs?: boolean;
        includeToolResults?: boolean;
        contextCompression?: ArchitectureContextCompression;
        perSlotOverrides?: Record<string, {
          includeUserTask?: boolean;
          includeProjectMemory?: boolean;
          includeBrowserSession?: boolean;
          includePriorDecisions?: boolean;
          includeOtherAgentOutputs?: boolean;
          includeToolResults?: boolean;
          contextCompression?: ArchitectureContextCompression;
        }>;
      };
      memoryPolicy: {
        persistFinalArtifact: boolean;
        persistRouterDecision: boolean;
      };
      outputArtifactSchema: string;
    }>();
    expectTypeOf<CreateArchitectureRunDto>().toEqualTypeOf<{
      schemaId: ID;
      prompt: string;
      context?: Record<string, unknown>;
      slotOverrides?: Record<string, ID>;
      executionMode?: 'session_branches' | 'subagent_execution';
      schema?: ArchitectureSchema;
    }>();
    expectTypeOf<CreateArchitectureSchemaVariantDto>().toEqualTypeOf<{
      name?: string;
      description?: string;
      roleSlotPersonaOverrides?: Record<string, ID>;
      nodeKindOverrides?: Record<string, ArchitectureNodeKind>;
      contextPolicy?: ArchitectureSchema['contextPolicy'];
      nodes?: Array<{
        id: string;
        label: string;
        kind: 'parallel' | 'role' | 'router' | 'artifact';
        roleSlotId?: string;
        maxToolAttempts?: number;
        toolOverride?: {
          allowedToolNames?: string[];
        };
        behavior?: {
          mode: ArchitectureNodeBehaviorMode;
          fanOut?: ArchitectureNodeFanOutMode;
          maxBranches?: number;
          scoringPolicy?: ArchitectureNodeScoringPolicy;
          description?: string;
        };
        x?: number;
        y?: number;
      }>;
      edges?: Array<{
        id: string;
        fromNodeId: string;
        toNodeId: string;
        label?: string;
        selection?: ArchitectureSchemaEdgeSelection;
        returnToOrchestrator?: boolean;
      }>;
    }>();
    expectTypeOf<ArchitectureSchemaEdgeSelection>().toEqualTypeOf<'default' | 'converge' | 'continuation'>();
    expectTypeOf<ArchitectureRun['executionMode']>().toEqualTypeOf<'session_branches' | 'subagent_execution'>();
    expectTypeOf<ArchitectureRun['status']>().toEqualTypeOf<'queued' | 'running' | 'completed' | 'failed' | 'cancelled'>();
    expectTypeOf<ArchitectureRun['slotOverrides']>().toEqualTypeOf<Record<string, ID> | undefined>();
    expectTypeOf<ArchitectureRun['rootSessionId']>().toEqualTypeOf<ID | undefined>();
    expectTypeOf<ArchitectureRun['branchSessionIds']>().toEqualTypeOf<Record<string, ID> | undefined>();
    expectTypeOf<Pick<ArchitectureExecutionEvent, 'runId' | 'sequence' | 'type' | 'message' | 'actionSummary'>>().toEqualTypeOf<{
      runId: ID;
      sequence: number;
      type:
        | 'run_created'
        | 'node_started'
        | 'agent_started'
        | 'participant_output'
        | 'router_decision'
        | 'router_output'
        | 'tool_call'
        | 'human_gate'
        | 'artifact_created'
        | 'memory_persisted'
        | 'final_artifact'
        | 'node_failed'
        | 'node_completed'
        | 'run_stopped';
      message: string;
      actionSummary?: string;
    }>();
    expectTypeOf<ArchitectureExecutionEvent['action']>().toEqualTypeOf<
      | 'run_created'
      | 'run_stopped'
      | 'node_failed'
      | 'participant_completed'
      | 'participant_incomplete'
      | 'router_selected'
      | 'router_returned_to_orchestrator'
      | 'router_incomplete'
      | 'router_synthesized'
      | 'finalizer_completed'
      | undefined
    >();
    expectTypeOf<ArchitectureExecutionEvent['detail']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ArchitectureRouteDecision>().toEqualTypeOf<{
      source: 'agent' | 'router' | 'parallel' | 'runtime_fallback';
      fromNodeId: string;
      selectedNodeIds: string[];
      rejectedNodeIds?: string[];
      nextNodeId?: string;
      convergeToNodeId?: string;
      mode?: ArchitectureNodeBehaviorMode;
      response?: string;
    }>();
    expectTypeOf<ArchitectureRouteHop>().toEqualTypeOf<{
      eventId: ID;
      source: 'agent' | 'router' | 'parallel' | 'runtime_fallback';
      fromNodeId: string;
      toNodeId: string;
    }>();
    expectTypeOf<ArchitectureExecutionEvent['route']>().toEqualTypeOf<ArchitectureRouteDecision | undefined>();
    expectTypeOf<NonNullable<ArchitectureExecutionEvent['routerOutput']>>().toEqualTypeOf<{
      selectedStrategy: string;
      mergedDecision: string;
      acceptedInputs: Array<{
        fromSlot: string;
        insight: string;
        whyAccepted?: string;
        whyRejected?: string;
      }>;
      rejectedInputs: Array<{
        fromSlot: string;
        insight: string;
        whyAccepted?: string;
        whyRejected?: string;
      }>;
      unresolvedConflicts: string[];
      risks: Array<{
        risk: string;
        mitigation: string;
        sourceSlot: string;
      }>;
      confidence: number;
      nextAction: 'finalize' | 'ask_human' | 'route_to' | 'run_more_research' | 'rerun_with_different_personas';
      targetNodeId?: ID;
      response?: string;
    }>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['action']>().toEqualTypeOf<ArchitectureExecutionEvent['action']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['detail']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['routerOutput']>().toEqualTypeOf<ArchitectureRouterOutput | undefined>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['lifecycle']>().toEqualTypeOf<ArchitectureExecutionEvent['lifecycle']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['status']>().toEqualTypeOf<ArchitectureExecutionEvent['status']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['reasonCode']>().toEqualTypeOf<ArchitectureExecutionEvent['reasonCode']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['errorCode']>().toEqualTypeOf<ArchitectureExecutionEvent['errorCode']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['failure']>().toEqualTypeOf<ArchitectureExecutionEvent['failure']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['evidence']>().toEqualTypeOf<ArchitectureExecutionEvent['evidence']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['trace'][number]['runtimeDecision']>().toEqualTypeOf<ArchitectureExecutionEvent['runtimeDecision']>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['graphNodes']>().toEqualTypeOf<ArchitectureGraphProjection['nodes'] | undefined>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['graphEdges']>().toEqualTypeOf<ArchitectureGraphProjection['edges'] | undefined>();
    expectTypeOf<NonNullable<ChatMessage['architectureRun']>['graphChildAgents']>().toEqualTypeOf<ArchitectureGraphProjection['childAgents'] | undefined>();
    expectTypeOf<Pick<ArchitectureGraphProjection, 'runId' | 'nodes' | 'edges' | 'routeHops' | 'childAgents'>>().toEqualTypeOf<{
      runId: ID;
      nodes: Array<{
        id: string;
        sessionId?: ID;
        roleSlotId?: string;
        label: string;
        kind: 'parallel' | 'role' | 'router' | 'artifact';
        behavior?: ArchitectureSchema['nodes'][number]['behavior'];
        status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
        actionSummary?: string;
        action?: ArchitectureExecutionEvent['action'];
        detail?: string;
        visitCount?: number;
        eventIds: ID[];
        toolEvidence?: Record<string, unknown>;
        incompleteReason?: string;
      }>;
      edges: ArchitectureSchema['edges'];
      routeHops?: ArchitectureRouteHop[];
      childAgents?: Array<{
        id: ID;
        parentNodeId?: string;
        parentRoleSlotId?: string;
        parentEventId?: ID;
        kind: ArchitectureChildAgentKind;
        backend?: string;
        status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';
        toolName: string;
        workdir?: string;
        targetPaths?: string[];
        updatedAt?: Timestamp;
      }>;
    }>();
    expectTypeOf<ArchitectureChatProjection['messages'][number]['speaker']>().toEqualTypeOf<
      'system' | 'participant' | 'router' | 'finalizer'
    >();
    expectTypeOf<ArchitectureChatProjection['messages'][number]['route']>().toEqualTypeOf<
      ArchitectureRouteDecision | undefined
    >();
    expectTypeOf<ArchitectureChatProjection['messages'][number]['actionSummary']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<ArchitectureChatProjection['messages'][number]['action']>().toEqualTypeOf<
      ArchitectureExecutionEvent['action']
    >();
    expectTypeOf<ArchitectureChatProjection['messages'][number]['detail']>().toEqualTypeOf<
      string | undefined
    >();
  });

  it('normalizes architecture run session ids without double arch prefixes', () => {
    expect(architectureSessionPrefixForRun('run-1')).toBe('arch-run-1');
    expect(architectureSessionPrefixForRun('arch-run-1')).toBe('arch-run-1');
    expect(architectureSessionIdForRunSlot('run-1', 'router')).toBe('arch-run-1-router');
    expect(architectureSessionIdForRunSlot('arch-run-1', 'router')).toBe('arch-run-1-router');
    expect(architectureSessionIdForRunSlot('arch-run-1', undefined)).toBeUndefined();
  });
});
