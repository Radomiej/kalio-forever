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
import { sessions, messages } from '../../database/schema';
import { eq } from 'drizzle-orm';

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
  ) {}

  async handleMessage(
    payload: ChatSendPayload,
    server: Server,
    client: Socket,
  ): Promise<void> {
    const { sessionId, content, personaId, conversationId } = payload;
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

    // Build history
    const history = await this.buildHistory(sessionId, personaConfig.systemPrompt);
    this.logger.log(`[chat:send] History built: ${history.length} messages`);
    const assistantMsgId = nanoid();

    // Stream LLM response
    let toolCalls: LLMToolCall[] = [];
    let chunkCount = 0;
    let assistantContent = '';
    try {
      const tools = this.toolRegistry.getToolsForSkills(personaConfig.availableSkills);
      this.logger.log(`[chat:send] Streaming LLM with ${tools.length} tools...`);
      toolCalls = await this.llm.streamChat(
        history,
        tools,
        (chunk) => {
          chunkCount++;
          if (!chunk.done) assistantContent += chunk.delta;
          client.emit('chat:chunk', chunk);
        },
        sessionId,
        assistantMsgId,
      );
      this.logger.log(`[chat:send] LLM stream done: ${chunkCount} chunks, ${toolCalls.length} tool calls`);
    } catch (err) {
      this.logger.error('[chat:send] LLM error', err);
      server.emit('chat:error', {
        sessionId,
        code: 'LLM_ERROR',
        message: err instanceof Error ? err.message : 'Unknown LLM error',
      } satisfies SocketEvents['chat:error']);
      return;
    }

    // Persist assistant message to DB
    await this.drizzle.db.insert(messages).values({
      id: assistantMsgId,
      sessionId,
      role: 'assistant',
      content: assistantContent,
      createdAt: new Date(),
    });
    this.logger.log(`[chat:send] Assistant message persisted id=${assistantMsgId}`);

    client.emit('chat:complete', { sessionId, messageId: assistantMsgId });
    this.logger.log(`[chat:send] chat:complete emitted messageId=${assistantMsgId}`);

    // Process tool calls
    for (const tc of toolCalls) {
      this.logger.log(`[tool] Executing tool="${tc.name}" args=${JSON.stringify(this.redactArgs(tc.args)).slice(0, 200)}`);
      await this.processToolCall(tc, sessionId, conversationId, server, client, personaConfig.availableSkills);
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
    conversationId: string,
    server: Server,
    client: Socket,
    availableSkills: string[],
  ): Promise<void> {
    const toolMeta = this.toolRegistry.getMeta(tc.name);

    if (!toolMeta) {
      this.logger.warn(`[tool] Tool not found: ${tc.name}`);
      const result = { callId: tc.id, status: 'error' as const, errorCode: 'TOOL_NOT_FOUND', errorMessage: `Tool "${tc.name}" not found` };
      client.emit('tool:result', result);
      return;
    }

    if (!availableSkills.includes(tc.name)) {
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
      conversationId,
      toolName: tc.name,
      args: tc.args,
      callId: tc.id,
    });
    this.logger.log(`[tool] Result status="${result.status}"`);

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
      } else if (row.role === 'user' || row.role === 'assistant' || row.role === 'system') {
        history.push({ role: row.role, content: row.content });
      }
    }
    return history;
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
      toolCalls: row.toolCalls ?? undefined,
      toolCallId: row.toolCallId ?? undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
    }));
  }
}
