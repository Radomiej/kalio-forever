import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { AgentRunContext, LLMMessage, SubagentCopiedFile, ToolMeta } from '@kalio/types';
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

const MAX_ITERATIONS = 8;
const MAX_SUBAGENT_NESTING_DEPTH = 1;

const SUBAGENT_SYSTEM_PROMPT = `You are a focused sub-agent completing a single specific task.
Act immediately. Use available tools when needed. Return a concise final result.
When delegating to a known specialist, respect the assigned persona and use the tools you were given.
After using tools, always finish with one plain-language final answer before stopping.
If you created or modified files, include the exact VFS paths in that final answer.
If a tool returns a "parent_download_url" field, that is the URL that works in the parent session — always include it in your final answer instead of the regular download_url. Format: "parent_download_url: <url> (path: <path>)".
If a tool returns download URLs or other directly usable URLs for created artifacts, include those exact URLs in that final answer with the matching file paths.
If a tool partially succeeds (for example, it saves a file but its textual result is weak), inspect the VFS if needed and still produce a final summary.
Do not ask clarifying questions. Work autonomously end-to-end.`;

type AgentRunWithDepth = AgentRunContext & { subagentDepth?: number };

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
          interlocutorLabel: 'Master agent',
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
    const trackingEmit: EmitFn | undefined = emit
      ? (event, data) => {
          if (event === 'chat:chunk') hadContent = true;
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
          tools,
          vfsSessionId,
          agentRun,
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

      const baseResultText = loopResult.finalText || 'Sub-agent completed with no output.';

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
    tools: ToolMeta[];
    vfsSessionId: string;
    agentRun: AgentRunContext;
    emit?: EmitFn;
    abortSignal: AbortSignal;
  }): Promise<{ finalText: string; lastMessageId: string }> {
    let iteration = 0;
    let latestText = '';
    let lastMessageId = `subagent-${params.agentRun.agentRunId}`;
    const personaConfig = await this.personaService.getSessionConfig(params.personaId);
    const systemPrompt = personaConfig?.systemPrompt ? `${personaConfig.systemPrompt}\n\n${SUBAGENT_SYSTEM_PROMPT}` : SUBAGENT_SYSTEM_PROMPT;

    while (iteration < MAX_ITERATIONS) {
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
      };
      const rawHistory = await this.sessionManager.loadHistory(params.childSessionId);
      const history: LLMMessage[] = [{ role: 'system', content: systemPrompt }, ...rawHistory];

      for await (const chunk of this.llmSource.stream({
        messages: history,
        tools: params.tools,
        sessionId: params.childSessionId,
        messageId,
      })) {
        if (params.abortSignal.aborted) {
          throw abortReason(params.abortSignal);
        }
        await this.streamProcessor.process(chunk, ctx);
      }

      if (state.text.trim()) latestText = state.text.trim();

      if (state.toolCalls.length === 0) {
        return { finalText: latestText, lastMessageId };
      }

      for (const toolCall of state.toolCalls) {
        if (params.abortSignal.aborted) {
          throw abortReason(params.abortSignal);
        }
        params.emit?.('tool:start', {
          callId: toolCall.id,
          toolName: toolCall.name,
          args: toolCall.args,
          sessionId: params.childSessionId,
          agentRun: params.agentRun,
        });
        const result = await this.toolDispatch.dispatch(toolCall.id, toolCall.name, toolCall.args, ctx, params.tools);
        params.emit?.('tool:result', result);
        if (result.status !== 'cancelled') {
          const content = result.status === 'success'
            ? JSON.stringify(result.data ?? '')
            : (result.errorMessage ?? '');
          await this.sessionManager.saveToolResult(params.childSessionId, toolCall.id, content);
        }
      }
    }

    this.logger.warn(`Subagent exceeded ${MAX_ITERATIONS} iterations session=${params.childSessionId}`);
    return { finalText: latestText, lastMessageId };
  }
}
