import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'socket.io';
import { Socket } from 'socket.io';
import { nanoid } from 'nanoid';
import type { SocketEvents, LLMMessage, LLMToolCall, ToolConfirmationRequest, ChatMessage } from '@kalio/types';
import { LLMService } from '../llm/llm.service';
import { PersonaService } from '../persona/persona.service';
import { ToolRegistryService } from '../tool/tool-registry.service';
import { ToolDispatchService } from '../tool/tool-dispatch.service';
import { DrizzleService } from '../../database/drizzle.service';
import { CredentialsService } from '../credentials/credentials.service';
import { sessions, messages } from '../../database/schema';
import { eq } from 'drizzle-orm';
import { trimToContextWindow } from './context-window';
import { AuditService } from '../audit/audit.service';

type ChatSendPayload = SocketEvents['chat:send'];

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly pendingConfirmations = new Map<
    string,
    { resolve: (decision: 'confirmed' | 'cancelled') => void; timer: ReturnType<typeof setTimeout> }
  >();

  constructor(
    private readonly llm: LLMService,
    private readonly persona: PersonaService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly toolDispatch: ToolDispatchService,
    private readonly drizzle: DrizzleService,
    private readonly credentials: CredentialsService,
    private readonly auditService: AuditService,
  ) {}

  async handleMessage(
    payload: ChatSendPayload,
    server: Server,
    client: Socket,
  ): Promise<void> {
    const { sessionId, content, personaId } = payload;
    this.logger.log(`[chat:send] session=${sessionId} persona=${personaId} content="${content.slice(0, 80)}..."`);

    const personaConfig = await this.persona.getSessionConfig(personaId);
    if (!personaConfig) {
      this.logger.warn(`[chat:send] Persona not found: ${personaId}`);
      server.emit('chat:error', {
        sessionId,
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Persona not found',
      } satisfies SocketEvents['chat:error']);
      return;
    }
    this.logger.log(`[chat:send] Using persona="${personaConfig.systemPrompt.slice(0, 40)}" model=${personaConfig.model}`);

    // Emit context info to client so FE can display system prompt and available tools
    const contextTools = this.toolRegistry.getToolsForSkills(personaConfig.availableSkills);
    client.emit('chat:context', {
      sessionId,
      systemPrompt: personaConfig.systemPrompt,
      toolNames: contextTools.map((t) => t.name),
    } satisfies SocketEvents['chat:context']);

    // Guard: session must exist in DB before we can insert messages (FK constraint)
    const [existingSession] = await this.drizzle.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (!existingSession) {
      this.logger.error(`[chat:send] Session not found in DB: ${sessionId}`);
      client.emit('chat:error', {
        sessionId,
        code: 'LLM_ERROR',
        message: `Session ${sessionId} not found. Create it via POST /api/sessions first.`,
      } satisfies SocketEvents['chat:error']);
      return;
    }

    // Persist user message
    const userMsgId = nanoid();
    await this.drizzle.db.insert(messages).values({
      id: userMsgId,
      sessionId,
      role: 'user',
      content,
      createdAt: new Date(),
    });
    this.logger.log(`[chat:send] User message persisted id=${userMsgId}`);

    const MAX_AGENT_ITERATIONS = 8;
    let agentIteration = 0;
    let pendingToolCalls: LLMToolCall[] = [];
    const turnId = nanoid();

    // Signal agent loop start to frontend — enables unified turn rendering
    client.emit('agent:start', { sessionId, turnId });

    // Agent loop: stream LLM → process tool calls → repeat until no more tool calls
    do {
      agentIteration++;
      const msgId = nanoid();
      let msgContent = '';
      let msgThinking = '';
      let msgChunkCount = 0;
      const msgStart = Date.now();

      const currentHistory = await this.buildHistory(sessionId, personaConfig.systemPrompt);
      const tools = this.toolRegistry.getToolsForSkills(personaConfig.availableSkills);
      this.logger.log(`[chat:send] Agent iteration ${agentIteration}: ${currentHistory.length} msgs, ${tools.length} tools`);

      const auditReqId = await this.auditService.log(
        'llm_request',
        agentIteration === 1 ? `LLM request — session ${sessionId}` : `LLM follow-up #${agentIteration - 1}`,
        { sessionId, data: { model: personaConfig.model, historyLength: currentHistory.length } },
      );

      try {
        pendingToolCalls = await this.llm.streamChat(
          currentHistory,
          tools,
          (chunk) => {
            msgChunkCount++;
            if (!chunk.done) {
              if (chunk.thinking) {
                msgThinking += chunk.delta;
              } else {
                msgContent += chunk.delta;
              }
            }
            client.emit('chat:chunk', chunk);
          },
          sessionId,
          msgId,
        );
        const ms = Date.now() - msgStart;
        this.logger.log(`[chat:send] LLM done iter=${agentIteration}: ${msgChunkCount} chunks, ${pendingToolCalls.length} tool calls`);
        await this.auditService.log('llm_response', `LLM response — ${pendingToolCalls.length} tool call(s)`, {
          sessionId,
          durationMs: ms,
          data: { model: personaConfig.model, chunks: msgChunkCount, toolCallCount: pendingToolCalls.length, thinkingLength: msgThinking.length, refId: auditReqId },
        });
      } catch (err) {
        this.logger.error('[chat:send] LLM error', err);
        await this.auditService.log('error', `LLM error — ${err instanceof Error ? err.message : 'unknown'}`, {
          sessionId,
          durationMs: Date.now() - msgStart,
          data: { error: err instanceof Error ? err.message : String(err) },
        });
        server.emit('chat:error', {
          sessionId,
          code: 'LLM_ERROR',
          message: err instanceof Error ? err.message : 'Unknown LLM error',
        } satisfies SocketEvents['chat:error']);
        return;
      }

      // Persist assistant message
      await this.drizzle.db.insert(messages).values({
        id: msgId,
        sessionId,
        role: 'assistant',
        content: msgContent,
        thinking: msgThinking || null,
        toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : null,
        createdAt: new Date(),
      });
      this.logger.log(`[chat:send] Assistant message persisted id=${msgId} iter=${agentIteration}`);

      client.emit('chat:complete', { sessionId, messageId: msgId });
      this.logger.log(`[chat:send] chat:complete emitted messageId=${msgId} iter=${agentIteration}`);

      // Process tool calls for this iteration
      for (const tc of pendingToolCalls) {
        this.logger.log(`[tool] iter=${agentIteration} tool="${tc.name}" args=${JSON.stringify(this.redactArgs(tc.args)).slice(0, 200)}`);
        await this.processToolCall(tc, sessionId, server, client, personaConfig.availableSkills);
      }
    } while (pendingToolCalls.length > 0 && agentIteration < MAX_AGENT_ITERATIONS);

    // Signal agent loop completion to frontend
    client.emit('agent:done', { sessionId, turnId });

    if (agentIteration >= MAX_AGENT_ITERATIONS && pendingToolCalls.length > 0) {
      this.logger.warn(`[chat:send] Agent loop hit max iterations (${MAX_AGENT_ITERATIONS}) for session=${sessionId}`);
    }
  }

  async resolveConfirmation(requestId: string, decision: 'confirmed' | 'cancelled'): Promise<void> {
    this.logger.log(`[HITL] resolveConfirmation requestId=${requestId} decision=${decision}`);
    const pending = this.pendingConfirmations.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(decision);
      this.pendingConfirmations.delete(requestId);
    } else {
      this.logger.warn('[HITL] No pending confirmation for requestId', requestId);
    }
  }

  private async processToolCall(
    tc: LLMToolCall,
    sessionId: string,
    server: Server,
    client: Socket,
    availableSkills: string[],
  ): Promise<void> {
    // Notify FE immediately so it can show a spinner for every tool call,
    // even those that fail the skill/registry checks below.
    client.emit('tool:start', { callId: tc.id, toolName: tc.name, args: tc.args });
    const toolStart = Date.now();
    await this.auditService.log('tool_call', `Tool call — ${tc.name}`, {
      sessionId,
      data: { toolName: tc.name, callId: tc.id, args: this.redactArgs(tc.args) },
    });

    const toolMeta = this.toolRegistry.getMeta(tc.name);

    if (!toolMeta) {
      this.logger.warn(`[tool] Tool not found: ${tc.name}`);
      const result = { callId: tc.id, status: 'error' as const, errorCode: 'TOOL_NOT_FOUND', errorMessage: `Tool "${tc.name}" not found` };
      client.emit('tool:result', result);
      return;
    }

    // Mirror getToolsForSkills semantics: empty array or '*' means all tools allowed
    const skillsAllowAll = availableSkills.length === 0 || availableSkills.includes('*');
    if (!skillsAllowAll && !availableSkills.includes(tc.name)) {
      this.logger.warn(`[tool] Tool "${tc.name}" not in availableSkills`);
      const result = { callId: tc.id, status: 'error' as const, errorCode: 'TOOL_NOT_FOUND', errorMessage: `Tool "${tc.name}" not available for this persona` };
      client.emit('tool:result', result);
      return;
    }

    if (toolMeta.requiresConfirmation) {
      const requestId = nanoid();
      this.logger.log(`[HITL] Requesting confirmation for tool="${tc.name}" requestId=${requestId}`);
      const confirmReq: ToolConfirmationRequest = {
        requestId,
        toolCallId: tc.id,
        sessionId,
        toolName: tc.name,
        args: tc.args,
        timeoutMs: 30000,
      };
      client.emit('tool:confirmation_required', confirmReq);

      const decision = await this.waitForConfirmation(requestId, 30000);
      this.logger.log(`[HITL] Decision for tool="${tc.name}": ${decision}`);
      if (decision === 'cancelled') {
        client.emit('tool:result', { callId: tc.id, status: 'cancelled' as const });
        return;
      }
    }

    this.logger.log(`[tool] Dispatching tool="${tc.name}"`);
    const result = await this.toolDispatch.dispatch({
      sessionId,
      toolName: tc.name,
      args: tc.args,
      callId: tc.id,
    });
    this.logger.log(`[tool] Result status="${result.status}"`);
    await this.auditService.log('tool_result', `Tool result — ${tc.name} (${result.status})`, {
      sessionId,
      durationMs: Date.now() - toolStart,
      data: {
        toolName: tc.name,
        callId: tc.id,
        status: result.status,
        errorCode: result.status !== 'success' ? result.errorCode : undefined,
      },
    });

    // Persist tool result to messages table for chat history
    const resultContent = result.status === 'success'
      ? JSON.stringify(result.data)
      : result.errorMessage ?? result.errorCode ?? 'error';
    try {
      await this.drizzle.db.insert(messages).values({
        id: nanoid(),
        sessionId,
        role: 'tool_result',
        content: resultContent,
        toolCallId: tc.id,
        createdAt: new Date(),
      });
    } catch (dbErr) {
      this.logger.error('Failed to persist tool result', dbErr instanceof Error ? dbErr : new Error(String(dbErr)));
    }

    client.emit('tool:result', result);
  }

  private waitForConfirmation(requestId: string, timeoutMs: number): Promise<'confirmed' | 'cancelled'> {
    return new Promise<'confirmed' | 'cancelled'>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingConfirmations.has(requestId)) {
          this.pendingConfirmations.delete(requestId);
          resolve('cancelled');
        }
      }, timeoutMs);
      this.pendingConfirmations.set(requestId, { resolve, timer });
    });
  }

  private redactArgs(args: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeys = /api.?key|password|secret|token|auth/i;
    return Object.fromEntries(
      Object.entries(args).map(([k, v]) => [k, sensitiveKeys.test(k) ? '[REDACTED]' : v])
    );
  }

  private async buildHistory(sessionId: string, systemPrompt: string): Promise<LLMMessage[]> {
    const rows = await this.drizzle.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt);

    const history: LLMMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const row of rows) {
      if (row.role === 'tool_result') {
        history.push({ role: 'tool', content: row.content, toolCallId: row.toolCallId ?? undefined });
      } else if (row.role === 'assistant') {
        const msg: LLMMessage = { role: 'assistant', content: row.content };
        if (row.toolCalls && row.toolCalls.length > 0) {
          msg.toolCalls = row.toolCalls;
        }
        history.push(msg);
      } else if (row.role === 'user' || row.role === 'system') {
        history.push({ role: row.role, content: row.content });
      }
    }

    // Apply context window trimming
    const maxTokens = await this.credentials.getContextWindowSize();
    return trimToContextWindow(history, maxTokens);
  }

  async getSessions() {
    return this.drizzle.db.select().from(sessions);
  }

  async createSession(personaId: string, title?: string): Promise<string> {
    const id = nanoid();
    const now = new Date();
    await this.drizzle.db.insert(sessions).values({
      id,
      personaId,
      title: title ?? '',
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  async getSession(sessionId: string) {
    const rows = await this.drizzle.db.select().from(sessions).where(eq(sessions.id, sessionId));
    return rows[0] ?? null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.drizzle.db.delete(messages).where(eq(messages.sessionId, sessionId));
    await this.drizzle.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await this.drizzle.db
      .update(sessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  async generateTitle(sessionId: string): Promise<string> {
    const msgs = await this.getMessages(sessionId);
    const firstUser = msgs.find((m) => m.role === 'user');
    if (!firstUser) return 'New conversation';

    const snippet = firstUser.content.slice(0, 300);
    let title = '';
    try {
      await this.llm.streamChat(
        [
          {
            role: 'user',
            content: `Summarize the following message in 5 words or less as a conversation title. Reply with ONLY the title, no quotes, no punctuation at the end:\n\n${snippet}`,
          },
        ],
        [],
        (chunk) => { if (!chunk.thinking) title += chunk.delta; },
        sessionId,
        'title-gen',
      );
      title = title.trim().replace(/["""]+/g, '').trim() || snippet.slice(0, 40);
    } catch {
      title = snippet.slice(0, 40);
    }

    await this.renameSession(sessionId, title);
    return title;
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const rows = await this.drizzle.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.createdAt);

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as ChatMessage['role'],
      content: row.content,
      thinking: row.thinking ?? undefined,
      toolCalls: row.toolCalls ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    }));
  }
}
