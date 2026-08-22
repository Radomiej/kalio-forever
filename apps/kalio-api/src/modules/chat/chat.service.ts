import { Injectable, Logger, Optional } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { EmitFn } from './interfaces/stream-context.interface';
import { SessionManagerService } from './session-manager.service';
import { AuditService } from './audit.service';
import { TurnErrorAlreadyEmitted } from './turn-error';
import { RunJournalService } from './run-journal.service';
import { ContextAssemblyService } from './context-assembly.service';
import { CredentialsService } from '../credentials/credentials.service';
import { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import { serializeToolResultContent } from './llm-turn-runtime.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { HitlRequestService } from '../hitl/hitl-request.service';
import { AgentBudgetApprovalService } from './agent-budget-approval.service';
import { TurnState } from './turn-state';
import { SessionsService } from './sessions.service';
import {
  RuntimeExecutionScheduler,
} from '../agent-runtime/runtime-execution.scheduler';
import {
  createRuntimeExecutionLeaseController,
  runtimeExecutionPriority,
  type RuntimeExecutionLeaseController,
} from '../agent-runtime/runtime-execution-lease.controller';
import { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import { NativeApprovalService } from '../agent-runtime/native-approval.service';
import { getChatErrorCode } from './chat-error.utils';
import { createExternalAuditCallback, createNativeApprovalCallback } from './runtime-provider-callbacks';
import { bindExternalRuntime } from './runtime-external-binding';
import {
  readPendingRAAppLaunchInputs,
  readPendingRAAppLaunchIntent,
  stripPendingRAAppLaunchRuntimeContext,
} from './raapp-launch-intent';

function normalizeClientMessageId(clientMessageId: string | undefined): string | undefined {
  if (!clientMessageId) {
    return undefined;
  }
  const trimmed = clientMessageId.trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Socket-facing chat turn orchestrator. Persists the user draft, emits journal
 * phases, and delegates the provider-ready LLM loop to LLMTurnRuntimeService.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly credentialsService: CredentialsService,
    private readonly audit: AuditService,
    private readonly llmTurnRuntime: LLMTurnRuntimeService,
    private readonly agentBudgetApprovals: AgentBudgetApprovalService,
    private readonly sessions: SessionsService,
    @Optional() private readonly runJournal?: RunJournalService,
    @Optional() private readonly contextAssembly?: ContextAssemblyService,
    @Optional() private readonly toolDispatch?: ToolDispatchService,
    @Optional() private readonly hitlRequests?: HitlRequestService,
    @Optional() private readonly runtimeScheduler?: RuntimeExecutionScheduler,
    @Optional() private readonly executionProfiles?: ExecutionProfileService,
    @Optional() private readonly nativeApprovals?: NativeApprovalService,
  ) {}

  async approveAndResumeTool(
    requestId: string,
    sessionId: string,
    message: string | undefined,
    emit: EmitFn,
  ): Promise<boolean> {
    if (this.nativeApprovals && await this.nativeApprovals.resolve(requestId, sessionId, 'accept', message)) {
      return true;
    }
    if (!this.hitlRequests) return false;
    const pending = await this.hitlRequests.getById(requestId);
    if (!pending || pending.sessionId !== sessionId || pending.status !== 'pending') return false;
    const approved = await this.hitlRequests.resolve(
      pending.id,
      pending.revision,
      'approved',
      message ? { message } : undefined,
    );
    return approved ? this.resumeApprovedTool(requestId, emit) : false;
  }

  async cancelPendingTool(requestId: string, sessionId: string, message?: string): Promise<boolean> {
    if (this.nativeApprovals && await this.nativeApprovals.resolve(requestId, sessionId, 'cancel', message)) {
      return true;
    }
    if (!this.hitlRequests) return false;
    const pending = await this.hitlRequests.getById(requestId);
    if (!pending || pending.sessionId !== sessionId || pending.status !== 'pending') return false;
    return this.hitlRequests.resolve(
      pending.id,
      pending.revision,
      'cancelled',
      message ? { message } : undefined,
    );
  }

  async resumeApprovedTool(requestId: string, emit: EmitFn): Promise<boolean> {
    if (!this.hitlRequests || !this.toolDispatch || !this.contextAssembly) return false;
    const approved = await this.hitlRequests.getById(requestId);
    const cursor = approved?.continuation;
    const payload = approved?.payload;
    if (
      !approved || approved.kind !== 'tool_confirmation' || approved.status !== 'approved'
      || !approved.turnId || !approved.toolCallId
      || !cursor || cursor['kind'] !== 'approved_tool_then_resume_turn'
      || cursor['executionState'] !== 'pending'
      || typeof cursor['promptMessageId'] !== 'string'
      || typeof cursor['iteration'] !== 'number' || typeof cursor['currentLimit'] !== 'number'
      || !payload || typeof payload['toolName'] !== 'string'
      || !payload['args'] || typeof payload['args'] !== 'object' || Array.isArray(payload['args'])
    ) return false;

    const runtimeKind = cursor['runtimeKind'];
    if (runtimeKind !== 'chat' && runtimeKind !== 'subagent' && runtimeKind !== 'agent-flow-branch') return false;
    if (runtimeKind === 'chat' && (!approved.runId || !this.runJournal)) return false;

    const claimed = await this.hitlRequests.claimApprovedContinuation(approved.id, approved.revision);
    if (!claimed) return false;
    const session = await this.sessions.get(claimed.sessionId);
    const executionProfile = this.executionProfiles
      ? await this.executionProfiles.assertEnabled(session.executionProfileId ?? '')
      : undefined;
    const runtimeContext = session.runtimeContext ?? { runtimeKind: 'chat' as const, systemPromptProfile: 'default-chat' as const };
    const assembled = await this.contextAssembly.assembleForSessionRuntime(session.personaId, runtimeContext);
    const controller = new AbortController();
    this.abortControllers.set(claimed.sessionId, controller);
    const resumeLease = createRuntimeExecutionLeaseController(this.runtimeScheduler, {
      projectId: session.projectId ?? 'system:none',
      priority: 'control',
      label: `resume:${claimed.sessionId}:${claimed.turnId ?? requestId}`,
    });
    const toolName = payload['toolName'];
    const args = payload['args'] as Record<string, unknown>;
    try {
      await resumeLease.acquire();
      const runId = claimed.runId ?? undefined;
      const turnId = claimed.turnId;
      const toolCallId = claimed.toolCallId;
      if (!turnId || !toolCallId) return false;
      if (runId) await this.runJournal?.checkpoint(runId, { phase: 'tool_running', status: 'active' });
      const result = await this.toolDispatch.dispatchApproved(toolCallId, toolName, args, {
        sessionId: claimed.sessionId,
        runId,
        turnId,
        promptMessageId: cursor['promptMessageId'],
        messageId: typeof cursor['messageId'] === 'string' ? cursor['messageId'] : nanoid(),
        vfsSessionId: typeof cursor['vfsSessionId'] === 'string' ? cursor['vfsSessionId'] : undefined,
        historySessionId: typeof cursor['historySessionId'] === 'string' ? cursor['historySessionId'] : undefined,
        runtimeKind,
        iteration: cursor['iteration'],
        currentLimit: cursor['currentLimit'],
        abortSignal: controller.signal,
        state: new TurnState(),
        emit,
      }, assembled.toolMetas);
      await this.sessionManager.saveToolResult(claimed.sessionId, toolCallId, serializeToolResultContent(toolName, result), {
        turnId,
        promptMessageId: cursor['promptMessageId'],
      });
      const committed = await this.hitlRequests.markContinuationToolResult(claimed.id, claimed.revision, { status: result.status });
      if (!committed) throw new Error('Unable to persist approved tool result continuation state');
      emit('tool:result', result);
      const loopResult = await this.llmTurnRuntime.runAgentLoop({
        runtimeKind, sessionId: claimed.sessionId, runId, turnId,
        historySessionId: typeof cursor['historySessionId'] === 'string' ? cursor['historySessionId'] : undefined,
        vfsSessionId: typeof cursor['vfsSessionId'] === 'string' ? cursor['vfsSessionId'] : undefined,
        promptMessageId: cursor['promptMessageId'], personaId: session.personaId,
        effectiveSystemPrompt: assembled.effectiveSystemPrompt, toolMetas: assembled.toolMetas, model: assembled.model,
        executionProfile, externalThreadId: session.externalThreadId,
         providerCompletesTurn: executionProfile?.kind === 'codex-app-server',
         onExternalRuntimeLost: () => controller.abort(),
         cwd: readExecutionCwd(session.runtimeContext),
         onExternalThreadBound: async (externalThreadId, binding) => bindExternalRuntime({
           sessions: this.sessions, runJournal: this.runJournal, sessionId: claimed.sessionId, runId, externalThreadId, binding,
         }),
          onNativeApprovalRequested: createNativeApprovalCallback(this.nativeApprovals, {
            sessionId: claimed.sessionId, turnId, runId, emit, abortSignal: controller.signal, hitlRequests: this.hitlRequests,
          }),
         onExternalAudit: createExternalAuditCallback(this.audit, claimed.sessionId),
        abortSignal: controller.signal, emit, maxIterations: cursor['currentLimit'],
        resumeState: { iteration: cursor['iteration'], currentLimit: cursor['currentLimit'] },
        maxEmptyNoToolRetries: Math.max(5, cursor['currentLimit'] * 2), auditDomain: 'chat',
        callbacks: {
          onBeforeIteration: async () => { if (runId) await this.runJournal?.checkpoint(runId, { phase: 'llm_streaming', status: 'active' }); },
          onToolPending: async () => { if (runId) await this.runJournal?.checkpoint(runId, { phase: 'tool_pending' }); },
          onWaitingForHuman: async () => { if (runId) await this.runJournal?.checkpoint(runId, { phase: 'tool_pending', status: 'waiting_for_human' }); },
          onToolRunning: async () => { if (runId) await this.runJournal?.checkpoint(runId, { phase: 'tool_running' }); },
        },
      });
       if (loopResult.aborted) {
         if (runId) await this.runJournal?.interrupt(runId, 'Turn interrupted because the external Codex runtime was lost.');
         emit('chat:error', {
           sessionId: claimed.sessionId,
           code: 'INTERRUPTED',
           message: 'Turn interrupted because the external Codex runtime was lost.',
           hadContent: false,
         });
       } else if (runId && loopResult.maxIterationsReached) await this.runJournal?.fail(runId, 'MAX_ITERATIONS_REACHED', `Agent loop exceeded ${loopResult.finalLimit} iterations`);
      else if (runId && loopResult.emptyNoToolRetriesExhausted) await this.runJournal?.fail(runId, 'LLM_ERROR', 'Agent produced empty output after resume');
      else if (runId) await this.runJournal?.complete(runId, {
        finalText: loopResult.finalText,
        structuredOutput: loopResult.structuredOutput,
        messageId: loopResult.lastMessageId,
      });
      emit('agent:done', { sessionId: claimed.sessionId, turnId });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
       if (controller.signal.aborted) {
         if (claimed.runId) await this.runJournal?.interrupt(claimed.runId, 'Turn interrupted because the external Codex runtime was lost.');
         emit('chat:error', {
           sessionId: claimed.sessionId,
           code: 'INTERRUPTED',
           message: 'Turn interrupted because the external Codex runtime was lost.',
           hadContent: false,
         });
       } else {
         if (claimed.runId) await this.runJournal?.fail(claimed.runId, 'TOOL_EXECUTION_FAILED', message);
         emit('chat:error', { sessionId: claimed.sessionId, code: 'LLM_ERROR', message, hadContent: false });
       }
      if (claimed.turnId) emit('agent:done', { sessionId: claimed.sessionId, turnId: claimed.turnId });
      return false;
    } finally {
      resumeLease.release();
      if (this.abortControllers.get(claimed.sessionId) === controller) this.abortControllers.delete(claimed.sessionId);
    }
  }

  async handleTurn(
    sessionId: string,
    content: string,
    personaId: string,
    emit: EmitFn,
    attachments?: import('@kalio/types').ChatAttachment[],
    suppliedTurnId?: string,
    runId?: string,
    clientMessageId?: string,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);
    let executionLeaseController: RuntimeExecutionLeaseController | undefined;

    const firstMessageId = nanoid();
    const turnId = suppliedTurnId ?? nanoid();
    let hadContent = false;
    const trackingEmit: EmitFn = (event, data) => {
      if (event === 'chat:chunk') hadContent = true;
      emit(event, data);
    };
    const checkpointRun = async (
      phase: import('@kalio/types').ChatRunPhase,
      extra?: Parameters<RunJournalService['checkpoint']>[1],
    ): Promise<void> => {
      if (!runId || !this.runJournal) return;
      await this.runJournal.checkpoint(runId, { phase, ...extra });
    };

    try {
      await this.sessionManager.ensureSession(sessionId, personaId);
      const session = await this.sessions.get(sessionId);
      const executionProfile = this.executionProfiles
        ? await this.executionProfiles.assertEnabled(session.executionProfileId ?? '')
        : undefined;
      await this.sessions.registerRuntimeProjectPathForSession(sessionId);
      const runtimeContext = session.runtimeContext ?? {
        runtimeKind: 'chat' as const,
        systemPromptProfile: 'default-chat' as const,
      };
      executionLeaseController = createRuntimeExecutionLeaseController(this.runtimeScheduler, {
        projectId: session.projectId ?? 'system:none',
        priority: runtimeExecutionPriority(runtimeContext.runtimeKind),
        label: `chat:${sessionId}:${turnId}`,
      });
      const pendingRAAppLaunchIntent = readPendingRAAppLaunchIntent(sessionId, personaId, runtimeContext);
      const pendingRAAppInputs = readPendingRAAppLaunchInputs(runtimeContext);
      let consumedPendingRAAppLaunchIntent = false;

      if (!this.contextAssembly) {
        throw new Error('ContextAssemblyService is required for chat turns');
      }

      const promptMessage = await this.sessionManager.persistUserMessage(sessionId, content, attachments, {
        turnId,
        messageId: normalizeClientMessageId(clientMessageId),
      });
      await executionLeaseController.acquire();
      const promptMessageId = promptMessage?.id;
      trackingEmit('agent:start', { sessionId, turnId, promptMessageId });
      await checkpointRun('started', {
        runtimeKind: runtimeContext.runtimeKind,
        ...(executionProfile ? {
          provider: executionProfile.kind,
          model: executionProfile.model || undefined,
          executionProfileId: executionProfile.id,
        } : {}),
        ...(session.externalThreadId ? { externalThreadId: session.externalThreadId } : {}),
      });

      const assembledContext = await this.contextAssembly.assembleForSessionRuntime(personaId, runtimeContext);

      trackingEmit('chat:context', {
        sessionId,
        systemPrompt: assembledContext.effectiveSystemPrompt,
        toolNames: assembledContext.toolMetas.map((tool) => tool.name),
      });

      const systemMaxToolAttempts = await this.credentialsService.getMaxToolAttempts();
      const maxToolAttempts = assembledContext.personaConfig?.maxToolAttempts ?? systemMaxToolAttempts;
      const maxEmptyNoToolRetries = Math.max(5, maxToolAttempts * 2);

      const loopResult = await this.llmTurnRuntime.runAgentLoop({
        runtimeKind: 'chat',
        sessionId,
        runId,
        turnId,
        promptMessageId,
        personaId,
        effectiveSystemPrompt: assembledContext.effectiveSystemPrompt,
         toolMetas: assembledContext.toolMetas,
         model: assembledContext.model,
         executionProfile,
         externalThreadId: session.externalThreadId,
         providerCompletesTurn: executionProfile?.kind === 'codex-app-server',
          onExternalRuntimeLost: () => controller.abort(),
          cwd: readExecutionCwd(runtimeContext),
          onExternalThreadBound: async (externalThreadId, binding) => bindExternalRuntime({
            sessions: this.sessions, runJournal: this.runJournal, sessionId, runId, externalThreadId, binding,
          }),
          onNativeApprovalRequested: createNativeApprovalCallback(this.nativeApprovals, {
            sessionId, turnId, runId, emit: trackingEmit, abortSignal: controller.signal, hitlRequests: this.hitlRequests,
          }),
          onExternalAudit: createExternalAuditCallback(this.audit, sessionId),
        abortSignal: controller.signal,
        emit: trackingEmit,
        maxIterations: maxToolAttempts,
        maxEmptyNoToolRetries,
        firstMessageId,
        auditDomain: 'chat',
        transformToolCall: pendingRAAppLaunchIntent
          ? (toolCall) => {
              if (consumedPendingRAAppLaunchIntent || toolCall.name !== 'run_raapp') {
                return toolCall;
              }
              consumedPendingRAAppLaunchIntent = true;
              const requestedId = typeof toolCall.args['id'] === 'string' ? toolCall.args['id'].trim() : '';
              if (requestedId && requestedId !== pendingRAAppLaunchIntent.appId) {
                this.logger.warn(
                  `Overriding run_raapp target for session ${sessionId} from "${requestedId}" to "${pendingRAAppLaunchIntent.appId}"`,
                );
              }
              const args: Record<string, unknown> = {
                ...toolCall.args,
                id: pendingRAAppLaunchIntent.appId,
              };
              if (pendingRAAppInputs) args.inputs = pendingRAAppInputs;
              return {
                ...toolCall,
                args,
              };
            }
          : undefined,
        callbacks: {
          onBeforeIteration: async (iteration, messageId, currentLimit) => {
            await executionLeaseController?.acquire();
            trackingEmit('agent:budget_progress', {
              sessionId,
              turnId,
              messageId,
              usedIterations: iteration,
              currentLimit,
              status: 'running',
              runtimeKind: 'chat',
              personaId,
              updatedAt: Date.now(),
            });
            await checkpointRun('llm_streaming');
          },
          onToolPending: async () => {
            await checkpointRun('tool_pending');
          },
          onWaitingForHuman: async () => {
            await checkpointRun('tool_pending', { status: 'waiting_for_human' });
            executionLeaseController?.release();
          },
          onToolRunning: async () => {
            await executionLeaseController?.acquire();
            await checkpointRun('tool_running');
          },
          onEscalation: (message) => {
            void this.audit.log({
              sessionId,
              type: 'escalation',
              label: 'Agent Escalation',
              data: { message },
            });
          },
          onIterationLimitReached: async ({ iterationCount, currentLimit }) => {
            executionLeaseController?.release();
            trackingEmit('agent:budget_progress', {
              sessionId,
              turnId,
              messageId: firstMessageId,
              usedIterations: iterationCount,
              currentLimit,
              status: 'exhausted',
              runtimeKind: 'chat',
              personaId,
              updatedAt: Date.now(),
            });
            await checkpointRun('tool_pending', { status: 'waiting_for_human' });
            return this.agentBudgetApprovals.requestAdditionalBudget(
              {
                sessionId,
                turnId,
                promptMessageId,
                vfsSessionId: undefined,
                messageId: firstMessageId,
                abortSignal: controller.signal,
                state: new TurnState(),
                emit: trackingEmit,
              },
              {
                currentLimit,
                usedIterations: iterationCount,
                personaId,
                runtimeKind: 'chat',
                requestedBy: 'chat-agent',
              },
            );
          },
        },
      });
      if (consumedPendingRAAppLaunchIntent) {
        await this.sessions.updateRuntimeContext(
          sessionId,
          stripPendingRAAppLaunchRuntimeContext(runtimeContext),
        );
      }

      if (controller.signal.aborted) {
        if (runId) await this.runJournal?.interrupt(runId, 'Turn interrupted by user');
        trackingEmit('chat:error', {
          sessionId,
          code: 'INTERRUPTED',
          message: 'Turn interrupted by user',
          hadContent,
        });
      } else if (loopResult.maxIterationsReached) {
        if (runId) await this.runJournal?.fail(runId, 'MAX_ITERATIONS_REACHED', `Agent loop exceeded ${loopResult.finalLimit} iterations`);
        trackingEmit('chat:error', {
          sessionId,
          code: 'MAX_ITERATIONS_REACHED',
          message: `Agent loop exceeded ${loopResult.finalLimit} iterations`,
          hadContent,
        });
      } else if (loopResult.emptyNoToolRetriesExhausted) {
        if (runId) await this.runJournal?.fail(runId, 'LLM_ERROR', `Agent produced empty output ${maxEmptyNoToolRetries} times in a row`);
        trackingEmit('chat:error', {
          sessionId,
          code: 'LLM_ERROR',
          message: `Agent produced empty output ${maxEmptyNoToolRetries} times in a row`,
          hadContent,
        });
      } else {
        if (runId) await this.runJournal?.complete(runId, {
          finalText: loopResult.finalText,
          structuredOutput: loopResult.structuredOutput,
          messageId: loopResult.lastMessageId,
        });
        trackingEmit('chat:complete', { sessionId, messageId: loopResult.lastMessageId });
      }
      trackingEmit('agent:done', { sessionId, turnId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorCode = getChatErrorCode(err);
      this.logger.error(
        `Turn failed session=${sessionId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      if (controller.signal.aborted) {
        if (runId) await this.runJournal?.interrupt(runId, 'Turn interrupted because the external Codex runtime was lost.');
        if (!(err instanceof TurnErrorAlreadyEmitted)) {
          emit('chat:error', {
            sessionId,
            code: 'INTERRUPTED',
            message: 'Turn interrupted because the external Codex runtime was lost.',
            hadContent,
          });
        }
      } else if (!(err instanceof TurnErrorAlreadyEmitted)) {
        emit('chat:error', { sessionId, code: errorCode, message, hadContent });
      }
      if (!controller.signal.aborted && runId) await this.runJournal?.fail(runId, errorCode, message);
      emit('agent:done', { sessionId, turnId });
      void this.audit.log({
        sessionId,
        type: 'error',
        label: firstMessageId,
        data: { message },
      });
    } finally {
      executionLeaseController?.release();
      if (this.abortControllers.get(sessionId) === controller) {
        this.abortControllers.delete(sessionId);
      }
    }
  }

  abort(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }
}

function readExecutionCwd(runtimeContext: import('@kalio/types').SessionRuntimeContext | undefined): string | undefined {
  const value = runtimeContext?.architectureContext?.['executionCwd']
    ?? runtimeContext?.architectureContext?.['projectPath'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
