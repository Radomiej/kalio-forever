import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { SubagentRuntimePort, RunSubagentRequest, RunSubagentResult } from '../tool/subagent-runtime.port';
import { SessionManagerService } from './session-manager.service';
import { SessionsService } from './sessions.service';
import { VFSService } from '../vfs/vfs.service';
import { AuditService } from './audit.service';
import { ContextAssemblyService } from './context-assembly.service';
import { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import type { LLMAgentLoopResult } from './llm-turn-runtime.types';
import { ToolPolicyService } from './tool-policy.service';
import { buildSubagentLLMAuditData } from './subagent-llm-audit.helpers';
import { AgentBudgetApprovalService } from './agent-budget-approval.service';
import { RunJournalService } from './run-journal.service';
import { SubagentResultReplayService } from './subagent-result-replay.service';
import { LLM_SOURCE } from './chat.tokens';
import type { ILLMSource } from './interfaces/llm-source.interface';
import { TurnState } from './turn-state';
import { createWorkflowError, workflowFailureFromError } from '../../common/utils/workflow-error.util';
import { RAW_XML_TOOL_CALL_COMPAT_TOOL_NAME } from './raw-tool-call.parser';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { NativeApprovalService } from '../agent-runtime/native-approval.service';
import { RuntimeExecutionScheduler } from '../agent-runtime/runtime-execution.scheduler';
import { createRuntimeExecutionLeaseController } from '../agent-runtime/runtime-execution-lease.controller';
import { buildSubagentProviderOptions } from './subagent-provider-options';
import { prepareSubagentExecution, resolveObservedSubagentScope } from './subagent-execution-scope';
import { ProjectsService } from './projects.service';
import { failedRunResultText } from './subagent-result-text';
import { completeSubagentRuntime } from './subagent-runtime-completion';
import { bindObservedSubagentCancellation } from './subagent-cancellation-binding';
import { hostReceiptIdentity } from './llm-turn-tool-execution';
import {
  ActiveSubagentRunRegistry,
  type AgentRunWithDepth,
  appendCopiedOutputLinks,
  architectureContextForSubagent,
  buildSubagentAgentRun,
  buildSubagentRuntimeContext,
  buildAttachmentHint,
  createSubagentTrackingEmit,
  resolveHistorySessionId,
  subagentErrorCode,
} from './subagent-runtime.support';

const DEFAULT_MAX_ITERATIONS = 30;
@Injectable()
export class SubagentRuntimeService implements SubagentRuntimePort {
  private readonly logger = new Logger(SubagentRuntimeService.name);
  private readonly activeRuns = new ActiveSubagentRunRegistry();
  constructor(
    @Inject(LLM_SOURCE) private readonly llmSource: ILLMSource,
    private readonly llmTurnRuntime: LLMTurnRuntimeService,
    private readonly sessionManager: SessionManagerService,
    private readonly sessions: SessionsService,
    private readonly vfs: VFSService,
    private readonly contextAssembly: ContextAssemblyService,
    private readonly toolPolicy: ToolPolicyService,
    private readonly agentBudgetApprovals: AgentBudgetApprovalService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly runJournal?: RunJournalService,
    @Optional() private readonly resultReplay?: SubagentResultReplayService,
    @Optional() private readonly executionProfiles?: ExecutionProfileService,
    @Optional() private readonly nativeApprovals?: NativeApprovalService,
    @Optional() private readonly runtimeScheduler?: RuntimeExecutionScheduler,
    @Optional() private readonly projects?: ProjectsService,
  ) {}

  stopAndDrainSessions(sessionIds: readonly string[]): Promise<void> {
    return this.activeRuns.stopAndDrainSessions(sessionIds);
  }

  getActiveRunStatus(sessionId: string) {
    return this.activeRuns.getStatus(sessionId);
  }

  async runSubagent(request: RunSubagentRequest): Promise<RunSubagentResult> {
    if (request.hostRuntimeReceiptObserver && (request.resumeTurnId || !this.runJournal)) {
      throw new Error('Host receipt runs require a durable journal and cannot replay a previous turn.');
    }
    const startedAt = performance.now();
    const taskId = randomUUID();
    const requestedChildSessionId = typeof request.childSessionId === 'string' && request.childSessionId.trim().length > 0
      ? request.childSessionId.trim()
      : undefined;
    const childSessionId = requestedChildSessionId ?? `sub-${taskId}`;
    const vfsSessionId = request.vfsMode === 'shared' ? request.parentSessionId : childSessionId;
    const turnId = nanoid();
    const parentDepth = request.parentAgentRun && typeof (request.parentAgentRun as AgentRunWithDepth).subagentDepth === 'number'
      ? (request.parentAgentRun as AgentRunWithDepth).subagentDepth ?? 0
      : 0;
    const subagentDepth = parentDepth + 1;
    const runtimeKind = request.auditContext?.architectureRunId ? 'agent-flow-branch' : 'subagent';
    const personaId = request.personaId ?? 'default';
    const observedScope = request.hostRuntimeReceiptObserver ? await resolveObservedSubagentScope({
      sessions: this.sessions, projects: this.projects, vfs: this.vfs, parentSessionId: request.parentSessionId, childSessionId: requestedChildSessionId,
    }) : undefined;
    const architectureContext = observedScope
      ? { ...architectureContextForSubagent(request), projectPath: observedScope.projectRoot, executionCwd: observedScope.cwd }
      : architectureContextForSubagent(request);
    const historySessionId = resolveHistorySessionId(
      runtimeKind,
      architectureContext,
      request.parentSessionId,
      childSessionId,
    );

    const policyDecision = await this.toolPolicy.decide({
      runtimeKind,
      personaId,
      explicitToolNames: runtimeKind === 'subagent'
        ? request.availableTools?.map((tool) => tool.name)
        : undefined,
      explicitTools: runtimeKind === 'subagent' ? request.availableTools : undefined,
      slotPolicy: request.slotPolicy,
      architectureContext: observedScope ? architectureContext : request.architectureContext,
      subagentDepth,
      autoApproveTools: request.autoApproveTools,
    });

    const runtimeContext = buildSubagentRuntimeContext({
      runtimeKind,
      parentSessionId: request.parentSessionId,
      parentToolCallId: request.parentToolCallId,
      vfsMode: request.vfsMode,
      vfsSessionId,
      modelOverride: observedScope ? undefined : request.model,
      explicitToolNames: policyDecision.allowedToolNames,
      systemPromptProfile: runtimeKind === 'agent-flow-branch' ? 'agent-flow-branch' : 'subagent',
      architectureContext,
      architectureSlotId: typeof request.auditContext?.roleSlotId === 'string' ? request.auditContext.roleSlotId : undefined,
      architectureSlotPolicy: request.slotPolicy,
    });

    const agentRun = buildSubagentAgentRun({
      taskId,
      parentSessionId: request.parentSessionId,
      parentToolCallId: request.parentToolCallId,
      vfsMode: request.vfsMode,
      vfsSessionId,
      subagentDepth,
      autoApproveTools: request.autoApproveTools,
    });

    const { childSession, executionProfile } = await prepareSubagentExecution({
      sessions: this.sessions,
      requestedChildSessionId,
      childSessionId,
      personaId,
      objective: request.objective,
      parentSessionId: request.parentSessionId,
      parentTurnId: request.parentTurnId,
      parentToolCallId: request.parentToolCallId,
      runtimeContext,
      executionProfiles: this.executionProfiles,
      observedScope,
    });

    if (request.resumeTurnId && this.resultReplay) {
      const replay = await this.resultReplay.replay(
        request, childSessionId, vfsSessionId, Math.round(performance.now() - startedAt),
      );
      if (replay) return replay;
    }
    const attachmentPaths = request.attachments ?? [];
    const copiedAttachments = attachmentPaths.length > 0 && request.vfsMode === 'isolated'
      ? this.vfs.copySessionFiles({
          fromSessionId: request.parentSessionId,
          toSessionId: childSessionId,
          targetPrefix: 'attachments',
          filePaths: attachmentPaths,
        })
      : [];
    const effectiveAttachmentPaths = copiedAttachments.length > 0
      ? copiedAttachments.map((file) => file.toPath)
      : attachmentPaths;
    const objectiveWithAttachmentHint = `${buildAttachmentHint(effectiveAttachmentPaths)}${request.objective}`;

    const emit = request.emit;
    const promptMessage = await this.sessionManager.persistUserMessage(
      childSessionId,
      objectiveWithAttachmentHint,
      undefined,
      { turnId },
    );
    const promptMessageId = promptMessage?.id;
    if (request.hostRuntimeReceiptObserver && !promptMessageId) throw new Error('Host receipts require a persisted prompt message.');
    let hadContent = false;
    let streamedText = '';
    const trackingEmit = createSubagentTrackingEmit({
      emit,
      runtimeKind,
      childSessionId,
      turnId,
      promptMessageId: () => promptMessageId,
      onChunk: (delta) => { hadContent = true; streamedText += delta; },
    });
    trackingEmit?.('agent:start', { sessionId: childSessionId, turnId, promptMessageId, agentRun });
    if (!requestedChildSessionId) {
      trackingEmit?.('session:created', childSession);
    }

    const controller = new AbortController();
    const completeActiveRun = this.activeRuns.register({
      childSessionId,
      parentSessionId: request.parentSessionId,
      historySessionId,
      vfsSessionId,
      turnId,
      promptMessageId,
      agentRun,
      controller,
    });
    const executionLease = this.runtimeScheduler ? createRuntimeExecutionLeaseController(this.runtimeScheduler, { projectId: childSession.projectId ?? 'system:none', priority: 'child', label: `subagent:${childSessionId}:${turnId}` }) : undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let journalRunId: string | undefined;
    let journalCommitted = false;
    let loopExecution: Promise<LLMAgentLoopResult> | undefined;
    let rejectExecutionTimeout: ((error: Error) => void) | undefined;
    const clearExecutionTimeout = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = undefined;
      }
    };
    const armExecutionTimeout = () => {
      clearExecutionTimeout();
      timeoutHandle = setTimeout(() => {
        const error = createWorkflowError('SUBAGENT_TIMEOUT', `Sub-agent timed out after ${request.timeoutMs}ms`, {
          source: 'subagent-runtime',
        });
        controller.abort(error);
        rejectExecutionTimeout?.(error);
      }, request.timeoutMs);
    };

    try {
      await executionLease?.acquire();
      const timeoutPromise = new Promise<never>((_, reject) => {
        rejectExecutionTimeout = reject;
        armExecutionTimeout();
      });

      const toolPolicyRequest = {
        runtimeKind,
        personaId,
        sessionRuntimeContext: runtimeContext,
        explicitToolNames: policyDecision.allowedToolNames,
        explicitTools: policyDecision.tools,
        slotPolicy: request.slotPolicy,
        architectureContext: observedScope ? architectureContext : request.architectureContext,
        subagentDepth,
        autoApproveTools: request.autoApproveTools,
      } as const;

      const assembledContext = runtimeKind === 'agent-flow-branch'
        ? await this.contextAssembly.assembleForRuntime({
            runtimeKind: 'agent-flow-branch',
            personaId,
            toolPolicyRequest,
            modelOverride: observedScope ? undefined : request.model,
          })
        : await this.contextAssembly.assembleForRuntime({
            runtimeKind: 'subagent',
            personaId,
            toolPolicyRequest,
          });

      const runtimeConfig = await this.llmSource.getConfig?.();
      const llmAuditData = buildSubagentLLMAuditData(runtimeConfig, assembledContext.model, observedScope ? undefined : request.model);
      const requestModel = observedScope ? undefined : request.model?.trim();
    const effectiveModel = executionProfile?.model || requestModel || assembledContext.model || undefined;
      journalRunId = (await this.runJournal?.startRun({
        sessionId: childSessionId,
        turnId,
      model: effectiveModel,
      runtimeKind,
      executionProfileId: executionProfile?.id,
      externalThreadId: childSession.externalThreadId,
    }))?.id;
      const maxIterations = Number.isFinite(request.maxIterations)
        ? Math.max(1, Math.min(100, Math.round(request.maxIterations as number)))
        : Math.max(1, Math.min(100, Math.round(assembledContext.personaConfig?.maxToolAttempts ?? DEFAULT_MAX_ITERATIONS)));
      const hostCancellationRecording = request.hostRuntimeReceiptObserver
        ? bindObservedSubagentCancellation(this.activeRuns, childSessionId, controller, hostReceiptIdentity({ runId: journalRunId, sessionId: childSessionId, turnId, promptMessageId })) : undefined;

      const loopResult = await Promise.race([
        loopExecution = this.llmTurnRuntime.runAgentLoop({
          runtimeKind,
          sessionId: childSessionId,
          runId: journalRunId,
          historySessionId,
          turnId,
          promptMessageId,
          personaId,
           effectiveSystemPrompt: assembledContext.effectiveSystemPrompt,
           toolMetas: assembledContext.toolMetas,
           model: effectiveModel,
           cwd: observedScope?.cwd,
           providerToolNames: assembledContext.personaConfig?.providerToolNames,
           ...buildSubagentProviderOptions({
            executionProfile,
            externalThreadId: childSession.externalThreadId,
            sessionId: childSessionId,
             turnId,
             runId: journalRunId,
             abortSignal: controller.signal,
             onExternalRuntimeLost: () => controller.abort(),
             trackingEmit,
            sessions: this.sessions,
            runJournal: this.runJournal,
            nativeApprovals: this.nativeApprovals,
            audit: this.audit,
          }),
          vfsSessionId,
          agentRun,
          abortSignal: controller.signal,
          emit: trackingEmit ?? (() => undefined),
          maxIterations,
          rawXmlToolNames: assembledContext.toolMetas.some((tool) => tool.name === RAW_XML_TOOL_CALL_COMPAT_TOOL_NAME)
            ? [RAW_XML_TOOL_CALL_COMPAT_TOOL_NAME]
            : [],
          structuredOutput: request.structuredOutput,
          hostRuntimeReceiptObserver: request.hostRuntimeReceiptObserver,
          hostCancellationRecording,
          auditDomain: 'subagent',
          auditMetadata: { ...llmAuditData, ...(request.auditContext ?? {}) },
          firstMessageId: `subagent-${agentRun.agentRunId}`,
          messageIdPrefix: `subagent-${agentRun.agentRunId}`,
          callbacks: {
            onBeforeIteration: async (iteration, messageId, currentLimit) => {
              trackingEmit?.('agent:budget_progress', {
                sessionId: childSessionId,
                turnId,
                messageId,
                usedIterations: iteration,
                currentLimit,
                status: 'running',
                runtimeKind,
                personaId,
                agentRun,
                nodeId: typeof request.auditContext?.nodeId === 'string' ? request.auditContext.nodeId : undefined,
                roleSlotId: typeof request.auditContext?.roleSlotId === 'string' ? request.auditContext.roleSlotId : undefined,
                updatedAt: Date.now(),
              });
            },
            onIterationLimitReached: async ({ iterationCount, currentLimit }) => {
              trackingEmit?.('agent:budget_progress', {
                sessionId: childSessionId,
                turnId,
                messageId: `subagent-${agentRun.agentRunId}`,
                usedIterations: iterationCount,
                currentLimit,
                status: 'exhausted',
                runtimeKind,
                personaId,
                agentRun,
                nodeId: typeof request.auditContext?.nodeId === 'string' ? request.auditContext.nodeId : undefined,
                roleSlotId: typeof request.auditContext?.roleSlotId === 'string' ? request.auditContext.roleSlotId : undefined,
                updatedAt: Date.now(),
              });
              clearExecutionTimeout();
              const approvedLimit = await this.agentBudgetApprovals.requestAdditionalBudget(
                {
                  sessionId: childSessionId,
                  turnId,
                  promptMessageId,
                  vfsSessionId,
                  messageId: `subagent-${agentRun.agentRunId}`,
                  abortSignal: controller.signal,
                  state: new TurnState(),
                  emit: trackingEmit ?? (() => undefined),
                  agentRun,
                },
                {
                  currentLimit,
                  usedIterations: iterationCount,
                  personaId,
                  runtimeKind,
                  nodeId: typeof request.auditContext?.nodeId === 'string' ? request.auditContext.nodeId : undefined,
                  roleSlotId: typeof request.auditContext?.roleSlotId === 'string' ? request.auditContext.roleSlotId : undefined,
                  requestedBy: typeof request.auditContext?.roleSlotId === 'string' ? request.auditContext.roleSlotId : 'subagent',
                },
              );
              if (approvedLimit && !controller.signal.aborted) {
                armExecutionTimeout();
              }
              return approvedLimit;
            },
          },
        }),
        timeoutPromise,
      ]);

      const { copiedFiles, baseResultText, completionMessageId } = await completeSubagentRuntime({
        request, childSessionId, loopResult, maxIterations, streamedText, turnId, promptMessageId,
        journalRunId, runJournal: this.runJournal, vfs: this.vfs,
        abortSignal: controller.signal,
        onJournalCommitted: () => { journalCommitted = true; },
        persistTerminal: (id, state, context) => this.persistTerminalAssistantMessage(
          childSessionId, id, state, { turnId, promptMessageId }, context),
      });

      trackingEmit?.('chat:complete', {
        sessionId: childSessionId,
        messageId: completionMessageId,
        agentRun,
      });
      trackingEmit?.('agent:done', { sessionId: childSessionId, turnId, agentRun });

      return {
        result: appendCopiedOutputLinks(baseResultText, request.parentSessionId, copiedFiles),
        taskId,
        childSessionId,
        parentSessionId: request.parentSessionId,
        status: loopResult.exhausted ? 'failed' : 'completed',
        structuredOutput: loopResult.structuredOutput,
        reasonCode: loopResult.exhausted ? 'max_steps' : undefined,
        vfsMode: request.vfsMode,
        vfsSessionId,
        copiedFiles,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (request.hostRuntimeReceiptObserver) {
        controller.abort(error);
        if (loopExecution) await Promise.allSettled([loopExecution]);
      }
      const failure = workflowFailureFromError(error);
      if (journalRunId && !journalCommitted) {
        await this.runJournal?.fail(journalRunId, failure.code, failure.message);
      }
      const fallbackState = new TurnState();
      fallbackState.replaceText(failedRunResultText(error.message, streamedText.trim()));
      if (!request.hostRuntimeReceiptObserver) await this.persistTerminalAssistantMessage(
        childSessionId,
        nanoid(),
        fallbackState,
        { turnId, promptMessageId },
        'error fallback',
      );
      trackingEmit?.('chat:error', {
        sessionId: childSessionId,
        code: subagentErrorCode(error),
        message: error.message,
        hadContent,
        agentRun,
      });
      await this.audit?.log({
        sessionId: childSessionId,
        type: 'error',
        label: 'subagent:error',
        data: {
          domain: 'subagent',
          kind: 'subagent_error',
          childAgentRunId: agentRun.agentRunId,
          childSessionId,
          parentSessionId: request.parentSessionId,
          parentToolCallId: request.parentToolCallId,
          vfsMode: request.vfsMode,
          vfsSessionId,
          objective: request.objective,
          errorCode: failure.code,
          failure,
          errorMessage: error.message,
          ...(request.auditContext ?? {}),
        },
        durationMs: Math.round(performance.now() - startedAt),
      });
      trackingEmit?.('agent:done', { sessionId: childSessionId, turnId, agentRun });
      throw error;
    } finally {
      clearExecutionTimeout();
      executionLease?.release();
      completeActiveRun();
    }
  }

  private async persistTerminalAssistantMessage(
    sessionId: string,
    messageId: string,
    state: TurnState,
    metadata: { turnId: string; promptMessageId: string },
    context: string,
  ): Promise<string | null> {
    try {
      await this.sessionManager.persistAssistantMessage(sessionId, messageId, state, metadata);
      return messageId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to persist ${context} for subagent ${sessionId}: ${message}`);
      return null;
    }
  }
}
