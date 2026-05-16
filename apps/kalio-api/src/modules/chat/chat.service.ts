import { Injectable, Inject, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { ToolMeta } from '@kalio/types';
import type { ILLMSource } from './interfaces/llm-source.interface';
import type { EmitFn, StreamContext } from './interfaces/stream-context.interface';
import { TurnState } from './turn-state';
import { StreamProcessorService } from './stream-processor.service';
import { ToolDispatchService } from './tool-dispatch.service';
import { SessionManagerService } from './session-manager.service';
import { AuditService } from './audit.service';
import { LLM_SOURCE } from './chat.tokens';
import { TurnErrorAlreadyEmitted } from './turn-error';
import { PersonaService } from '../persona/persona.service';
import { SkillsService } from '../skills/skills.service';
import { CredentialsService } from '../credentials/credentials.service';

/**
 * Orchestrates a single conversation turn:
 *  1. Ensures the session row exists in the DB (upsert).
 *  2. Loads persona config → system prompt + available tools.
 *  3. Persists the user message.
 *  4. Loads history and prepends the system message.
 *  5. Emits chat:context with real system prompt and filtered tool names.
 *  6. Streams from ILLMSource, forwarding each chunk through StreamProcessorService.
 *  7. Writes audit records for observability.
 *  8. Handles abort via AbortController keyed by sessionId.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    @Inject(LLM_SOURCE) private readonly llmSource: ILLMSource,
    private readonly streamProcessor: StreamProcessorService,
    private readonly sessionManager: SessionManagerService,
    private readonly toolDispatch: ToolDispatchService,
    private readonly personaService: PersonaService,
    private readonly skillsService: SkillsService,
    private readonly credentialsService: CredentialsService,
    private readonly audit: AuditService,
  ) {}

  async handleTurn(
    sessionId: string,
    content: string,
    personaId: string,
    emit: EmitFn,
    attachments?: import('@kalio/types').ChatAttachment[],
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    const firstMessageId = nanoid();
    let lastMessageId = firstMessageId;
    const turnId = nanoid();
    // Tracks whether at least one chat:chunk was emitted so the FE can
    // choose between appending an error to an existing bubble (hadContent=true)
    // vs rolling back an empty bubble and offering retry (hadContent=false).
    let hadContent = false;
    const trackingEmit: EmitFn = (event, data) => {
      if (event === 'chat:chunk') hadContent = true;
      emit(event, data);
    };

    try {
      // Signal start of agent turn so the FE can open an AgentTurn bubble
      // BEFORE any chunks arrive. Without this the chunk handler has no
      // activeTurnId to attach text/tool items to and the live stream is
      // invisible (only history reload would reconstruct it).
      trackingEmit('agent:start', { sessionId, turnId });

      // Ensure session row exists before any FK-constrained inserts
      await this.sessionManager.ensureSession(sessionId, personaId);

      // Resolve persona config for system prompt and tool filtering
      const personaConfig = await this.personaService.getSessionConfig(personaId);
      const systemPrompt = personaConfig?.systemPrompt ?? '';

      await this.sessionManager.persistUserMessage(sessionId, content, attachments);

      // Filter tools to persona's allowed skill set (empty = all tools allowed)
      const allToolMetas = this.toolDispatch.getToolMetas();
      const toolMetas = this.filterTools(
        allToolMetas,
        personaConfig?.allowedTools,
        personaConfig?.mcpPolicy ?? 'allow_all',
      );

      // Inject active skill prompts into system prompt
      const skillIds = personaConfig?.skillIds ?? [];
      const activeSkills = skillIds.length > 0
        ? await this.skillsService.findByIds(skillIds)
        : [];
      const skillsSection = activeSkills.length > 0
        ? `\n\n## Active skills\n` +
          activeSkills.map((s) => `### ${s.name}\n${s.description}\n\n${s.prompt}`).join('\n\n')
        : '';

      // Append a compact tool listing to the system prompt so the agent
      // knows what tools are available without calling list_tools first.
      const toolsSection = toolMetas.length > 0
        ? `\n\n## Available tools (${toolMetas.length})\n` +
          toolMetas.map(t => {
            const desc = t.description.length > 80
              ? t.description.slice(0, 79) + '…'
              : t.description;
            return `- ${t.name}: ${desc}`;
          }).join('\n')
        : '';
      const effectiveSystemPrompt = systemPrompt + skillsSection + toolsSection;

      trackingEmit('chat:context', {
        sessionId,
        systemPrompt,
        toolNames: toolMetas.map(t => t.name),
      });

      // Agentic loop: keep calling LLM until it stops emitting tool calls
      // or we hit maxToolAttempts as a safety net.
      const maxToolAttempts = await this.credentialsService.getMaxToolAttempts();
      const maxEmptyNoToolRetries = Math.max(5, maxToolAttempts * 2);
      let iteration = 0;
      let emptyNoToolRetries = 0;
      let emptyNoToolRetriesExhausted = false;
      // Declared outside the loop so that the MAX_ITERATIONS guard can read
      // the value from the last completed iteration.
      let iterationMessageId = firstMessageId;

      while (true) {
        if (controller.signal.aborted) break;
        iteration++;
        if (iteration > maxToolAttempts) {
          this.logger.warn(
            `Agent loop exceeded ${maxToolAttempts} iterations for session ${sessionId}`,
          );
          lastMessageId = iterationMessageId;
          break;
        }

        iterationMessageId = iteration === 1 ? firstMessageId : nanoid();

        const state = new TurnState();
        const ctx: StreamContext = {
          sessionId,
          messageId: iterationMessageId,
          abortSignal: controller.signal,
          state,
          emit: trackingEmit,
        };

        // Reload history so it picks up tool_result rows persisted by ToolCallHandler
        const { history, unboundedHistoryCount } = await this.sessionManager.loadHistoryForLLM(sessionId, {
          systemPrompt: effectiveSystemPrompt,
          toolMetas,
        });

        if (history.length !== unboundedHistoryCount) {
          this.logger.warn(
            `Compacted LLM history for session ${sessionId} iteration ${iteration} from ${unboundedHistoryCount} to ${history.length} messages`,
          );
        }

        const turnStart = performance.now();
        await this.audit.log({
          sessionId,
          type: 'llm_request',
          label: iterationMessageId,
          data: {
            personaId,
            iteration,
            messageCount: history.length,
            toolCount: toolMetas.length,
          },
        });

        // Pre-insert llm_response so we can update chunkCount live during streaming
        const auditResId = await this.audit.log({
          sessionId,
          type: 'llm_response',
          label: iterationMessageId,
          data: {
            iteration,
            textLength: 0,
            thinkingLength: 0,
            toolCallCount: 0,
          },
          chunkCount: 0,
        });

        const params = {
          messages: history,
          tools: toolMetas,
          sessionId,
          messageId: iterationMessageId,
          abortSignal: controller.signal,
        };

        let chunkCount = 0;
        let lastAuditUpdate = performance.now();

        for await (const chunk of this.llmSource.stream(params)) {
          if (controller.signal.aborted) break;
          chunkCount++;
          await this.streamProcessor.process(chunk, ctx);
          // Throttle live audit updates to every 500ms so we don't hammer the DB
          if (performance.now() - lastAuditUpdate >= 500) {
            void this.audit.update(auditResId, { chunkCount });
            lastAuditUpdate = performance.now();
          }
        }

        // Tool dispatch happens AFTER the LLM iteration's `done` chunk has
        // been processed (assistant message already persisted by DoneHandler).
        // This guarantees DB row order and wire event order:
        //   assistant(tool_calls) → tool:start → tool:result → tool_result row.
        // Reloading history then yields the canonical OpenAI/Vercel sequence.
        if (!controller.signal.aborted && state.toolCalls.length > 0) {
          emptyNoToolRetries = 0;
          for (const tc of state.toolCalls) {
            if (controller.signal.aborted) break;
            trackingEmit('tool:start', { callId: tc.id, toolName: tc.name, args: tc.args });
            await this.audit.log({
              sessionId,
              type: 'tool_call',
              label: tc.name,
              data: { callId: tc.id, args: tc.args },
            });
            const toolStart = performance.now();
            const result = await this.toolDispatch.dispatch(tc.id, tc.name, tc.args, ctx, toolMetas);
            trackingEmit('tool:result', result);
            await this.audit.log({
              sessionId,
              type: 'tool_result',
              label: tc.name,
              data: { callId: tc.id, status: result.status },
              durationMs: Math.round(performance.now() - toolStart),
            });
            if (result.status !== 'cancelled') {
              const content =
                result.status === 'success'
                  ? JSON.stringify(result.data ?? '')
                  : (result.errorMessage ?? '');
              await this.sessionManager.saveToolResult(sessionId, tc.id, content);
            }
          }
        }

        // Final update: persist actual chunkCount, duration, and real text stats
        await this.audit.update(auditResId, {
          chunkCount,
          durationMs: Math.round(performance.now() - turnStart),
          data: {
            iteration,
            textLength: state.text.length,
            thinkingLength: state.thinking.length,
            toolCallCount: state.toolCalls.length,
          },
        });

        // No tool calls this iteration → final answer reached.
        if (state.toolCalls.length === 0) {
          const hasAssistantOutput = state.text.trim().length > 0 || state.thinking.trim().length > 0;
          if (!hasAssistantOutput) {
            emptyNoToolRetries++;
            if (emptyNoToolRetries <= maxEmptyNoToolRetries) {
              this.logger.warn(
                `Agent produced empty no-tool iteration for session ${sessionId} at iteration ${iteration}; retry ${emptyNoToolRetries}/${maxEmptyNoToolRetries}`,
              );
              // Empty completion retries are transport/provider recovery attempts,
              // not true tool-loop progress, so they should not consume the
              // user-configured max tool attempts budget.
              iteration--;
              continue;
            }
            this.logger.warn(
              `Agent produced empty no-tool iteration for session ${sessionId} at iteration ${iteration}; empty retry budget exhausted`,
            );
            emptyNoToolRetriesExhausted = true;
            break;
          }
          emptyNoToolRetries = 0;
          lastMessageId = iterationMessageId;
          break;
        }
      }

      // If the loop exited because of an abort (interrupt), surface a
      // structured error before agent:done so the FE can distinguish it
      // from a successful completion.
      if (controller.signal.aborted) {
        trackingEmit('chat:error', {
          sessionId,
          code: 'INTERRUPTED',
          message: 'Turn interrupted by user',
          hadContent,
        });
      } else if (iteration > maxToolAttempts) {
        trackingEmit('chat:error', {
          sessionId,
          code: 'MAX_ITERATIONS_REACHED',
          message: `Agent loop exceeded ${maxToolAttempts} iterations`,
          hadContent,
        });
      } else if (emptyNoToolRetriesExhausted) {
        trackingEmit('chat:error', {
          sessionId,
          code: 'LLM_ERROR',
          message: `Agent produced empty output ${maxEmptyNoToolRetries} times in a row`,
          hadContent,
        });
      } else {
        trackingEmit('chat:complete', { sessionId, messageId: lastMessageId });
      }
      trackingEmit('agent:done', { sessionId, turnId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Turn failed session=${sessionId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      if (!(err instanceof TurnErrorAlreadyEmitted)) {
        emit('chat:error', { sessionId, code: 'LLM_ERROR', message, hadContent });
      }
      // Always close the agent turn so the FE doesn't keep an open bubble forever
      emit('agent:done', { sessionId, turnId });
      void this.audit.log({
        sessionId,
        type: 'error',
        label: lastMessageId,
        data: { message },
      });
    } finally {
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

  private filterTools(tools: ToolMeta[], allowedTools?: string[], mcpPolicy: import('@kalio/types').MCPPolicy = 'allow_all'): ToolMeta[] {
    const nativeTools = tools.filter(t => !t.name.startsWith('mcp_'));
    const mcpTools = tools.filter(t => t.name.startsWith('mcp_'));

    // Native tools: empty allowedTools = all allowed; otherwise filter by name list
    const filteredNative = !allowedTools || allowedTools.length === 0
      ? nativeTools
      : nativeTools.filter(t => allowedTools.includes(t.name));

    // MCP tools: controlled by policy
    let filteredMcp: ToolMeta[];
    if (mcpPolicy === 'allow_all') {
      filteredMcp = mcpTools;
    } else if (mcpPolicy === 'deny_all') {
      filteredMcp = [];
    } else {
      // allow_list: specific mcp_* names stored in allowedTools array
      const toolSet = new Set(allowedTools ?? []);
      filteredMcp = mcpTools.filter(t => toolSet.has(t.name));
    }

    return [...filteredNative, ...filteredMcp];
  }
}



