import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { AgentRunContext, ArchitectureRuntimeContext, SessionRuntimeContext, SocketEvents, SubagentCopiedFile } from '@kalio/types';
import type { EmitFn } from './interfaces/stream-context.interface';
import type { SubagentRuntimePort, RunSubagentRequest, RunSubagentResult } from '../tool/subagent-runtime.port';
import { SessionManagerService } from './session-manager.service';
import { SessionsService } from './sessions.service';
import { VFSService } from '../vfs/vfs.service';
import { AuditService } from './audit.service';
import { ContextAssemblyService } from './context-assembly.service';
import { LLMTurnRuntimeService } from './llm-turn-runtime.service';
import { ToolPolicyService } from './tool-policy.service';
import { buildSubagentLLMAuditData } from './subagent-llm-audit.helpers';
import { AgentBudgetApprovalService } from './agent-budget-approval.service';
import { LLM_SOURCE } from './chat.tokens';
import type { ILLMSource } from './interfaces/llm-source.interface';
import { TurnState } from './turn-state';

const DEFAULT_MAX_ITERATIONS = 8;

type AgentRunWithDepth = AgentRunContext & { subagentDepth?: number; autoApproveTools?: string[] };
type ChatErrorCode = SocketEvents['chat:error']['code'];

function subagentErrorCode(error: Error): ChatErrorCode {
  if ('code' in error) {
    const code = (error as { code?: unknown }).code;
    if (
      code === 'LLM_RATE_LIMIT'
      || code === 'LLM_TIMEOUT'
      || code === 'LLM_AUTH'
      || code === 'LLM_PROVIDER_DOWN'
      || code === 'LLM_QUOTA'
      || code === 'LLM_BAD_TOOL_ARGS'
      || code === 'MAX_ITERATIONS_REACHED'
    ) {
      return code;
    }
  }
  if (error.message.toLowerCase().includes('timed out')) {
    return 'LLM_TIMEOUT';
  }
  return 'LLM_ERROR';
}

function appendCopiedOutputLinks(baseText: string, parentSessionId: string, copiedFiles: SubagentCopiedFile[]): string {
  if (copiedFiles.length === 0) return baseText;

  const lines = copiedFiles.map((file) => {
    const downloadUrl = `/api/sessions/${parentSessionId}/vfs/download?path=${encodeURIComponent(file.toPath)}`;
    return `- ${file.toPath} -> ${downloadUrl}`;
  });

  return `${baseText}\n\nCopied outputs:\n${lines.join('\n')}`;
}

function buildAttachmentHint(attachmentPaths: string[]): string {
  if (attachmentPaths.length === 0) return '';
  const lines = attachmentPaths.map((path) => `- ${path}`);
  return `You have attached files available in VFS:\n${lines.join('\n')}\n\n`;
}

function runtimeContextsEqual(left: SessionRuntimeContext, right: SessionRuntimeContext): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function architectureContextForSubagent(request: RunSubagentRequest): ArchitectureRuntimeContext | undefined {
  const base = isRecord(request.architectureContext)
    ? request.architectureContext as ArchitectureRuntimeContext
    : undefined;
  if (!isRecord(request.auditContext) || !stringField(request.auditContext, 'architectureRunId')) {
    return base;
  }

  const audit = request.auditContext;
  const roleSlotId = stringField(audit, 'roleSlotId');
  const roleSlotType = stringField(audit, 'roleSlotType');
  const technicalSlot = roleSlotType === 'router'
    || roleSlotType === 'finalizer'
    || roleSlotId === 'router'
    || roleSlotId === 'finalizer'
    || roleSlotId === 'orchestrator';

  return {
    ...(base ?? {}),
    architectureRunId: stringField(audit, 'architectureRunId'),
    schemaId: stringField(audit, 'schemaId') ?? base?.schemaId,
    schemaName: stringField(audit, 'schemaName') ?? base?.schemaName,
    roleSlotId,
    roleSlotType,
    roleLabel: stringField(audit, 'roleLabel'),
    displayLabel: stringField(audit, 'displayLabel') ?? stringField(audit, 'roleLabel') ?? base?.displayLabel,
    sessionSurface: technicalSlot ? 'technical-node' : (base?.sessionSurface ?? 'conversation-branch'),
    conversationVisibility: 'visible',
  };
}

function resolveHistorySessionId(
  runtimeKind: SessionRuntimeContext['runtimeKind'],
  architectureContext: ArchitectureRuntimeContext | undefined,
  parentSessionId: string,
  childSessionId: string,
): string {
  if (runtimeKind !== 'agent-flow-branch') {
    return childSessionId;
  }
  const historySessionId = architectureContext?.historySessionId;
  if (typeof historySessionId === 'string' && historySessionId.trim().length > 0) {
    return historySessionId.trim();
  }
  const hostSessionId = architectureContext?.hostSessionId;
  if (typeof hostSessionId === 'string' && hostSessionId.trim().length > 0) {
    return hostSessionId.trim();
  }
  return parentSessionId;
}

@Injectable()
export class SubagentRuntimeService implements SubagentRuntimePort {
  private readonly logger = new Logger(SubagentRuntimeService.name);

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
  ) {}

  async runSubagent(request: RunSubagentRequest): Promise<RunSubagentResult> {
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
    const architectureContext = architectureContextForSubagent(request);
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
      architectureContext: request.architectureContext,
      subagentDepth,
      autoApproveTools: request.autoApproveTools,
    });

    const runtimeContext: SessionRuntimeContext = {
      runtimeKind,
      parentSessionId: request.parentSessionId,
      parentToolCallId: request.parentToolCallId,
      vfsMode: request.vfsMode,
      vfsSessionId,
      modelOverride: request.model,
      explicitToolNames: policyDecision.allowedToolNames,
      systemPromptProfile: runtimeKind === 'agent-flow-branch' ? 'agent-flow-branch' : 'subagent',
      architectureContext,
      architectureSlotId: typeof request.auditContext?.roleSlotId === 'string'
        ? request.auditContext.roleSlotId
        : undefined,
      architectureSlotPolicy: request.slotPolicy,
    };

    const agentRun: AgentRunWithDepth = {
      agentRunId: `subagent-${taskId}`,
      agentType: 'subagent',
      parentSessionId: request.parentSessionId,
      parentToolCallId: request.parentToolCallId,
      vfsMode: request.vfsMode,
      vfsSessionId,
      label: 'Sub-agent',
      autoApproveTools: request.autoApproveTools,
      subagentDepth,
    };

    const childSession = requestedChildSessionId
      ? await this.sessions.get(requestedChildSessionId)
      : await this.sessions.createWithId(childSessionId, {
          personaId,
          title: `Sub-agent: ${request.objective.slice(0, 54)}`,
          kind: 'subagent',
          parentSessionId: request.parentSessionId,
          parentToolCallId: request.parentToolCallId,
          runtimeContext,
        }, { registerRuntimeProjectPath: true });

    if (childSession.kind !== 'subagent') {
      throw new Error(`Session ${childSession.id} is not a sub-agent session`);
    }
    if (childSession.parentSessionId !== request.parentSessionId) {
      throw new Error(`Sub-agent session ${childSession.id} does not belong to parent session ${request.parentSessionId}`);
    }
    if (
      requestedChildSessionId
      && (!childSession.runtimeContext || !runtimeContextsEqual(childSession.runtimeContext, runtimeContext))
    ) {
      await this.sessions.updateRuntimeContext(childSession.id, runtimeContext, {
        registerRuntimeProjectPath: true,
      });
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
    let hadContent = false;
    let streamedText = '';
    const trackingEmit: EmitFn | undefined = emit
      ? (event, data) => {
          if (event === 'chat:chunk') {
            hadContent = true;
            const payload = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
            const delta = payload['delta'];
            if (typeof delta === 'string') streamedText += delta;
          }
          emit(event, data);
        }
      : undefined;

    trackingEmit?.('agent:start', { sessionId: childSessionId, turnId, agentRun });
    if (!requestedChildSessionId) {
      trackingEmit?.('session:created', childSession);
    }

    const promptMessage = await this.sessionManager.persistUserMessage(
      childSessionId,
      objectiveWithAttachmentHint,
      undefined,
      { turnId },
    );
    const promptMessageId = promptMessage?.id;

    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const error = new Error(`Sub-agent timed out after ${request.timeoutMs}ms`);
          controller.abort(error);
          reject(error);
        }, request.timeoutMs);
      });

      const toolPolicyRequest = {
        runtimeKind,
        personaId,
        sessionRuntimeContext: runtimeContext,
        explicitToolNames: policyDecision.allowedToolNames,
        explicitTools: policyDecision.tools,
        slotPolicy: request.slotPolicy,
        architectureContext: request.architectureContext,
        subagentDepth,
        autoApproveTools: request.autoApproveTools,
      } as const;

      const assembledContext = runtimeKind === 'agent-flow-branch'
        ? await this.contextAssembly.assembleForRuntime({
            runtimeKind: 'agent-flow-branch',
            personaId,
            toolPolicyRequest,
            modelOverride: request.model,
          })
        : await this.contextAssembly.assembleForRuntime({
            runtimeKind: 'subagent',
            personaId,
            toolPolicyRequest,
          });

      const runtimeConfig = await this.llmSource.getConfig?.();
      const llmAuditData = buildSubagentLLMAuditData(runtimeConfig, assembledContext.model, request.model);
      const requestModel = request.model?.trim();
      const effectiveModel = requestModel || assembledContext.model || undefined;
      const maxIterations = Number.isFinite(request.maxIterations)
        ? Math.max(1, Math.min(100, Math.round(request.maxIterations as number)))
        : Math.max(1, Math.min(100, Math.round(assembledContext.personaConfig?.maxToolAttempts ?? DEFAULT_MAX_ITERATIONS)));

      const loopResult = await Promise.race([
        this.llmTurnRuntime.runAgentLoop({
          runtimeKind,
          sessionId: childSessionId,
          historySessionId,
          turnId,
          promptMessageId,
          personaId,
          effectiveSystemPrompt: assembledContext.effectiveSystemPrompt,
          toolMetas: assembledContext.toolMetas,
          model: effectiveModel,
          vfsSessionId,
          agentRun,
          abortSignal: controller.signal,
          emit: trackingEmit ?? (() => undefined),
          maxIterations,
          rawXmlToolNames: assembledContext.toolMetas.map((tool) => tool.name),
          auditDomain: 'subagent',
          auditMetadata: { ...llmAuditData, ...(request.auditContext ?? {}) },
          firstMessageId: `subagent-${agentRun.agentRunId}`,
          messageIdPrefix: `subagent-${agentRun.agentRunId}`,
          callbacks: {
            onIterationLimitReached: async ({ iterationCount, currentLimit }) => (
              this.agentBudgetApprovals.requestAdditionalBudget(
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
              )
            ),
          },
        }),
        timeoutPromise,
      ]);

      const copiedFiles = request.copyOutputs && request.vfsMode === 'isolated'
        ? this.vfs.copySessionFiles({
            fromSessionId: childSessionId,
            toSessionId: request.parentSessionId,
            targetPrefix: request.copyTargetPrefix ?? `sub-agents/${childSessionId}`,
          }) as SubagentCopiedFile[]
        : [];

      const baseResultText = loopResult.exhausted
        ? this.exhaustedLoopResultText(maxIterations, loopResult.finalText || streamedText.trim())
        : loopResult.finalText || streamedText.trim() || 'Sub-agent completed with no output.';
      let completionMessageId = loopResult.lastMessageId;
      if (loopResult.exhausted || baseResultText === 'Sub-agent completed with no output.') {
        const completionState = new TurnState();
        completionState.replaceText(baseResultText);
        const persistedCompletionMessageId = await this.persistTerminalAssistantMessage(
          childSessionId,
          nanoid(),
          completionState,
          { turnId, promptMessageId },
          'completion fallback',
        );
        if (persistedCompletionMessageId) {
          completionMessageId = persistedCompletionMessageId;
        }
      }

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
        vfsMode: request.vfsMode,
        vfsSessionId,
        copiedFiles,
        durationMs: Math.round(performance.now() - startedAt),
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const fallbackState = new TurnState();
      fallbackState.replaceText(this.failedRunResultText(error.message, streamedText.trim()));
      await this.persistTerminalAssistantMessage(
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
          errorMessage: error.message,
          ...(request.auditContext ?? {}),
        },
        durationMs: Math.round(performance.now() - startedAt),
      });
      trackingEmit?.('agent:done', { sessionId: childSessionId, turnId, agentRun });
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  private exhaustedLoopResultText(maxIterations: number, lastText: string): string {
    const suffix = lastText.trim().length > 0
      ? ` Last assistant text before stopping: ${lastText.trim()}`
      : '';
    return `Sub-agent stopped after ${maxIterations} tool iteration${maxIterations === 1 ? '' : 's'} without producing a final answer.${suffix}`;
  }

  private failedRunResultText(errorMessage: string, lastText: string): string {
    const suffix = lastText.trim().length > 0
      ? ` Last assistant text before failure: ${lastText.trim()}`
      : '';
    return `Sub-agent failed: ${errorMessage}.${suffix}`;
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
