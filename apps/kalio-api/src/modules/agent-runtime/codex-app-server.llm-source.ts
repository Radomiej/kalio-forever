import { Injectable, Logger } from '@nestjs/common';
import type { ExecutionProfile, ToolMeta, ToolResult } from '@kalio/types';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import {
  CodexAppServerHost,
  type CodexAppServerConnection,
  type CodexAppServerLifecycleEvent,
  type CodexServerNotification,
  type CodexServerRequest,
} from './codex-app-server.host';

interface ThreadResponse { thread?: { id?: unknown } }
interface TurnResponse { turn?: { id?: unknown; status?: unknown; error?: unknown } }
interface DynamicToolCallParams { threadId?: unknown; turnId?: unknown; callId?: unknown; namespace?: unknown; tool?: unknown; arguments?: unknown }

@Injectable()
export class CodexAppServerLLMSource implements ILLMSource {
  private readonly logger = new Logger(CodexAppServerLLMSource.name);

  constructor(private readonly host: CodexAppServerHost) {}

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    const profile = params.executionProfile;
    if (!profile || profile.kind !== 'codex-app-server') {
      throw new Error('Codex App Server source requires a codex-app-server execution profile.');
    }
    const authProfileId = profile.authProfileId?.trim() || profile.id;
    const permission = profile.approvalMode === 'kalio_strict' ? 'read-only' : 'workspace-write';
    const connection = await this.host.getConnection(authProfileId, permission);
    const threadId = await this.ensureThread(connection, authProfileId, profile, params);
    const queue: InternalLLMChunk[] = [];
    const waiters: Array<() => void> = [];
    const toolResults = new Map<string, { resolve: (result: ToolResult) => void }>();
    let turnId: string | undefined;
    let finished = false;
    let streamError: Error | undefined;

    const enqueue = (chunk: InternalLLMChunk): void => {
      queue.push(chunk);
      waiters.shift()?.();
    };
    const finish = (error?: Error): void => {
      streamError = error;
      finished = true;
      waiters.splice(0).forEach((wake) => wake());
    };
    const abortHandler = (): void => {
      finish();
      if (turnId) void connection.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
    };
    params.abortSignal?.addEventListener('abort', abortHandler, { once: true });
    const removeConnectionLost = this.host.onConnectionLost?.((event: CodexAppServerLifecycleEvent) => {
      if (event.authProfileId !== authProfileId || event.processEpoch !== connection.processEpoch) return;
      void params.onExternalAudit?.({
        eventName: 'codex.connection_lost',
        status: 'cancelled',
        data: { authProfileId, processEpoch: connection.processEpoch, reason: event.reason, threadId, turnId },
      });
      try {
        params.onExternalRuntimeLost?.(event);
      } catch (error) {
        this.logger.warn(`Codex runtime-loss callback failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      finish();
    });
    const matchesTurn = (value: unknown): boolean => {
      if (!isRecord(value) || value['threadId'] !== threadId) return false;
      const eventTurnId = readId(value['turnId'])
        ?? (isRecord(value['turn']) ? readId(value['turn']['id']) : undefined);
      return turnId === undefined || eventTurnId === turnId;
    };

    const removeNotification = connection.onNotification((notification) => {
      this.handleNotification(notification, matchesTurn, enqueue, finish);
    });
    const removeRequest = connection.onRequest(async (request) => {
      await this.handleServerRequest({
        connection,
        request,
        threadId,
        turnId,
        authProfileId,
        processEpoch: connection.processEpoch,
        profile,
        enqueue,
        toolResults,
      toolResultChannel: params.toolResultChannel,
        onNativeApprovalRequested: params.onNativeApprovalRequested,
        onExternalAudit: params.onExternalAudit,
      });
    });

    try {
      const response = await connection.request('turn/start', this.buildTurnParams(profile, params, threadId));
      turnId = readId((response as TurnResponse | undefined)?.turn?.id);
      if (!turnId) throw new Error('Codex App Server did not return a turn id.');
      await params.onExternalThreadBound?.(threadId, {
        turnId,
        processEpoch: connection.processEpoch,
      });
      await params.onExternalAudit?.({
        eventName: 'codex.turn.started',
        status: 'started',
        data: {
          authProfileId,
          processEpoch: connection.processEpoch,
          threadId,
          turnId,
          correlationKey: `${connection.processEpoch}:${authProfileId}:${threadId}:${turnId}`,
        },
      });

      while (!finished || queue.length > 0) {
        while (queue.length > 0) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (streamError) throw streamError;
      if (params.toolResultChannel === undefined && toolResults.size > 0) {
        throw new Error('Codex dynamic tools require a Kalio tool-result callback.');
      }
    } finally {
      params.abortSignal?.removeEventListener('abort', abortHandler);
      removeConnectionLost?.();
      removeNotification();
      removeRequest();
      for (const pending of toolResults.values()) pending.resolve({
        callId: 'codex-aborted',
        status: 'error',
        errorCode: 'CODEX_TURN_ABORTED',
        errorMessage: 'Codex turn ended before the tool result was returned.',
      });
      if (params.abortSignal?.aborted && turnId) {
        await connection.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
      }
    }
  }

  private async ensureThread(
    connection: CodexAppServerConnection,
    authProfileId: string,
    profile: ExecutionProfile,
    params: LLMSourceParams,
  ): Promise<string> {
    if (params.externalThreadId) {
      try {
        const response = await connection.request('thread/resume', {
          threadId: params.externalThreadId,
          cwd: params.cwd ?? null,
          approvalPolicy: 'on-request',
          approvalsReviewer: profile.approvalMode === 'codex_guard' ? 'auto_review' : 'user',
          sandbox: profile.approvalMode === 'codex_guard' ? 'workspace-write' : 'read-only',
          model: profile.model || params.model || null,
        });
        const resumedId = readId((response as ThreadResponse | undefined)?.thread?.id);
        if (!resumedId) throw new Error('Codex App Server did not resume the persisted thread.');
        this.host.registerThread?.(authProfileId, resumedId);
        return resumedId;
      } catch (error) {
        this.logger.warn(`Codex thread resume failed; starting a fresh thread: ${error instanceof Error ? error.message : String(error)}`);
        await params.onExternalAudit?.({
          eventName: 'codex.thread.rebound',
          status: 'started',
          data: { authProfileId, previousThreadId: params.externalThreadId, reason: 'resume_failed' },
        });
      }
    }

    return this.startThread(connection, authProfileId, profile, params);
  }

  private async startThread(
    connection: CodexAppServerConnection,
    authProfileId: string,
    profile: ExecutionProfile,
    params: LLMSourceParams,
  ): Promise<string> {
    const response = await connection.request('thread/start', {
      model: profile.model || params.model || null,
      ...(profile.provider ? { modelProvider: profile.provider } : {}),
      cwd: params.cwd ?? null,
      runtimeWorkspaceRoots: params.cwd ? [params.cwd] : null,
      approvalPolicy: 'on-request',
      approvalsReviewer: profile.approvalMode === 'codex_guard' ? 'auto_review' : 'user',
      sandbox: profile.approvalMode === 'codex_guard' ? 'workspace-write' : 'read-only',
      baseInstructions: firstSystemMessage(params.messages),
      dynamicTools: params.tools.map(toDynamicTool),
    });
    const startedId = readId((response as ThreadResponse | undefined)?.thread?.id);
    if (!startedId) throw new Error('Codex App Server did not return a thread id.');
    this.host.registerThread?.(authProfileId, startedId);
    return startedId;
  }

  private buildTurnParams(profile: ExecutionProfile, params: LLMSourceParams, threadId: string): Record<string, unknown> {
    const inputText = latestUserMessage(params.messages) || 'Continue the current task.';
    return {
      threadId,
      clientUserMessageId: params.messageId,
      input: [{ type: 'text', text: inputText, text_elements: [] }],
      ...(params.cwd ? { cwd: params.cwd } : {}),
      model: profile.model || params.model || null,
      effort: normalizeCodexReasoningEffort(profile.model ?? params.model ?? 'gpt-5.4', profile.reasoningEffort),
      approvalPolicy: 'on-request',
      approvalsReviewer: profile.approvalMode === 'codex_guard' ? 'auto_review' : 'user',
      sandboxPolicy: profile.approvalMode === 'codex_guard'
        ? { type: 'workspaceWrite', writableRoots: params.cwd ? [params.cwd] : [] }
        : { type: 'readOnly' },
    };
  }

  private async handleServerRequest(input: {
    connection: CodexAppServerConnection;
    request: CodexServerRequest;
    threadId: string;
    turnId: string | undefined;
    authProfileId: string;
    processEpoch: string;
    profile: ExecutionProfile;
    enqueue: (chunk: InternalLLMChunk) => void;
    toolResults: Map<string, { resolve: (result: ToolResult) => void }>;
    toolResultChannel: LLMSourceParams['toolResultChannel'];
    onNativeApprovalRequested: LLMSourceParams['onNativeApprovalRequested'];
    onExternalAudit: LLMSourceParams['onExternalAudit'];
  }): Promise<void> {
    const {
      connection,
      request,
      threadId,
      turnId,
      authProfileId,
      processEpoch,
      profile,
      enqueue,
      toolResults,
      toolResultChannel,
      onNativeApprovalRequested,
      onExternalAudit,
    } = input;
    toolResultChannel?.setHandler(async (callId, result) => {
      toolResults.get(callId)?.resolve(result);
    });
    if (request.method === 'item/tool/call') {
      const params = request.params as DynamicToolCallParams;
      const callThreadId = readId(params.threadId);
      const callTurnId = readId(params.turnId);
      const callId = readId(params.callId);
      const toolName = readId(params.tool);
      if (!callId || !toolName || callThreadId !== threadId || (turnId && callTurnId !== turnId)) {
        await onExternalAudit?.({
          eventName: 'codex.tool.correlation_mismatch',
          status: 'failed',
          data: {
            authProfileId,
            processEpoch,
            threadId,
            turnId,
            callThreadId,
            callTurnId,
            callId,
          },
        });
        connection.respond(request.id, toDynamicToolResponse({ status: 'error', errorCode: 'CODEX_CORRELATION_MISMATCH', errorMessage: 'Codex tool request correlation failed.' }));
        return;
      }
      await onExternalAudit?.({
        eventName: 'codex.tool.requested',
        status: 'running',
        data: {
          authProfileId,
          processEpoch,
          threadId,
          turnId: callTurnId,
          itemId: callId,
          toolName,
          correlationKey: `${processEpoch}:${authProfileId}:${threadId}:${callTurnId ?? 'unknown'}:${callId}`,
        },
      });
      enqueue({ type: 'tool_call', callId, name: toolName, args: isRecord(params.arguments) ? params.arguments : {} });
      const result = await new Promise<ToolResult>((resolve) => {
        toolResults.set(callId, { resolve });
      });
      toolResults.delete(callId);
      await onExternalAudit?.({
        eventName: 'codex.tool.result',
        status: result.status === 'success' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed',
        data: {
          authProfileId,
          processEpoch,
          threadId,
          turnId: callTurnId,
          itemId: callId,
          toolName,
          resultStatus: result.status,
        },
      });
      connection.respond(request.id, toDynamicToolResponse(result));
      return;
    }

    if (
      request.method === 'item/commandExecution/requestApproval'
      || request.method === 'item/fileChange/requestApproval'
      || request.method === 'item/permissions/requestApproval'
    ) {
      const nativeParams = isRecord(request.params) ? request.params : {};
      const nativeThreadId = readId(nativeParams['threadId']);
      const nativeTurnId = readId(nativeParams['turnId']);
      if ((nativeThreadId && nativeThreadId !== threadId) || (nativeTurnId && turnId && nativeTurnId !== turnId)) {
        await onExternalAudit?.({
          eventName: 'codex.native_approval_correlation_mismatch',
          status: 'failed',
          data: { authProfileId, processEpoch, threadId, turnId, nativeThreadId, nativeTurnId, method: request.method },
        });
        connection.respond(request.id, toNativeApprovalResponse(request.method, 'decline', nativeParams));
        return;
      }
      const decision = profile.approvalMode === 'kalio_strict' && onNativeApprovalRequested
        ? await onNativeApprovalRequested({ method: request.method, params: nativeParams })
        : 'decline';
      await onExternalAudit?.({
        eventName: 'codex.native_approval',
        status: decision === 'accept' ? 'completed' : decision === 'cancel' ? 'cancelled' : 'failed',
        data: {
          authProfileId,
          processEpoch,
          threadId,
          turnId,
          method: request.method,
          decision,
          correlationKey: `${processEpoch}:${authProfileId}:${threadId}:${turnId ?? 'unknown'}:${String(request.id)}`,
        },
      });
      connection.respond(request.id, toNativeApprovalResponse(request.method, decision, nativeParams));
      return;
    }

    connection.respond(request.id, null);
  }

  private handleNotification(
    notification: CodexServerNotification,
    matchesTurn: (value: unknown) => boolean,
    enqueue: (chunk: InternalLLMChunk) => void,
    finish: (error?: Error) => void,
  ): void {
    const params = notification.params;
    if (notification.method === 'item/agentMessage/delta' && matchesTurn(params) && isRecord(params) && typeof params['delta'] === 'string') {
      enqueue({ type: 'text_delta', delta: params['delta'] });
      return;
    }
    if (notification.method === 'item/reasoning/summaryTextDelta' && matchesTurn(params) && isRecord(params) && typeof params['delta'] === 'string') {
      enqueue({ type: 'thinking_delta', delta: params['delta'] });
      return;
    }
    if (notification.method === 'turn/completed' && matchesTurn(params)) {
      const error = isRecord(params) && isRecord(params['turn']) && isRecord(params['turn']['error'])
        ? new Error(readText(params['turn']['error']['message']) ?? 'Codex turn failed.')
        : undefined;
      if (error) finish(error);
      else {
        enqueue({ type: 'done' });
        finish();
      }
      return;
    }
    if (notification.method === 'thread/tokenUsage/updated' && matchesTurn(params)) {
      const usage = readCodexUsage(params);
      if (usage) enqueue(usage);
      return;
    }
    if (notification.method === 'error' && matchesTurn(params)) {
      finish(new Error(isRecord(params) ? readText(params['error']) ?? 'Codex App Server error.' : 'Codex App Server error.'));
    }
  }
}

function toDynamicTool(meta: ToolMeta): Record<string, unknown> {
  return {
    type: 'function',
    name: meta.name,
    description: meta.description,
    inputSchema: meta.parameters,
  };
}

function toDynamicToolResponse(result: Partial<ToolResult>): Record<string, unknown> {
  const text = result.status === 'success'
    ? JSON.stringify(result.data ?? null)
    : result.errorMessage ?? result.errorCode ?? 'Tool execution failed.';
  return {
    contentItems: [{ type: 'inputText', text }],
    success: result.status === 'success',
  };
}

function toNativeApprovalResponse(
  method: string,
  decision: 'accept' | 'decline' | 'cancel',
  params: Record<string, unknown>,
): Record<string, unknown> {
  if (method === 'item/permissions/requestApproval') {
    return {
      permissions: decision === 'accept' && isRecord(params['permissions']) ? params['permissions'] : {},
      scope: 'turn',
    };
  }
  return { decision };
}

function firstSystemMessage(messages: ContextManagedLLMMessage[]): string | null {
  const system = messages.find((message) => message.role === 'system');
  return system ? contentText(system.content) : null;
}

function latestUserMessage(messages: ContextManagedLLMMessage[]): string {
  const user = [...messages].reverse().find((message) => message.role === 'user');
  return user ? contentText(user.content) : '';
}

function contentText(content: ContextManagedLLMMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function readId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value) && typeof value['message'] === 'string') return value['message'];
  return undefined;
}

function readCodexUsage(value: unknown): { type: 'usage'; promptTokens: number; completionTokens: number; totalTokens?: number } | undefined {
  if (!isRecord(value) || !isRecord(value['tokenUsage']) || !isRecord(value['tokenUsage']['last'])) return undefined;
  const last = value['tokenUsage']['last'];
  const promptTokens = readNonNegativeInteger(last['inputTokens']);
  const completionTokens = readNonNegativeInteger(last['outputTokens']);
  const totalTokens = readNonNegativeInteger(last['totalTokens']);
  if (promptTokens === undefined || completionTokens === undefined) return undefined;
  return {
    type: 'usage',
    promptTokens,
    completionTokens,
    ...(totalTokens !== undefined ? { totalTokens } : {}),
  };
}

function readNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeCodexReasoningEffort(model: string, configuredEffort?: string): string {
  const effort = configuredEffort?.trim().toLowerCase();
  const isGpt56 = /^gpt-5\.6(?:-|$)/i.test(model.trim());

  // GPT-5.6 adds `max`; GPT-5.4 and GPT-5.3-Codex stop at `xhigh`.
  // The Codex CLI config is shared with the App Server, so an omitted effort
  // can otherwise inherit an incompatible `max` value from that config.
  if (effort === 'max' && !isGpt56) return 'xhigh';
  if (!effort) return isGpt56 ? 'max' : 'xhigh';
  return effort;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
