import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { AgentRunContext, LLMContent, SubagentCopiedFile, ToolMeta } from '@kalio/types';
import { TurnState } from './turn-state';
import { StreamProcessorService } from './stream-processor.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionManagerService } from './session-manager.service';
import { SessionsService } from './sessions.service';
import { LLM_SOURCE } from './chat.tokens';
import type { ILLMSource } from './interfaces/llm-source.interface';
import type { EmitFn, StreamContext } from './interfaces/stream-context.interface';
import type { SubagentRuntimePort, RunSubagentRequest, RunSubagentResult } from '../tool/subagent-runtime.port';
import { VFSService } from '../vfs/vfs.service';
import { PersonaService } from '../persona/persona.service';
import { SkillsService } from '../skills/skills.service';
import { AuditService } from './audit.service';
import { toAuditToolCallData, toAuditToolResultData } from './audit-tool-data';
import { buildSubagentLLMAuditData } from './subagent-llm-audit.helpers';

const DEFAULT_MAX_ITERATIONS = 8;
const MAX_SUBAGENT_NESTING_DEPTH = 1;

const SUBAGENT_SYSTEM_PROMPT = `You are a focused sub-agent completing a single specific task.
Act immediately. Use available tools when needed. Return a concise final result.
When delegating to a known specialist, respect the assigned persona and use the tools you were given.
After using tools, always finish with one plain-language final answer before stopping.
If you created or modified files, include the exact VFS paths in that final answer.
If a tool returns a "parent_download_url" field, that is the URL that works in the parent session - always include it in your final answer instead of the regular download_url. Format: "parent_download_url: <url> (path: <path>)".
If a tool returns download URLs or other directly usable URLs for created artifacts, include those exact URLs in that final answer with the matching file paths.
If a tool partially succeeds (for example, it saves a file but its textual result is weak), inspect the VFS if needed and still produce a final summary.
Do not ask clarifying questions. Work autonomously end-to-end.`;

type AgentRunWithDepth = AgentRunContext & { subagentDepth?: number; autoApproveTools?: string[] };
type LLMUsage = { promptTokens: number; completionTokens: number; totalTokens?: number };

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildCompactToolsSection(toolMetas: ToolMeta[]): string {
  if (toolMetas.length === 0) {
    return '\n\n## Available tools\nNo tools are available in this run. Do not emit XML tool calls, `<tool_call>` blocks, function-call markup, or requests to use tools. Return a plain-language final answer only.';
  }

  return '\n\n## Available tools\n' + toolMetas.map((tool) => {
    const desc = tool.description.length > 80
      ? `${tool.description.slice(0, 79)}...`
      : tool.description;
    const approval = tool.requiresConfirmation ? ' Requires approval.' : '';
    return `- ${tool.name}: ${desc}${approval}`;
  }).join('\n');
}

function buildSkillsSection(skills: Array<{ name: string; description: string; prompt: string }>): string {
  if (skills.length === 0) {
    return '';
  }
  return '\n\n## Active skills\n' + skills.map((skill) =>
    `### ${skill.name}\n${skill.description}\n\n${skill.prompt}`,
  ).join('\n\n');
}

function estimateContentTokens(content: LLMContent): number {
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }
  return content.reduce((total, part) => (
    part.type === 'text' ? total + estimateTextTokens(part.text) : total + 1024
  ), 0);
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Sub-agent execution aborted');
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

@Injectable()
export class SubagentRuntimeService implements SubagentRuntimePort {
  private readonly logger = new Logger(SubagentRuntimeService.name);

  constructor(
    @Inject(LLM_SOURCE) private readonly llmSource: ILLMSource,
    private readonly streamProcessor: StreamProcessorService,
    private readonly toolDispatch: ToolDispatchService,
    private readonly sessionManager: SessionManagerService,
    private readonly sessions: SessionsService,
    private readonly vfs: VFSService,
    private readonly personaService: PersonaService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly skillsService?: SkillsService,
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
    const tools = subagentDepth > MAX_SUBAGENT_NESTING_DEPTH
      ? request.availableTools.filter((tool) => tool.name !== 'run_subagent')
      : request.availableTools;
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
          personaId: request.personaId ?? 'default',
          title: `Sub-agent: ${request.objective.slice(0, 54)}`,
          kind: 'subagent',
          parentSessionId: request.parentSessionId,
          parentToolCallId: request.parentToolCallId,
        });

    if (childSession.kind !== 'subagent') {
      throw new Error(`Session ${childSession.id} is not a sub-agent session`);
    }
    if (childSession.parentSessionId !== request.parentSessionId) {
      throw new Error(`Sub-agent session ${childSession.id} does not belong to parent session ${request.parentSessionId}`);
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

    await this.sessionManager.persistUserMessage(childSessionId, objectiveWithAttachmentHint);

    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const maxIterations = Number.isFinite(request.maxIterations)
      ? Math.max(1, Math.min(100, Math.round(request.maxIterations as number)))
      : DEFAULT_MAX_ITERATIONS;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const error = new Error(`Sub-agent timed out after ${request.timeoutMs}ms`);
          controller.abort(error);
          reject(error);
        }, request.timeoutMs);
      });

      const loopResult = await Promise.race([
        this.runLoop({
          childSessionId,
          objective: objectiveWithAttachmentHint,
          personaId: request.personaId ?? childSession.personaId,
          model: request.model,
          tools,
          vfsSessionId,
          agentRun,
          auditContext: request.auditContext,
          maxIterations,
          emit: trackingEmit,
          abortSignal: controller.signal,
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

      trackingEmit?.('chat:complete', {
        sessionId: childSessionId,
        messageId: loopResult.lastMessageId,
        agentRun,
      });
      trackingEmit?.('agent:done', { sessionId: childSessionId, turnId, agentRun });

      const baseResultText = loopResult.exhausted
        ? this.exhaustedLoopResultText(maxIterations, loopResult.finalText || streamedText.trim())
        : loopResult.finalText || streamedText.trim() || 'Sub-agent completed with no output.';

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
      trackingEmit?.('chat:error', {
        sessionId: childSessionId,
        code: 'LLM_ERROR',
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

  private async runLoop(params: {
    childSessionId: string;
    objective: string;
    personaId: string;
    model?: string;
    tools: ToolMeta[];
    vfsSessionId: string;
    agentRun: AgentRunContext;
    auditContext?: Record<string, unknown>;
    maxIterations: number;
    emit?: EmitFn;
    abortSignal: AbortSignal;
  }): Promise<{ finalText: string; lastMessageId: string; exhausted: boolean }> {
    let iteration = 0;
    let latestText = '';
    let lastMessageId = `subagent-${params.agentRun.agentRunId}`;
    const personaConfig = await this.personaService.getSessionConfig(params.personaId);
    const runtimeConfig = await this.llmSource.getConfig?.();
    const requestModel = params.model?.trim();
    const personaModel = personaConfig?.model?.trim();
    const effectiveModel = requestModel || personaModel || undefined;
    const llmAuditData = buildSubagentLLMAuditData(runtimeConfig, personaConfig?.model, params.model);
    const activeSkills = personaConfig?.skillIds && personaConfig.skillIds.length > 0
      ? await this.skillsService?.findByIds(personaConfig.skillIds) ?? []
      : [];
    const skillsSection = buildSkillsSection(activeSkills);
    const baseSystemPrompt = personaConfig?.systemPrompt ? `${personaConfig.systemPrompt}\n\n${SUBAGENT_SYSTEM_PROMPT}` : SUBAGENT_SYSTEM_PROMPT;
    const systemPrompt = `${baseSystemPrompt}${skillsSection}${buildCompactToolsSection(params.tools)}`;

    while (iteration < params.maxIterations) {
      if (params.abortSignal.aborted) {
        throw abortReason(params.abortSignal);
      }
      iteration++;
      const state = new TurnState();
      const messageId = iteration === 1 ? `subagent-${params.agentRun.agentRunId}` : nanoid();
      lastMessageId = messageId;
      const ctx: StreamContext = {
        sessionId: params.childSessionId,
        vfsSessionId: params.vfsSessionId,
        messageId,
        abortSignal: params.abortSignal,
        state,
        emit: params.emit ?? (() => undefined),
        agentRun: params.agentRun,
        rawXmlToolNames: params.tools.map((tool) => tool.name),
      };
      const { history } = await this.sessionManager.loadHistoryForLLM(params.childSessionId, {
        systemPrompt,
        toolMetas: params.tools,
      });
      const turnStart = performance.now();
      await this.audit?.log({
        sessionId: params.childSessionId,
        type: 'llm_request',
        label: messageId,
        data: {
          domain: 'subagent',
          kind: 'subagent_llm_request',
          childAgentRunId: params.agentRun.agentRunId,
          parentSessionId: params.agentRun.parentSessionId,
          parentToolCallId: params.agentRun.parentToolCallId,
          iteration,
          estimatedInputTokens: history.reduce((total, item) => total + estimateContentTokens(item.content), 0),
          messageCount: history.length,
          toolCount: params.tools.length,
          ...llmAuditData,
          ...(params.auditContext ?? {}),
        },
      });
      const auditResponseId = await this.audit?.log({
        sessionId: params.childSessionId,
        type: 'llm_response',
        label: messageId,
        data: {
          domain: 'subagent',
          kind: 'subagent_llm_response',
          childAgentRunId: params.agentRun.agentRunId,
          parentSessionId: params.agentRun.parentSessionId,
          parentToolCallId: params.agentRun.parentToolCallId,
          iteration,
          textLength: 0,
          thinkingLength: 0,
          toolCallCount: 0,
          ...llmAuditData,
          ...(params.auditContext ?? {}),
        },
        chunkCount: 0,
      });
      let chunkCount = 0;
      let usage: LLMUsage | undefined;

      for await (const chunk of this.llmSource.stream({
        messages: history,
        tools: params.tools,
        sessionId: params.childSessionId,
        messageId,
        model: effectiveModel,
        abortSignal: params.abortSignal,
      })) {
        if (params.abortSignal.aborted) {
          throw abortReason(params.abortSignal);
        }
        if (chunk.type === 'usage') {
          usage = {
            promptTokens: chunk.promptTokens,
            completionTokens: chunk.completionTokens,
            totalTokens: chunk.totalTokens,
          };
          continue;
        }
        chunkCount++;
        await this.streamProcessor.process(chunk, ctx);
      }

      if (state.text.trim()) latestText = state.text.trim();
      await this.updateAuditResponse(auditResponseId, {
        chunkCount,
        durationMs: Math.round(performance.now() - turnStart),
        data: {
          domain: 'subagent',
          kind: 'subagent_llm_response',
          childAgentRunId: params.agentRun.agentRunId,
          parentSessionId: params.agentRun.parentSessionId,
          parentToolCallId: params.agentRun.parentToolCallId,
          iteration,
          textLength: state.text.length,
          thinkingLength: state.thinking.length,
          toolCallCount: state.toolCalls.length,
          usage,
          estimatedOutputTokens: estimateTextTokens(state.text) + estimateTextTokens(state.thinking),
          ...llmAuditData,
          ...(params.auditContext ?? {}),
        },
      });

      if (state.toolCalls.length === 0) {
        return { finalText: latestText, lastMessageId, exhausted: false };
      }

      for (const toolCall of state.toolCalls) {
        if (params.abortSignal.aborted) {
          throw abortReason(params.abortSignal);
        }
        const auditArgs = { ...toolCall.args, ...(params.auditContext ?? {}) };
        params.emit?.('tool:start', {
          callId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.args,
          sessionId: params.childSessionId,
          agentRun: params.agentRun,
        });
        void this.audit?.log({
          sessionId: params.childSessionId,
          type: 'tool_call',
          label: toolCall.name,
          data: {
            ...toAuditToolCallData(toolCall.id, toolCall.name, auditArgs),
            childAgentRunId: params.agentRun.agentRunId,
            parentSessionId: params.agentRun.parentSessionId,
            parentToolCallId: params.agentRun.parentToolCallId,
          },
        });
        const toolStartedAt = performance.now();
        const result = await this.toolDispatch.dispatch(toolCall.id, toolCall.name, toolCall.args, ctx, params.tools);
        params.emit?.('tool:result', result);
        void this.audit?.log({
          sessionId: params.childSessionId,
          type: 'tool_result',
          label: toolCall.name,
          data: {
            ...toAuditToolResultData(toolCall.id, toolCall.name, result, auditArgs),
            childAgentRunId: params.agentRun.agentRunId,
            parentSessionId: params.agentRun.parentSessionId,
            parentToolCallId: params.agentRun.parentToolCallId,
          },
          durationMs: Math.round(performance.now() - toolStartedAt),
        });
        const content = result.status === 'success'
          ? JSON.stringify(result.data ?? '')
          : JSON.stringify({
              status: result.status,
              errorCode: result.errorCode,
              errorMessage: result.errorMessage ?? (
                result.status === 'cancelled' ? `Tool ${toolCall.name} was cancelled or not approved.` : ''
              ),
            });
        await this.sessionManager.saveToolResult(params.childSessionId, toolCall.id, content);
      }
    }

    this.logger.warn(`Subagent exceeded ${params.maxIterations} iterations session=${params.childSessionId}`);
    return { finalText: latestText, lastMessageId, exhausted: true };
  }

  private exhaustedLoopResultText(maxIterations: number, lastText: string): string {
    const suffix = lastText.trim().length > 0
      ? ` Last assistant text before stopping: ${lastText.trim()}`
      : '';
    return `Sub-agent stopped after ${maxIterations} tool iteration${maxIterations === 1 ? '' : 's'} without producing a final answer.${suffix}`;
  }

  private async updateAuditResponse(
    auditResponseId: string | undefined,
    patch: Parameters<AuditService['update']>[1],
  ): Promise<void> {
    if (!auditResponseId || !this.audit) return;
    const auditWithUpdate = this.audit as AuditService & { update?: AuditService['update'] };
    await auditWithUpdate.update?.(auditResponseId, patch);
  }
}
