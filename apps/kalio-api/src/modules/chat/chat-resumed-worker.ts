import type { HitlRequestService } from '../hitl/hitl-request.service';
import type { RuntimeExecutionScheduler } from '../agent-runtime/runtime-execution.scheduler';
import { createRuntimeExecutionLeaseController, type RuntimeExecutionLeaseController } from '../agent-runtime/runtime-execution-lease.controller';
import type { ExecutionProfileService } from '../agent-runtime/execution-profile.service';
import type { NativeApprovalService } from '../agent-runtime/native-approval.service';
import type { SessionManagerService } from './session-manager.service';
import type { SessionsService } from './sessions.service';
import type { AuditService } from './audit.service';
import type { ContextAssemblyService } from './context-assembly.service';
import { serializeToolResultContent, type LLMTurnRuntimeService } from './llm-turn-runtime.service';
import type { ToolDispatchService } from './tool-dispatch.service';
import type { RunJournalService } from './run-journal.service';
import type { EmitFn, StreamContext } from './interfaces/stream-context.interface';
import { Logger } from '@nestjs/common';
import { approvedToolContext, readExecutionCwd } from './chat-input.helpers';
import { createExternalAuditCallback, createNativeApprovalCallback } from './runtime-provider-callbacks';
import { bindExternalRuntime } from './runtime-external-binding';

type Request = NonNullable<Awaited<ReturnType<HitlRequestService['getById']>>>;

export function readApprovedContinuation(approved: Request | null) {
  const cursor = approved?.continuation;
  const payload = approved?.payload;
  if (!approved || approved.kind !== 'tool_confirmation' || approved.status !== 'approved'
    || !approved.turnId || !approved.toolCallId
    || !cursor || cursor['kind'] !== 'approved_tool_then_resume_turn' || cursor['executionState'] !== 'pending'
    || typeof cursor['promptMessageId'] !== 'string'
    || typeof cursor['iteration'] !== 'number' || typeof cursor['currentLimit'] !== 'number'
    || !payload || typeof payload['toolName'] !== 'string'
    || !payload['args'] || typeof payload['args'] !== 'object' || Array.isArray(payload['args'])) return null;
  const runtimeKind = cursor['runtimeKind'];
  if (runtimeKind !== 'chat' && runtimeKind !== 'subagent' && runtimeKind !== 'agent-flow-branch') return null;
  const resumeCursor: Parameters<typeof approvedToolContext>[1] = {
    ...cursor, promptMessageId: cursor['promptMessageId'], iteration: cursor['iteration'], currentLimit: cursor['currentLimit'],
  };
  return {
    approved, turnId: approved.turnId, runtimeKind: runtimeKind as NonNullable<StreamContext['runtimeKind']>,
    toolName: payload['toolName'], args: payload['args'] as Record<string, unknown>,
    cursor: resumeCursor,
  };
}

/** Runs only inside the pipeline reservation; result persistence survives cancellation after an effect. */
export async function runApprovedToolContinuation(input: NonNullable<ReturnType<typeof readApprovedContinuation>> & {
  controller: AbortController;
  emit: EmitFn;
  hitlRequests: HitlRequestService;
  toolDispatch: ToolDispatchService;
  contextAssembly: ContextAssemblyService;
  sessionManager: SessionManagerService;
  sessions: SessionsService;
  llmTurnRuntime: LLMTurnRuntimeService;
  audit: AuditService;
  runJournal?: RunJournalService;
  runtimeScheduler?: RuntimeExecutionScheduler;
  executionProfiles?: ExecutionProfileService;
  nativeApprovals?: NativeApprovalService;
  approve?: () => Promise<Request | null>;
}): Promise<boolean> {
  const { cursor, runtimeKind, controller, emit, toolName, args } = input;
  let approved = input.approved;
  let claimed: Request | null = null;
  let lease: RuntimeExecutionLeaseController | undefined;
  let externalRuntimeLost = false;
  const interruptionMessage = () => externalRuntimeLost
    ? 'Turn interrupted because the external agent runtime was lost.' : 'Turn interrupted by user';
  try {
    controller.signal.throwIfAborted();
    if (input.approve) {
      const resolved = await input.approve();
      if (!resolved) return false;
      approved = resolved;
    }
    // Even if Stop crossed approval persistence, consume its cursor before
    // observing cancellation so the approved effect cannot be replayed later.
    claimed = await input.hitlRequests.claimApprovedContinuation(approved.id, approved.revision);
    if (!claimed) return false;
    controller.signal.throwIfAborted();
    const session = await input.sessions.get(claimed.sessionId);
    controller.signal.throwIfAborted();
    const executionProfile = input.executionProfiles
      ? await input.executionProfiles.assertEnabled(session.executionProfileId ?? '') : undefined;
    controller.signal.throwIfAborted();
    const runtimeContext = session.runtimeContext ?? { runtimeKind: 'chat' as const, systemPromptProfile: 'default-chat' as const };
    const assembled = await input.contextAssembly.assembleForSessionRuntime(session.personaId, runtimeContext);
    controller.signal.throwIfAborted();
    lease = createRuntimeExecutionLeaseController(input.runtimeScheduler, {
      projectId: session.projectId ?? 'system:none', priority: 'control', label: `resume:${claimed.sessionId}:${input.turnId}`,
    });
    await lease.acquire();
    controller.signal.throwIfAborted();
    const runId = claimed.runId ?? undefined;
    const turnId = claimed.turnId;
    const toolCallId = claimed.toolCallId;
    if (!turnId || !toolCallId) return false;
    if (runId) await input.runJournal?.checkpoint(runId, { phase: 'tool_running', status: 'active' });
    controller.signal.throwIfAborted();
    const result = await input.toolDispatch.dispatchApproved(toolCallId, toolName, args, approvedToolContext({
      sessionId: claimed.sessionId, runId, turnId, runtimeKind, abortSignal: controller.signal, emit,
    }, cursor), assembled.toolMetas);
    // Once the tool returns, commit both durable records before honoring Stop; never replay its effect.
    await input.sessionManager.saveToolResult(claimed.sessionId, toolCallId, serializeToolResultContent(toolName, result), {
      turnId, promptMessageId: cursor.promptMessageId,
    });
    const committed = await input.hitlRequests.markContinuationToolResult(claimed.id, claimed.revision, { status: result.status });
    if (!committed) throw new Error('Unable to persist approved tool result continuation state');
    emit('tool:result', result);
    controller.signal.throwIfAborted();
    const sessionId = claimed.sessionId;
    const loopResult = await input.llmTurnRuntime.runAgentLoop({
      runtimeKind, sessionId, runId, turnId,
      historySessionId: typeof cursor['historySessionId'] === 'string' ? cursor['historySessionId'] : undefined,
      vfsSessionId: typeof cursor['vfsSessionId'] === 'string' ? cursor['vfsSessionId'] : undefined,
      promptMessageId: cursor.promptMessageId, personaId: session.personaId,
      effectiveSystemPrompt: assembled.effectiveSystemPrompt, toolMetas: assembled.toolMetas, model: assembled.model,
      providerToolNames: assembled.personaConfig?.providerToolNames, executionProfile, externalThreadId: session.externalThreadId,
      providerCompletesTurn: executionProfile?.kind === 'codex-app-server' || executionProfile?.kind === 'claude-agent-sdk'
        || executionProfile?.kind === 'devin-api' || executionProfile?.kind === 'devin-cli-acp',
      onExternalRuntimeLost: () => { externalRuntimeLost = true; controller.abort(); },
      cwd: readExecutionCwd(session.runtimeContext),
      onExternalThreadBound: (externalThreadId, binding) => bindExternalRuntime({
        sessions: input.sessions, runJournal: input.runJournal, sessionId, runId, externalThreadId, binding,
      }),
      onNativeApprovalRequested: createNativeApprovalCallback(input.nativeApprovals, {
        sessionId, turnId, runId, emit, abortSignal: controller.signal, hitlRequests: input.hitlRequests,
      }),
      onExternalAudit: createExternalAuditCallback(input.audit, sessionId),
      abortSignal: controller.signal, emit, maxIterations: cursor.currentLimit,
      resumeState: { iteration: cursor.iteration, currentLimit: cursor.currentLimit },
      maxEmptyNoToolRetries: Math.max(5, cursor.currentLimit * 2), auditDomain: 'chat',
      callbacks: {
        onBeforeIteration: async () => {
          await lease?.acquire();
          controller.signal.throwIfAborted();
          if (runId) await input.runJournal?.checkpoint(runId, { phase: 'llm_streaming', status: 'active' });
        },
        onToolPending: async () => { if (runId) await input.runJournal?.checkpoint(runId, { phase: 'tool_pending' }); },
        onWaitingForHuman: async () => {
          if (runId) await input.runJournal?.checkpoint(runId, { phase: 'tool_pending', status: 'waiting_for_human' });
          lease?.release();
        },
        onToolRunning: async () => {
          await lease?.acquire();
          controller.signal.throwIfAborted();
          if (runId) await input.runJournal?.checkpoint(runId, { phase: 'tool_running', status: 'active' });
        },
      },
    });
    if (controller.signal.aborted || loopResult.aborted) {
      if (runId) await input.runJournal?.interrupt(runId, interruptionMessage());
      emit('chat:error', { sessionId, code: 'INTERRUPTED', message: interruptionMessage(), hadContent: false });
    } else if (runId && loopResult.maxIterationsReached) {
      await input.runJournal?.fail(runId, 'MAX_ITERATIONS_REACHED', `Agent loop exceeded ${loopResult.finalLimit} iterations`);
    } else if (runId && loopResult.emptyNoToolRetriesExhausted) {
      await input.runJournal?.fail(runId, 'LLM_ERROR', 'Agent produced empty output after resume');
    } else if (runId) {
      await input.runJournal?.complete(runId, {
        finalText: loopResult.finalText, structuredOutput: loopResult.structuredOutput, messageId: loopResult.lastMessageId,
      });
    }
    controller.signal.throwIfAborted();
    emit('agent:done', { sessionId, turnId });
    return true;
  } catch (error) {
    new Logger('ChatResumedWorker').error(`Continuation failed session=${approved.sessionId} request=${approved.id}: ${error instanceof Error ? error.message : String(error)}`);
    if (!claimed && !controller.signal.aborted) return false;
    if (!claimed && controller.signal.aborted) {
      const approvedPending = readApprovedContinuation(await input.hitlRequests.getById(approved.id));
      if (approvedPending) claimed = await input.hitlRequests.claimApprovedContinuation(approvedPending.approved.id, approvedPending.approved.revision);
    }
    const failed = claimed ?? approved;
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted) {
      if (failed.runId) await input.runJournal?.interrupt(failed.runId, interruptionMessage());
      emit('chat:error', { sessionId: failed.sessionId, code: 'INTERRUPTED', message: interruptionMessage(), hadContent: false });
    } else {
      if (failed.runId) await input.runJournal?.fail(failed.runId, 'TOOL_EXECUTION_FAILED', message);
      emit('chat:error', { sessionId: failed.sessionId, code: 'LLM_ERROR', message, hadContent: false });
    }
    if (failed.turnId) emit('agent:done', { sessionId: failed.sessionId, turnId: failed.turnId });
    return false;
  } finally {
    lease?.release();
  }
}
