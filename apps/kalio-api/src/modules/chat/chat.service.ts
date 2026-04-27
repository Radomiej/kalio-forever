import { Injectable, Inject, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { LLMMessage, ToolMeta } from '@kalio/types';
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
    private readonly audit: AuditService,
  ) {}

  async handleTurn(
    sessionId: string,
    content: string,
    personaId: string,
    emit: EmitFn,
  ): Promise<void> {
    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);

    const firstMessageId = nanoid();
    let lastMessageId = firstMessageId;
    const turnId = nanoid();

    try {
      // Signal start of agent turn so the FE can open an AgentTurn bubble
      // BEFORE any chunks arrive. Without this the chunk handler has no
      // activeTurnId to attach text/tool items to and the live stream is
      // invisible (only history reload would reconstruct it).
      emit('agent:start', { sessionId, turnId });

      // Ensure session row exists before any FK-constrained inserts
      await this.sessionManager.ensureSession(sessionId, personaId);

      // Resolve persona config for system prompt and tool filtering
      const personaConfig = await this.personaService.getSessionConfig(personaId);
      const systemPrompt = personaConfig?.systemPrompt ?? '';

      await this.sessionManager.persistUserMessage(sessionId, content);

      // Filter tools to persona's allowed skill set (empty = all tools allowed)
      const allToolMetas = this.toolDispatch.getToolMetas();
      const toolMetas = this.filterTools(allToolMetas, personaConfig?.availableSkills);

      emit('chat:context', {
        sessionId,
        systemPrompt,
        toolNames: toolMetas.map(t => t.name),
      });

      // Agentic loop: keep calling LLM until it stops emitting tool calls
      // or we hit MAX_ITERATIONS as a safety net.
      const MAX_ITERATIONS = 8;
      let iteration = 0;

      while (true) {
        if (controller.signal.aborted) break;
        iteration++;
        if (iteration > MAX_ITERATIONS) {
          this.logger.warn(
            `Agent loop exceeded ${MAX_ITERATIONS} iterations for session ${sessionId}`,
          );
          break;
        }

        const iterationMessageId = iteration === 1 ? firstMessageId : nanoid();
        lastMessageId = iterationMessageId;

        const state = new TurnState();
        const ctx: StreamContext = {
          sessionId,
          messageId: iterationMessageId,
          abortSignal: controller.signal,
          state,
          emit,
        };

        // Reload history so it picks up tool_result rows persisted by ToolCallHandler
        const rawHistory = await this.sessionManager.loadHistory(sessionId);
        const history: LLMMessage[] = systemPrompt
          ? [{ role: 'system', content: systemPrompt }, ...rawHistory]
          : rawHistory;

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

        const params = {
          messages: history,
          tools: toolMetas,
          sessionId,
          messageId: iterationMessageId,
        };

        for await (const chunk of this.llmSource.stream(params)) {
          if (controller.signal.aborted) break;
          await this.streamProcessor.process(chunk, ctx);
        }

        // Tool dispatch happens AFTER the LLM iteration's `done` chunk has
        // been processed (assistant message already persisted by DoneHandler).
        // This guarantees DB row order and wire event order:
        //   assistant(tool_calls) → tool:start → tool:result → tool_result row.
        // Reloading history then yields the canonical OpenAI/Vercel sequence.
        if (!controller.signal.aborted && state.toolCalls.length > 0) {
          for (const tc of state.toolCalls) {
            if (controller.signal.aborted) break;
            emit('tool:start', { callId: tc.id, toolName: tc.name, args: tc.args });
            const result = await this.toolDispatch.dispatch(tc.id, tc.name, tc.args, ctx);
            emit('tool:result', result);
            if (result.status !== 'cancelled') {
              const content =
                result.status === 'success'
                  ? JSON.stringify(result.data ?? '')
                  : (result.errorMessage ?? '');
              await this.sessionManager.saveToolResult(sessionId, tc.id, content);
            }
          }
        }

        await this.audit.log({
          sessionId,
          type: 'llm_response',
          label: iterationMessageId,
          data: {
            iteration,
            textLength: state.text.length,
            thinkingLength: state.thinking.length,
            toolCallCount: state.toolCalls.length,
          },
          durationMs: Math.round(performance.now() - turnStart),
        });

        // No tool calls this iteration → final answer reached.
        if (state.toolCalls.length === 0) break;
      }

      // Single chat:complete + agent:done for the whole agentic chain
      emit('chat:complete', { sessionId, messageId: lastMessageId });
      emit('agent:done', { sessionId, turnId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Turn failed session=${sessionId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      if (!(err instanceof TurnErrorAlreadyEmitted)) {
        emit('chat:error', { sessionId, code: 'LLM_ERROR', message });
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
      this.abortControllers.delete(sessionId);
    }
  }

  abort(sessionId: string): void {
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.abortControllers.delete(sessionId);
    }
  }

  private filterTools(tools: ToolMeta[], availableSkills?: string[]): ToolMeta[] {
    if (!availableSkills || availableSkills.length === 0) return tools;
    return tools.filter(t => availableSkills.includes(t.name));
  }
}



