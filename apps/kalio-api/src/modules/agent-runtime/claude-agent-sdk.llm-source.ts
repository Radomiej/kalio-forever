import { Injectable, Logger } from '@nestjs/common';
import { createSdkMcpServer, query, tool, type AnyZodRawShape, type SDKMessage, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { ExecutionProfile, ToolMeta, ToolResult } from '@kalio/types';
import type { ILLMSource, LLMSourceParams } from '../chat/interfaces/llm-source.interface';
import type { InternalLLMChunk } from '../chat/interfaces/llm-chunk.types';
import type { ContextManagedLLMMessage } from '../../common/utils/context-managed-llm-message.util';

type ZodSchema = z.ZodType<unknown>;
type ZodShape = Record<string, ZodSchema>;

// Claude's native child/CLI execution tools are intentionally not part of the
// native Claude runtime. They remain a separate integration surface in Kalio.
const BLOCKED_NATIVE_CHILD_TOOL_NAMES = new Set([
  'run_cli_agent',
  'spawn_cli_agent',
  'message_cli_agent',
  'get_cli_agent_status',
  'stop_cli_agent',
  'run_subagent',
  'spawn_subagent',
  'message_subagent',
  'run_sub_agentflow',
]);

const CLAUDE_NATIVE_TOOL_NAMES = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch',
  'NotebookEdit', 'TodoWrite', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode',
] as const;

@Injectable()
export class ClaudeAgentSdkLLMSource implements ILLMSource {
  private readonly logger = new Logger(ClaudeAgentSdkLLMSource.name);

  async *stream(params: LLMSourceParams): AsyncGenerator<InternalLLMChunk> {
    const profile = params.executionProfile;
    if (!profile || profile.kind !== 'claude-agent-sdk') {
      throw new Error('Claude Agent SDK source requires a claude-agent-sdk execution profile.');
    }

    const queue: InternalLLMChunk[] = [];
    const waiters: Array<() => void> = [];
    const controller = new AbortController();
    const bridge = new ToolResultBridge();
    let finished = false;
    let streamError: Error | undefined;
    let partialTextSeen = false;
    let boundSessionId: string | undefined;

    const enqueue = (chunk: InternalLLMChunk): void => {
      queue.push(chunk);
      waiters.shift()?.();
    };
    const finish = (error?: Error): void => {
      if (finished) return;
      streamError = error;
      finished = true;
      waiters.splice(0).forEach((wake) => wake());
    };
    const abortHandler = (): void => {
      controller.abort(params.abortSignal?.reason);
      bridge.failAll('Claude Agent SDK turn was aborted.');
      finish();
    };

    if (params.abortSignal?.aborted) abortHandler();
    else params.abortSignal?.addEventListener('abort', abortHandler, { once: true });

    params.toolResultChannel?.setHandler((callId, result) => bridge.resolve(callId, result));

    const kalioToolMetas = params.tools.filter(isClaudeKalioTool);
    const providerToolNames = normalizeProviderToolNames(params.providerToolNames);
    const sdkTools = kalioToolMetas.map((meta) => buildSdkTool(meta, bridge, enqueue, controller.signal));
    const autoAllowedTools = kalioToolMetas
      .filter((meta) => !meta.requiresConfirmation)
      .map((meta) => `mcp__kalio__${meta.name}`);
    const autoAllowedToolNames = new Set(autoAllowedTools);
    const mcpServer = createSdkMcpServer({
      name: 'kalio',
      version: '1',
      instructions: 'Kalio tools are already scoped to the current session. Never ask the model for session identifiers.',
      tools: sdkTools,
      alwaysLoad: true,
    });

    const consume = async (): Promise<void> => {
      try {
        const stream = query({
          prompt: buildPrompt(params.messages, params.externalThreadId),
          options: {
            abortController: controller,
            cwd: params.cwd,
            model: profile.model || params.model,
            effort: normalizeEffort(profile.reasoningEffort),
            maxTurns: 8,
            settingSources: [],
            strictMcpConfig: true,
            systemPrompt: buildSystemPrompt(params.messages, providerToolNames),
            tools: providerToolNames,
            mcpServers: { kalio: mcpServer },
            env: localClaudeEnvironment(),
            ...(params.externalThreadId ? { resume: params.externalThreadId } : {}),
            canUseTool: async (toolName, input, options) => {
              if (autoAllowedToolNames.has(toolName)) {
                return { behavior: 'allow' as const, toolUseID: options.toolUseID };
              }
              const decision = await params.onNativeApprovalRequested?.({
                method: 'claude.native_approval',
                params: { toolName, input, toolUseId: options.toolUseID, title: options.title },
              });
              return decision === 'accept'
                ? { behavior: 'allow' as const, toolUseID: options.toolUseID }
                : { behavior: 'deny' as const, message: `Kalio rejected Claude tool ${toolName}.`, toolUseID: options.toolUseID };
            },
            includePartialMessages: true,
          },
        });

        for await (const message of stream) {
          if (controller.signal.aborted) break;
          if (message.type === 'system' && message.subtype === 'init') {
            boundSessionId = message.session_id;
            await params.onExternalThreadBound?.(message.session_id, {
              processEpoch: `${message.claude_code_version}:${message.session_id}`,
            });
            await params.onExternalAudit?.({
              eventName: 'claude.session.started',
              status: 'started',
              data: {
                sessionId: message.session_id,
                version: message.claude_code_version,
                model: message.model,
                toolNames: sdkTools.map((sdkTool) => sdkTool.name),
                providerToolNames,
              },
            });
            continue;
          }
          if (message.type === 'stream_event') {
            const delta = message.event;
            if (!isRecord(delta) || delta['type'] !== 'content_block_delta' || !isRecord(delta['delta'])) continue;
            const blockDelta = delta['delta'];
            if (blockDelta['type'] === 'text_delta' && typeof blockDelta['text'] === 'string') {
              partialTextSeen = true;
              enqueue({ type: 'text_delta', delta: blockDelta['text'] });
            } else if (blockDelta['type'] === 'thinking_delta' && typeof blockDelta['thinking'] === 'string') {
              enqueue({ type: 'thinking_delta', delta: blockDelta['thinking'] });
            }
            continue;
          }
          if (message.type === 'assistant' && !partialTextSeen) {
            for (const block of message.message.content) {
              if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
                enqueue({ type: 'text_delta', delta: block['text'] });
              } else if (isRecord(block) && block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
                enqueue({ type: 'thinking_delta', delta: block['thinking'] });
              }
            }
            continue;
          }
          if (message.type === 'result') {
            if (message.subtype === 'success') {
              if (!partialTextSeen && message.result.trim()) enqueue({ type: 'text_delta', delta: message.result });
              enqueue({ type: 'done' });
              finish();
            } else {
              finish(new Error(message.errors.join('; ') || `Claude Agent SDK ended with ${message.subtype}.`));
            }
          }
        }
        if (!finished && !controller.signal.aborted) finish(new Error('Claude Agent SDK ended without a result.'));
      } catch (error) {
        if (!controller.signal.aborted) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          this.logger.warn(`Claude Agent SDK stream failed: ${normalized.message}`);
          finish(normalized);
        }
      }
    };

    void consume();
    try {
      while (!finished || queue.length > 0) {
        while (queue.length > 0) yield queue.shift()!;
        if (finished) break;
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      if (streamError) throw streamError;
    } finally {
      params.abortSignal?.removeEventListener('abort', abortHandler);
      bridge.failAll('Claude Agent SDK turn ended before the tool result was returned.');
      if (boundSessionId) {
        await params.onExternalAudit?.({ eventName: 'claude.session.completed', status: 'completed', data: { sessionId: boundSessionId } });
      }
    }
  }
}

class ToolResultBridge {
  private readonly pending = new Map<string, { resolve: (result: ToolResult) => void }>();

  wait(callId: string, abortSignal: AbortSignal): Promise<ToolResult> {
    if (abortSignal.aborted) return Promise.resolve(abortedToolResult(callId));
    return new Promise((resolve) => {
      this.pending.set(callId, { resolve });
      abortSignal.addEventListener('abort', () => {
        this.resolve(callId, abortedToolResult(callId));
      }, { once: true });
    });
  }

  resolve(callId: string, result: ToolResult): void {
    const pending = this.pending.get(callId);
    if (!pending) return;
    this.pending.delete(callId);
    pending.resolve(result);
  }

  failAll(message: string): void {
    for (const [callId, pending] of this.pending) {
      this.pending.delete(callId);
      pending.resolve({ callId, status: 'error', errorCode: 'CLAUDE_TURN_ENDED', errorMessage: message });
    }
  }
}

function buildSdkTool(
  meta: ToolMeta,
  bridge: ToolResultBridge,
  enqueue: (chunk: InternalLLMChunk) => void,
  abortSignal: AbortSignal,
): SdkMcpToolDefinition<AnyZodRawShape> {
  const inputSchema = toZodShape(meta.parameters);
  const sdkTool = tool(meta.name, meta.description, inputSchema, async (args) => {
    const callId = nanoid();
    const normalizedArgs = isRecord(args) ? args : {};
    enqueue({ type: 'tool_call', callId, name: meta.name, args: normalizedArgs });
    return toMcpResult(await bridge.wait(callId, abortSignal));
  });
  return sdkTool as unknown as SdkMcpToolDefinition<AnyZodRawShape>;
}

function toMcpResult(result: ToolResult): { content: [{ type: 'text'; text: string }]; isError?: boolean } {
  if (result.status === 'success') {
    return { content: [{ type: 'text', text: JSON.stringify(result.data ?? null) }] };
  }
  return {
    content: [{ type: 'text', text: result.errorMessage ?? result.errorCode ?? 'Kalio tool failed.' }],
    isError: true,
  };
}

function abortedToolResult(callId: string): ToolResult {
  return { callId, status: 'cancelled', errorMessage: 'Claude Agent SDK turn was aborted.' };
}

function isClaudeKalioTool(meta: ToolMeta): boolean {
  return !meta.serverKey?.trim()
    && !BLOCKED_NATIVE_CHILD_TOOL_NAMES.has(meta.name);
}

function buildPrompt(messages: ContextManagedLLMMessage[], resumed: string | undefined): string {
  if (resumed) return latestUserMessage(messages) || 'Continue the current task.';
  const transcript = messages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role.toUpperCase()}:\n${contentText(message.content)}`)
    .filter((message) => message.trim().length > 0)
    .join('\n\n');
  return transcript || 'Continue the current task.';
}

function buildSystemPrompt(messages: ContextManagedLLMMessage[], providerToolNames: string[]): string {
  const system = messages.find((message) => message.role === 'system');
  const nativeToolsPolicy = providerToolNames.length === 0
    ? 'Claude built-in tools and external MCP access are disabled; filesystem and shell operations, when available, must go through Kalio tools and policy.'
    : `Claude built-in tools are limited to the explicitly enabled list: ${providerToolNames.join(', ')}. External MCP access remains disabled; Kalio tools and policy still govern the Kalio surface.`;
  return [
    system ? contentText(system.content) : '',
    'You are running as a local Claude Agent SDK runtime hosted by Kalio.',
    nativeToolsPolicy,
  ].filter(Boolean).join('\n\n');
}

function localClaudeEnvironment(): Record<string, string | undefined> {
  return {
    ...process.env,
    ANTHROPIC_API_KEY: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_VERTEX: undefined,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'kalio/claude-agent-sdk',
  };
}

function normalizeEffort(value: string | undefined): 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined {
  const effort = value?.trim().toLowerCase();
  return effort === 'low' || effort === 'medium' || effort === 'high' || effort === 'xhigh' || effort === 'max'
    ? effort
    : undefined;
}

function normalizeProviderToolNames(names: string[] | undefined): string[] {
  const allowed = new Set<string>(CLAUDE_NATIVE_TOOL_NAMES);
  return [...new Set((names ?? [])
    .map((name) => name.trim())
    .filter((name) => allowed.has(name)))];
}

function toZodShape(parameters: unknown): ZodShape {
  if (!isRecord(parameters) || !isRecord(parameters['properties'])) return {};
  const required = new Set(Array.isArray(parameters['required'])
    ? parameters['required'].filter((value): value is string => typeof value === 'string')
    : []);
  const shape: ZodShape = {};
  for (const [name, schema] of Object.entries(parameters['properties'])) {
    const value = toZodSchema(schema);
    shape[name] = required.has(name) ? value : value.optional();
  }
  return shape;
}

function toZodSchema(schema: unknown): ZodSchema {
  if (!isRecord(schema)) return z.unknown();
  if (Array.isArray(schema['enum'])) return z.string();
  switch (schema['type']) {
    case 'string': return z.string();
    case 'number':
    case 'integer': return z.number();
    case 'boolean': return z.boolean();
    case 'array': return z.array(toZodSchema(schema['items']));
    case 'object': return z.object(toZodShape(schema)).passthrough();
    case 'null': return z.null();
    default: return z.unknown();
  }
}

function latestUserMessage(messages: ContextManagedLLMMessage[]): string {
  const user = [...messages].reverse().find((message) => message.role === 'user');
  return user ? contentText(user.content) : '';
}

function contentText(content: ContextManagedLLMMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
