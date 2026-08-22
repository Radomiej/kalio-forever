import { Injectable, Logger } from '@nestjs/common';
import type { DevinCliModel, ExecutionProfile } from '@kalio/types';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { DevinAcpHostRegistry, isDevinCliModel, type DevinAcpHost, type DevinAcpSession, type DevinAcpPromptInput } from './devin-cli-acp.host';

@Injectable()
export class DevinCliAcpLLMSource implements ILLMSource {
  private readonly logger = new Logger(DevinCliAcpLLMSource.name);

  constructor(private readonly registry: DevinAcpHostRegistry) {}

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    const profile = params.executionProfile;
    if (!profile || profile.kind !== 'devin-cli-acp') {
      throw new Error('Devin ACP source requires a devin-cli-acp execution profile.');
    }
    const model = profile.model.trim() || params.model?.trim() || '';
    if (!isDevinCliModel(model)) throw new Error(`Unsupported Devin CLI model: ${model || '(empty)'}.`);
    const cwd = params.cwd?.trim() || process.env['WORKSPACE_ROOT']?.trim() || process.cwd();

    if (params.tools.length > 0 || (params.providerToolNames?.length ?? 0) > 0 || params.toolResultChannel) {
      await this.audit(params, {
        eventName: 'devin-cli-acp.tools.omitted',
        status: 'started',
        data: {
          toolCount: params.tools.length,
          providerToolCount: params.providerToolNames?.length ?? 0,
          toolResultChannel: Boolean(params.toolResultChannel),
        },
      });
    }

    let host: DevinAcpHost | undefined;
    let session: DevinAcpSession | undefined;
    try {
      host = await this.registry.get(model);
      session = await host.ensureSession(cwd, params.externalThreadId);
      if (!params.externalThreadId) {
        await params.onExternalThreadBound?.(session.sessionId, { processEpoch: session.processEpoch });
      }
      await this.audit(params, {
        eventName: session.resumed ? 'devin-cli-acp.session.resumed' : 'devin-cli-acp.session.started',
        status: 'started',
        data: { model, sessionId: session.sessionId, processEpoch: session.processEpoch, cwd: session.cwd },
      });

      const queue: InternalLLMChunk[] = [];
      const waiters: Array<() => void> = [];
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
      const promptInput: DevinAcpPromptInput = {
        signal: params.abortSignal,
        onText: (text) => enqueue({ type: 'text_delta', delta: text }),
        onThought: (text) => enqueue({ type: 'thinking_delta', delta: text }),
        onPermission: (request) => this.handlePermission(params, profile, session!, request),
      };
      await this.audit(params, {
        eventName: 'devin-cli-acp.turn.started',
        status: 'started',
        data: { model, sessionId: session.sessionId, processEpoch: session.processEpoch, messageId: params.messageId },
      });
      void this.runPrompt(host, session, params, promptInput, enqueue, finish);

      while (!finished || queue.length > 0) {
        while (queue.length > 0) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (streamError) throw streamError;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`Devin ACP source failed: ${normalized.message}`);
      await this.audit(params, {
        eventName: 'devin-cli-acp.error',
        status: 'failed',
        data: {
          model,
          sessionId: session?.sessionId,
          processEpoch: session?.processEpoch ?? 'devin-cli:unbound',
          reason: normalized.message.slice(0, 240),
        },
      });
      params.onExternalRuntimeLost?.({
        authProfileId: profile.authProfileId?.trim() || profile.id,
        processEpoch: session?.processEpoch ?? 'devin-cli:unbound',
        reason: params.abortSignal?.aborted ? 'closed' : 'error',
      });
      throw normalized;
    }
  }

  private async runPrompt(
    host: DevinAcpHost,
    session: DevinAcpSession,
    params: LLMSourceParams,
    promptInput: DevinAcpPromptInput,
    _enqueue: (chunk: InternalLLMChunk) => void,
    finish: (error?: Error) => void,
  ): Promise<void> {
    try {
      const stopReason = await host.prompt(session.sessionId, buildPrompt(params.messages, Boolean(params.externalThreadId)), promptInput);
      await this.audit(params, {
        eventName: 'devin-cli-acp.turn.completed',
        status: stopReason === 'cancelled' ? 'cancelled' : 'completed',
        data: { sessionId: session.sessionId, processEpoch: session.processEpoch, stopReason },
      });
      if (stopReason !== 'cancelled') _enqueue({ type: 'done' });
      finish();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      await this.audit(params, {
        eventName: 'devin-cli-acp.turn.error',
        status: 'failed',
        data: { sessionId: session.sessionId, processEpoch: session.processEpoch, reason: normalized.message.slice(0, 240) },
      });
      finish(normalized);
    }
  }

  private async handlePermission(
    params: LLMSourceParams,
    profile: ExecutionProfile,
    session: DevinAcpSession,
    request: Parameters<DevinAcpPromptInput['onPermission']>[0],
  ): Promise<'accept' | 'decline' | 'cancel'> {
    const decision = profile.approvalMode === 'kalio_strict' && params.onNativeApprovalRequested
      ? await params.onNativeApprovalRequested({
        method: 'devin.session.request_permission',
        params: {
          sessionId: request.sessionId,
          toolCall: {
            toolCallId: request.toolCall.toolCallId,
            kind: request.toolCall.kind ?? null,
            title: request.toolCall.title ?? null,
            name: request.toolCall.name ?? null,
          },
          options: request.options.map((option) => ({ optionId: option.optionId, kind: option.kind, name: option.name })),
        },
      })
      : 'decline';
    await this.audit(params, {
      eventName: 'devin-cli-acp.native_approval',
      status: decision === 'accept' ? 'completed' : decision === 'cancel' ? 'cancelled' : 'failed',
      data: { sessionId: session.sessionId, processEpoch: session.processEpoch, decision },
    });
    return decision;
  }

  private async audit(params: LLMSourceParams, event: NonNullable<Parameters<NonNullable<LLMSourceParams['onExternalAudit']>>>[0]): Promise<void> {
    try {
      await params.onExternalAudit?.(event);
    } catch (error) {
      this.logger.warn(`Devin ACP audit callback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function buildPrompt(messages: ContextManagedLLMMessage[], resumed: boolean): string {
  if (resumed) return latestUserMessage(messages) || 'Continue the current task.';
  const transcript = messages
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
