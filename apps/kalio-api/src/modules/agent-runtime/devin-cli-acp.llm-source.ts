import { Injectable, Logger } from '@nestjs/common';
import type { ExecutionProfile } from '@kalio/types';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { buildKalioMcpBridgeHttpConfig } from '../../common/kalio-mcp-bridge-config';
import { DevinAcpHostRegistry, isDevinCliModel, type DevinAcpHost, type DevinAcpSession, type DevinAcpPromptInput } from './devin-cli-acp.host';
import { classifyDevinNativeTool, type DevinNativeToolsPolicy } from './devin-native-tools';
import { DevinNativeToolsPolicyService } from './devin-native-tools-policy.service';
import { KalioMcpBridgeTokenService } from '../../database/kalio-mcp-bridge-token.service';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';
import { buildDevinStdioMcpBridgeConfig } from './devin-cli-mcp-bridge';

@Injectable()
export class DevinCliAcpLLMSource implements ILLMSource {
  private readonly logger = new Logger(DevinCliAcpLLMSource.name);

  constructor(
    private readonly registry: DevinAcpHostRegistry,
    private readonly nativeToolsPolicy: DevinNativeToolsPolicyService,
    private readonly mcpBridgeToken: KalioMcpBridgeTokenService,
    private readonly mcpBridgeContext: KalioMcpBridgeContextRegistry,
  ) {}

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    const profile = params.executionProfile;
    if (!profile || profile.kind !== 'devin-cli-acp') {
      throw new Error('Devin ACP source requires a devin-cli-acp execution profile.');
    }
    const model = profile.model.trim() || params.model?.trim() || '';
    if (!isDevinCliModel(model)) throw new Error(`Unsupported Devin CLI model: ${model || '(empty)'}.`);
    const cwd = params.cwd?.trim() || process.env['WORKSPACE_ROOT']?.trim() || process.cwd();
    const nativeToolsPolicy = await this.nativeToolsPolicy.get();
    const bridgeToken = await this.mcpBridgeToken.getToken();
    const bridgeContext = {
      sessionId: params.sessionId,
      vfsSessionId: params.sessionId,
      allowedToolNames: params.tools.map((tool) => tool.name),
      bridgeClient: 'devin-acp' as const,
    };
    const bridgeConfig = buildKalioMcpBridgeHttpConfig(bridgeContext, bridgeToken);
    if ((params.providerToolNames?.length ?? 0) > 0 || params.toolResultChannel) {
      await this.audit(params, {
        eventName: 'devin-cli-acp.tools.omitted',
        status: 'started',
        data: {
          kalioToolCount: params.tools.length,
          providerToolCount: params.providerToolNames?.length ?? 0,
          toolResultChannel: Boolean(params.toolResultChannel),
        },
      });
    }

    let host: DevinAcpHost | undefined;
    let session: DevinAcpSession | undefined;
    try {
      host = await this.registry.get(model);
      const httpMcpSupported = bridgeConfig ? await host.supportsHttpMcp() : false;
      const mcpServers = bridgeConfig
        ? httpMcpSupported
          ? [bridgeConfig]
          : [buildDevinStdioMcpBridgeConfig({ ...bridgeContext, url: bridgeConfig.url }, bridgeToken!.trim())]
        : [];
      await this.audit(params, {
        eventName: 'devin-cli-acp.mcp_bridge',
        status: 'completed',
        data: {
          enabled: Boolean(mcpServers.length),
          requested: Boolean(bridgeConfig),
          httpMcpSupported,
          transport: mcpServers[0] ? ('type' in mcpServers[0] ? mcpServers[0].type : 'stdio') : null,
          toolCount: params.tools.length,
          nativeToolsPolicy,
        },
      });
      session = await host.ensureSession(cwd, params.externalThreadId, mcpServers);
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
        onTurnStart: () => this.mcpBridgeContext.activate({
          sessionId: params.sessionId,
          vfsSessionId: params.sessionId,
          turnId: params.runId,
          promptMessageId: params.messageId,
        }),
        onText: (text) => enqueue({ type: 'text_delta', delta: text }),
        onThought: (text) => enqueue({ type: 'thinking_delta', delta: text }),
        onToolActivity: (activity) => {
          void this.audit(params, {
            eventName: 'devin-cli-acp.tool',
            status: activity.status === 'completed' ? 'completed' : activity.status === 'failed' ? 'failed' : 'running',
            data: {
              sessionId: session!.sessionId,
              processEpoch: session!.processEpoch,
              toolCallId: activity.toolCallId,
              kind: activity.kind,
              name: activity.name,
              title: activity.title,
              toolStatus: activity.status,
            },
          });
        },
        onPermission: (request) => this.handlePermission(params, profile, nativeToolsPolicy, session!, request),
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
    nativeToolsPolicy: DevinNativeToolsPolicy,
    session: DevinAcpSession,
    request: Parameters<DevinAcpPromptInput['onPermission']>[0],
  ): Promise<'accept' | 'decline' | 'cancel'> {
    const category = classifyDevinNativeTool(request.toolCall);
    const categoryEnabled = category ? nativeToolsPolicy[category] : false;
    const decision = categoryEnabled && profile.approvalMode === 'kalio_strict' && params.onNativeApprovalRequested
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
