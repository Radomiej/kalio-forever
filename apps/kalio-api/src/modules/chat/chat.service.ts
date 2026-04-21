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
    { resolve: (decision: 'confirmed' | 'cancelled') => void }
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

    const personaConfig = await this.persona.getSessionConfig(personaId);
    if (!personaConfig) {
      server.emit('chat:error', {
        sessionId,
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'Persona not found',
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
      createdAt: Date.now(),
    });

    // Build history
    const history = await this.buildHistory(sessionId, personaConfig.systemPrompt);
    const assistantMsgId = nanoid();

    // Stream LLM response
    let toolCalls: LLMToolCall[] = [];
    try {
      const tools = this.toolRegistry.getToolsForSkills(personaConfig.availableSkills);
      toolCalls = await this.llm.streamChat(
        history,
        tools,
        (chunk) => client.emit('chat:chunk', chunk),
        sessionId,
        assistantMsgId,
      );
    } catch (err) {
      this.logger.error('[ChatService] LLM error', err);
      server.emit('chat:error', {
        sessionId,
        code: 'LLM_ERROR',
        message: err instanceof Error ? err.message : 'Unknown LLM error',
      } satisfies SocketEvents['chat:error']);
      return;
    }

    client.emit('chat:complete', { sessionId, messageId: assistantMsgId });

    // Process tool calls
    for (const tc of toolCalls) {
      await this.processToolCall(tc, sessionId, conversationId, server, client, personaConfig.availableSkills);
    }
  }

  async resolveConfirmation(requestId: string, decision: 'confirmed' | 'cancelled'): Promise<void> {
    const pending = this.pendingConfirmations.get(requestId);
    if (pending) {
      pending.resolve(decision);
      this.pendingConfirmations.delete(requestId);
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
      const result = { callId: tc.id, status: 'error' as const, errorCode: 'TOOL_NOT_FOUND', errorMessage: `Tool "${tc.name}" not found` };
      client.emit('tool:result', result);
      return;
    }

    if (!availableSkills.includes(tc.name)) {
      const result = { callId: tc.id, status: 'error' as const, errorCode: 'TOOL_NOT_FOUND', errorMessage: `Tool "${tc.name}" not available for this persona` };
      client.emit('tool:result', result);
      return;
    }

    if (toolMeta.requiresConfirmation) {
      const requestId = nanoid();
      const confirmReq: ToolConfirmationRequest = {
        requestId,
        sessionId,
        toolName: tc.name,
        args: tc.args,
        timeoutMs: 30000,
      };
      client.emit('tool:confirmation_required', confirmReq);

      const decision = await this.waitForConfirmation(requestId, 30000);
      if (decision === 'cancelled') {
        client.emit('tool:result', { callId: tc.id, status: 'cancelled' as const });
        return;
      }
    }

    const result = await this.toolDispatch.dispatch({
      sessionId,
      conversationId,
      toolName: tc.name,
      args: tc.args,
      callId: tc.id,
    });
    client.emit('tool:result', result);
  }

  private waitForConfirmation(requestId: string, timeoutMs: number): Promise<'confirmed' | 'cancelled'> {
    return new Promise<'confirmed' | 'cancelled'>((resolve) => {
      this.pendingConfirmations.set(requestId, { resolve });
      setTimeout(() => {
        if (this.pendingConfirmations.has(requestId)) {
          this.pendingConfirmations.delete(requestId);
          resolve('cancelled');
        }
      }, timeoutMs);
    });
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

  async createSession(personaId: string, title?: string): Promise<string> {
    const id = nanoid();
    await this.drizzle.db.insert(sessions).values({
      id,
      personaId,
      title: title ?? '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return id;
  }

  async getSession(sessionId: string) {
    return this.drizzle.db.select().from(sessions).where(eq(sessions.id, sessionId)).then((r) => r[0] ?? null);
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
