import { Injectable, Logger } from '@nestjs/common';
import type { ExecutionProfile } from '@kalio/types';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import {
  DevinApiClient,
  DevinApiError,
  type DevinSession,
  type DevinSessionMessage,
} from './devin-api.client';

const TERMINAL_DETAILS = new Set(['waiting_for_user', 'waiting_for_approval', 'finished']);

@Injectable()
export class DevinApiLLMSource implements ILLMSource {
  private readonly logger = new Logger(DevinApiLLMSource.name);
  private readonly seenEvents = new Map<string, Set<string>>();

  constructor(private readonly client: DevinApiClient) {}

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    const profile = params.executionProfile;
    if (!profile || profile.kind !== 'devin-api') {
      throw new Error('Devin API source requires a devin-api execution profile.');
    }
    if (params.tools.length > 0 || (params.providerToolNames?.length ?? 0) > 0) {
      await params.onExternalAudit?.({
        eventName: 'devin.tools.omitted',
        status: 'started',
        data: { toolCount: params.tools.length, providerToolCount: params.providerToolNames?.length ?? 0 },
      });
    }

    const prompt = buildPrompt(params.messages, Boolean(params.externalThreadId));
    const externalThreadId = params.externalThreadId;
    let session: DevinSession;
    try {
      session = externalThreadId
        ? await this.client.sendMessage(externalThreadId, prompt)
        : await this.client.createSession(prompt);
    } catch (error) {
      await this.handleRemoteError(error, params, externalThreadId);
      throw error;
    }

    const remoteSessionId = externalThreadId ?? session.sessionId;
    const processEpoch = `devin:${remoteSessionId}`;
    if (!externalThreadId) {
      await params.onExternalThreadBound?.(remoteSessionId, { processEpoch });
    }
    await params.onExternalAudit?.({
      eventName: externalThreadId ? 'devin.session.message_sent' : 'devin.session.started',
      status: 'started',
      data: { sessionId: remoteSessionId, status: session.status, statusDetail: session.statusDetail },
    });

    const seen = this.seenEvents.get(remoteSessionId) ?? new Set<string>();
    this.seenEvents.set(remoteSessionId, seen);
    const { intervalMs, timeoutMs } = this.client.getPollOptions();
    const startedAt = Date.now();
    let finalSession = session;
    try {
      for (;;) {
        if (params.abortSignal?.aborted) {
          await params.onExternalAudit?.({ eventName: 'devin.session.poll_cancelled', status: 'cancelled', data: { sessionId: remoteSessionId } });
          return;
        }
        try {
          finalSession = await this.client.getSession(remoteSessionId);
          const messages = await this.readAllMessages(remoteSessionId);
          for (const message of messages) {
            if (message.source.toLowerCase() !== 'devin' || seen.has(message.eventId)) continue;
            seen.add(message.eventId);
            if (message.message.trim()) yield { type: 'text_delta', delta: message.message };
          }
        } catch (error) {
          await this.handleRemoteError(error, params, remoteSessionId, processEpoch);
          throw error;
        }

        let terminal: ReturnType<typeof terminalState>;
        try {
          terminal = terminalState(finalSession);
        } catch (error) {
          await this.handleRemoteError(error, params, remoteSessionId, processEpoch);
          throw error;
        }
        if (terminal) {
          await params.onExternalAudit?.({
            eventName: 'devin.session.completed',
            status: terminal === 'waiting_for_approval' || terminal === 'waiting_for_user' ? 'waiting_for_human' : 'completed',
            data: { sessionId: remoteSessionId, status: finalSession.status, statusDetail: finalSession.statusDetail },
          });
          yield { type: 'done' };
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          await params.onExternalAudit?.({
            eventName: 'devin.session.poll_timeout',
            status: 'running',
            data: { sessionId: remoteSessionId, status: finalSession.status, statusDetail: finalSession.statusDetail, timeoutMs },
          });
          yield { type: 'done' };
          return;
        }
        await delay(intervalMs, params.abortSignal);
      }
    } finally {
      if (seen.size > 5000) this.seenEvents.delete(remoteSessionId);
    }
  }

  private async readAllMessages(sessionId: string): Promise<DevinSessionMessage[]> {
    const messages: DevinSessionMessage[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page += 1) {
      const result = await this.client.listMessages(sessionId, cursor);
      messages.push(...result.items);
      if (!result.hasNextPage || !result.endCursor || result.endCursor === cursor) return messages;
      cursor = result.endCursor;
    }
    return messages;
  }

  private async handleRemoteError(
    error: unknown,
    params: LLMSourceParams,
    sessionId?: string,
    processEpoch = sessionId ? `devin:${sessionId}` : 'devin:unbound',
  ): Promise<void> {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.logger.warn(`Devin API source failed: ${normalized.message}`);
    await params.onExternalAudit?.({
      eventName: 'devin.session.error',
      status: 'failed',
      data: { sessionId, status: error instanceof DevinApiError ? error.status : undefined },
    });
    if (error instanceof DevinApiError && error.status === 404 && sessionId) {
      params.onExternalRuntimeLost?.({ authProfileId: params.executionProfile?.authProfileId ?? params.executionProfile?.id ?? 'devin-api', processEpoch, reason: 'error' });
    }
  }
}

function terminalState(session: DevinSession): 'waiting_for_user' | 'waiting_for_approval' | 'finished' | 'exit' | null {
  if (session.status === 'exit') return 'exit';
  if (session.status === 'error') throw new Error('Devin Cloud session failed.');
  if (session.status === 'suspended') throw new Error(`Devin Cloud session suspended${session.statusDetail ? `: ${session.statusDetail}` : '.'}`);
  if (session.status === 'running' && session.statusDetail && TERMINAL_DETAILS.has(session.statusDetail)) return session.statusDetail as 'waiting_for_user' | 'waiting_for_approval' | 'finished';
  return null;
}

function buildPrompt(messages: ContextManagedLLMMessage[], resumed: boolean): string {
  if (resumed) return latestUserMessage(messages) || 'Continue the current task.';
  const transcript = messages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role.toUpperCase()}:\n${contentText(message.content)}`)
    .filter((message) => message.trim().length > 0)
    .join('\n\n');
  return transcript || 'Continue the current task.';
}

function latestUserMessage(messages: ContextManagedLLMMessage[]): string {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'user');
  return message ? contentText(message.content) : '';
}

function contentText(content: ContextManagedLLMMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
