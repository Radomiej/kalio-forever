import { Injectable, Logger } from '@nestjs/common';
import type { ExecutionProfile } from '@kalio/types';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';
import { buildKalioMcpBridgeHttpConfig } from '../../common/kalio-mcp-bridge-config';
import { DevinAcpHostRegistry, isDevinCliModel, type DevinAcpHost, type DevinAcpSession, type DevinAcpPromptInput, type DevinAcpToolActivity } from './devin-cli-acp.host';
import { classifyDevinNativeTool, isKalioMcpToolCall, type DevinNativeToolsPolicy } from './devin-native-tools';
import { DevinNativeToolsPolicyService } from './devin-native-tools-policy.service';
import { KalioMcpBridgeTokenService } from '../../database/kalio-mcp-bridge-token.service';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';
import { buildDevinStdioMcpBridgeConfig, DEVIN_KALIO_MCP_SERVER_NAME } from './devin-cli-mcp-bridge';

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
      serverName: DEVIN_KALIO_MCP_SERVER_NAME,
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
      host = await this.registry.get(model, bridgeConfig ? params.sessionId : undefined);
      // Devin CLI 3000.x advertises ACP but ignores session/new MCP entries in
      // practice. The host therefore loads the same scoped bridge through its
      // ephemeral project-local `.devin/mcp_config.local.json` and keeps stdio
      // as the portable transport.
      const httpMcpSupported = false;
      const mcpServers = bridgeConfig
        ? [buildDevinStdioMcpBridgeConfig({ ...bridgeContext, url: bridgeConfig.url }, bridgeToken!.trim())]
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
      const toolActivities = new Map<string, DevinAcpToolActivity>();
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
          toolActivities.set(activity.toolCallId, { ...toolActivities.get(activity.toolCallId), ...activity });
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
        onPermission: (request) => this.handlePermission(
          params,
          profile,
          nativeToolsPolicy,
          session!,
          mergePermissionToolCall(request, toolActivities.get(request.toolCall.toolCallId)),
        ),
      };
      await this.audit(params, {
        eventName: 'devin-cli-acp.turn.started',
        status: 'started',
        data: { model, sessionId: session.sessionId, processEpoch: session.processEpoch, messageId: params.messageId },
      });
      void this.runPrompt(host, session, params, nativeToolsPolicy, promptInput, enqueue, finish);

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
    nativeToolsPolicy: DevinNativeToolsPolicy,
    promptInput: DevinAcpPromptInput,
    _enqueue: (chunk: InternalLLMChunk) => void,
    finish: (error?: Error) => void,
  ): Promise<void> {
    try {
      const stopReason = await host.prompt(session.sessionId, buildPrompt(params.messages, Boolean(params.externalThreadId), nativeToolsPolicy, DEVIN_KALIO_MCP_SERVER_NAME), promptInput);
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
    if (isKalioMcpToolCall(request.toolCall, DEVIN_KALIO_MCP_SERVER_NAME)) {
      await this.audit(params, {
        eventName: 'devin-cli-acp.mcp_approval',
        status: 'completed',
        data: {
          sessionId: session.sessionId,
          processEpoch: session.processEpoch,
          decision: 'accept',
          server: DEVIN_KALIO_MCP_SERVER_NAME,
          toolName: request.toolCall.name ?? null,
        },
      });
      return 'accept';
    }
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
      data: {
        sessionId: session.sessionId,
        processEpoch: session.processEpoch,
        decision,
        toolCallId: request.toolCall.toolCallId,
        toolCallName: request.toolCall.name ?? null,
        toolCallTitle: request.toolCall.title ?? null,
        toolCallKind: request.toolCall.kind ?? null,
      },
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

function buildPrompt(messages: ContextManagedLLMMessage[], resumed: boolean, nativeToolsPolicy: DevinNativeToolsPolicy, serverName: string): string {
  const enabledNativeCategories = [
    nativeToolsPolicy.filesystem ? 'filesystem' : null,
    nativeToolsPolicy.web ? 'web' : null,
    nativeToolsPolicy.terminal ? 'terminal' : null,
  ].filter((category): category is string => category !== null);
  const nativePolicy = enabledNativeCategories.length > 0
    ? `Provider-native categories enabled by Kalio Settings: ${enabledNativeCategories.join(', ')}. Use only these enabled categories; disabled native categories remain unavailable.`
    : 'All provider-native filesystem, web, browser, terminal, shell, and exec tools are disabled by Kalio Settings.';
  const bridgePolicy = [
    'KALIO SYSTEM POLICY:',
    `This ACP session has a Kalio MCP server named \`${serverName}\`.`,
    nativePolicy,
    'Devin exposes MCP through the wrappers `mcp_list_tools` and `mcp_call_tool`.',
    `Use \`mcp_call_tool\` with server \`${serverName}\` and the exact tool name returned by its listing; do not call Kalio tools such as \`fs_list\` as direct ACP functions.`,
    'Kalio owns authorization and HITL. Do not ask the user to approve a tool in natural language.',
  ].join('\n');
  if (resumed) return `${bridgePolicy}\n\nUSER:\n${latestUserMessage(messages) || 'Continue the current task.'}`;
  const transcript = messages
    .map((message) => `${message.role.toUpperCase()}:\n${contentText(message.content)}`)
    .filter((message) => message.trim().length > 0)
    .join('\n\n');
  return transcript ? `${bridgePolicy}\n\n${transcript}` : bridgePolicy;
}

function latestUserMessage(messages: ContextManagedLLMMessage[]): string {
  const message = [...messages].reverse().find((candidate) => candidate.role === 'user');
  return message ? contentText(message.content) : '';
}

function contentText(content: ContextManagedLLMMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

type DevinPermissionRequest = Parameters<DevinAcpPromptInput['onPermission']>[0];
type DevinPermissionToolKind = NonNullable<DevinPermissionRequest['toolCall']['kind']>;

function mergePermissionToolCall(request: DevinPermissionRequest, activity: DevinAcpToolActivity | undefined): DevinPermissionRequest {
  if (!activity) return request;
  return {
    ...request,
    toolCall: {
      ...request.toolCall,
      kind: request.toolCall.kind ?? asPermissionToolKind(activity.kind),
      name: request.toolCall.name ?? activity.name ?? inferPermissionToolName(activity.title),
      title: request.toolCall.title ?? activity.title,
    },
  };
}

function inferPermissionToolName(title: string | null | undefined): string | undefined {
  const match = title?.match(/^(?:calling|called)\s+(.+?)\s+from\s+/i);
  return match?.[1]?.trim() || undefined;
}

function asPermissionToolKind(value: string | null | undefined): DevinPermissionToolKind | undefined {
  const allowed: readonly DevinPermissionToolKind[] = ['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other'];
  return value && allowed.includes(value as DevinPermissionToolKind) ? value as DevinPermissionToolKind : undefined;
}
