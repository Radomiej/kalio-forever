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
Do not ask clarifying questions. Work autonomously end-to-end.`;

type AgentRunWithDepth = AgentRunContext & { subagentDepth?: number };

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
    const childSessionId = `sub-${taskId}`;
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

    const childSession = await this.sessions.createWithId(childSessionId, {
      personaId: request.personaId ?? 'default',
      title: `Sub-agent: ${request.objective.slice(0, 54)}`,
      kind: 'subagent',
      parentSessionId: request.parentSessionId,
      parentToolCallId: request.parentToolCallId,
      interlocutorLabel: 'Master agent',
    });

    const emit = request.emit;
    emit?.('agent:start', { sessionId: childSessionId, turnId, agentRun });
    emit?.('session:created', childSession);

    await this.sessionManager.persistUserMessage(childSessionId, request.objective);

    const finalText = await this.runLoop({
      childSessionId,
      objective: request.objective,
      personaId: request.personaId ?? 'default',
      tools,
      vfsSessionId,
      agentRun,
      emit,
    });

    const copiedFiles = request.copyOutputs && request.vfsMode === 'isolated'
      ? this.vfs.copySessionFiles({
          fromSessionId: childSessionId,
          toSessionId: request.parentSessionId,
          targetPrefix: request.copyTargetPrefix ?? `sub-agents/${childSessionId}`,
        }) as SubagentCopiedFile[]
      : [];

    emit?.('chat:complete', {
      sessionId: childSessionId,
      messageId: childSessionId,
      agentRun,
    });
    emit?.('agent:done', { sessionId: childSessionId, turnId, agentRun });

    return {
      result: finalText || 'Sub-agent completed with no output.',
      taskId,
      childSessionId,
      parentSessionId: request.parentSessionId,
      vfsMode: request.vfsMode,
      vfsSessionId,
      copiedFiles,
      durationMs: Math.round(performance.now() - startedAt),
    };
  }

  private async runLoop(params: {
    childSessionId: string;
    objective: string;
    personaId: string;
    tools: ToolMeta[];
    vfsSessionId: string;
    agentRun: AgentRunContext;
    emit?: EmitFn;
  }): Promise<string> {
    const controller = new AbortController();
    let iteration = 0;
    let latestText = '';
    const personaConfig = await this.personaService.getSessionConfig(params.personaId);
    const systemPrompt = personaConfig?.systemPrompt ? `${personaConfig.systemPrompt}\n\n${SUBAGENT_SYSTEM_PROMPT}` : SUBAGENT_SYSTEM_PROMPT;

    while (iteration < MAX_ITERATIONS) {
      iteration++;
      const state = new TurnState();
      const messageId = iteration === 1 ? `subagent-${params.agentRun.agentRunId}` : nanoid();
      const ctx: StreamContext = {
        sessionId: params.childSessionId,
        vfsSessionId: params.vfsSessionId,
        messageId,
        abortSignal: controller.signal,
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
        await this.streamProcessor.process(chunk, ctx);
      }

      if (state.text.trim()) latestText = state.text.trim();

      if (state.toolCalls.length === 0) {
        return latestText;
      }

      for (const toolCall of state.toolCalls) {
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
    return latestText;
  }
}
