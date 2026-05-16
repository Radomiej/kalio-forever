import { Injectable, Inject, Optional, Logger } from '@nestjs/common';

import { nanoid } from 'nanoid';
import type { ToolMeta, ToolCallRequest, ToolResult, ToolConfirmationInvalidated, ToolConfirmationRequest } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { ToolRegistryEntry } from './interfaces/tool-registry-entry.interface';
import { TOOL_REGISTRY } from './chat.tokens';
import { MCPService } from '../mcp/mcp.service';

const HITL_TIMEOUT_MS = 600_000;
const BUILTIN_SUBAGENT_AUTO_APPROVE_TOOLS = new Set(['vfs_write']);
const OPT_IN_SUBAGENT_AUTO_APPROVE_TOOLS = new Set(['image_generate']);

type SubagentAgentRunContext = NonNullable<StreamContext['agentRun']> & { autoApproveTools?: string[] };
type ConfirmationResolutionStatus = 'resolved' | 'rejected' | 'not_found' | 'session_mismatch';
type PendingMutationStatus = 'removed' | 'not_found' | 'session_mismatch';

interface PendingConfirmation {
  sessionId: string;
  payload: ToolConfirmationRequest;
  emit: StreamContext['emit'];
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Resolves tool calls by name, handles HITL (human-in-the-loop) confirmation
 * for tools with requiresConfirmation=true, and executes the tool.
 *
 * Gateway calls resolveConfirmation / cancelConfirmation when the client responds.
 */
@Injectable()
export class ToolDispatchService {
  private readonly logger = new Logger(ToolDispatchService.name);
  private readonly pending = new Map<string, PendingConfirmation>();
  private readonly toolMap: ReadonlyMap<string, ToolRegistryEntry>;

  constructor(
    @Inject(TOOL_REGISTRY) tools: ToolRegistryEntry[],
    @Optional() @Inject(MCPService) private readonly mcpService: MCPService | null,
  ) {
    this.toolMap = new Map(tools.map(t => [t.meta.name, t]));
    this.logger.log(`Tool registry loaded: [${[...this.toolMap.keys()].join(', ')}]`);
  }

  getToolMetas(): ToolMeta[] {
    const staticMetas = Array.from(this.toolMap.values()).map(t => t.meta);
    const mcpMetas: ToolMeta[] = this.mcpService
      ? this.mcpService.getAllTools().map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          requiresConfirmation: t.requiresConfirmation,
        }))
      : [];
    return [...staticMetas, ...mcpMetas];
  }

  async dispatch(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
    toolMetas?: ToolMeta[],
  ): Promise<ToolResult> {
    const entry = this.toolMap.get(toolName);
    if (!entry) {
      // Route MCP tools: names follow mcp_{serverId}_{toolName} pattern
      if (this.mcpService) {
        const mcpRef = this.mcpService.resolveToolName(toolName);
        if (mcpRef) {
          // Check requiresConfirmation for MCP tools the same way native tools do
          const mcpMeta = this.mcpService.getToolByName(toolName);
          if (mcpMeta?.requiresConfirmation) {
            const confirmed = await this.awaitConfirmation(callId, toolName, args, ctx);
            if (!confirmed) {
              return this.withMeta({ callId, status: 'cancelled' }, toolName, ctx);
            }
          }
          try {
            const data = await this.mcpService.callTool(mcpRef.serverId, mcpRef.originalName, args);
            return this.withMeta({ callId, status: 'success', data }, toolName, ctx);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`MCP tool [${toolName}] failed: ${message}`, err instanceof Error ? err.stack : undefined);
            return this.withMeta({ callId, status: 'error', errorCode: 'TOOL_EXECUTION_FAILED', errorMessage: message }, toolName, ctx);
          }
        }
      }
      return this.withMeta({
        callId,
        status: 'error',
        errorCode: 'TOOL_NOT_FOUND',
        errorMessage: `Unknown tool: ${toolName}`,
      }, toolName, ctx);
    }

    if (entry.meta.requiresConfirmation && !this.canAutoApprove(toolName, ctx)) {
      const confirmed = await this.awaitConfirmation(callId, toolName, args, ctx);
      if (!confirmed) {
        return this.withMeta({ callId, status: 'cancelled' }, toolName, ctx);
      }
    }

    try {
      const req: ToolCallRequest = {
        sessionId: ctx.sessionId,
        vfsSessionId: ctx.vfsSessionId,
        toolName,
        args,
        callId,
        availableTools: toolMetas,
        agentRun: ctx.agentRun,
        // Pass the socket emitter so streaming tools can push progress events
        _emit: ctx.emit as ToolCallRequest['_emit'],
      };
      const data = await entry.execute(req);
      return this.withMeta({ callId, status: 'success', data }, toolName, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Tool [${toolName}] failed for session ${ctx.sessionId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return this.withMeta({
        callId,
        status: 'error',
        errorCode: 'TOOL_EXECUTION_FAILED',
        errorMessage: message,
      }, toolName, ctx);
    }
  }

  resolveConfirmation(requestId: string, sessionId?: string): ConfirmationResolutionStatus {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      this.logger.warn(
        `Ignoring tool confirmation for request ${requestId}: session mismatch (${sessionId} !== ${pending.sessionId})`,
      );
      return 'session_mismatch';
    }
    this.pending.delete(requestId);
    this.emitConfirmationInvalidated(pending, 'confirmed');
    pending.resolve();
    return 'resolved';
  }

  cancelConfirmation(requestId: string, sessionId?: string): ConfirmationResolutionStatus {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      this.logger.warn(
        `Ignoring tool cancellation for request ${requestId}: session mismatch (${sessionId} !== ${pending.sessionId})`,
      );
      return 'session_mismatch';
    }
    this.pending.delete(requestId);
    this.emitConfirmationInvalidated(pending, 'cancelled');
    pending.reject(new Error('User cancelled tool confirmation'));
    return 'rejected';
  }

  getPendingConfirmations(sessionId: string): ToolConfirmationRequest[] {
    return Array.from(this.pending.values())
      .filter((pending) => pending.sessionId === sessionId)
      .map((pending) => pending.payload);
  }

  seedPendingConfirmation(payload: ToolConfirmationRequest): void {
    this.pending.set(payload.requestId, {
      sessionId: payload.sessionId,
      payload,
      emit: () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    });
  }

  dropPendingConfirmation(requestId: string, sessionId?: string): PendingMutationStatus {
    const pending = this.pending.get(requestId);
    if (!pending) return 'not_found';
    if (sessionId && pending.sessionId !== sessionId) {
      return 'session_mismatch';
    }

    this.pending.delete(requestId);
    return 'removed';
  }

  private awaitConfirmation(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
  ): Promise<boolean> {
    const requestId = nanoid();
    const timeoutMs = ctx.agentRun?.agentType === 'subagent' ? 0 : HITL_TIMEOUT_MS;

    const payload: ToolConfirmationRequest = {
      requestId,
      toolCallId: callId,
      sessionId: ctx.sessionId,
      toolName,
      args,
      timeoutMs,
      agentRun: ctx.agentRun,
    };

    ctx.emit('tool:confirmation_required', payload);

    return new Promise<boolean>(resolve => {
      const timeout = timeoutMs > 0
        ? setTimeout(() => {
            const pending = this.pending.get(requestId);
            if (pending) {
              this.pending.delete(requestId);
              this.emitConfirmationInvalidated(
                pending,
                'timeout',
                `Approval timed out for tool ${toolName}.`,
              );
            }
            this.logger.warn(
              `HITL confirmation timed out for tool [${toolName}] session=${ctx.sessionId}`,
            );
            resolve(false);
          }, timeoutMs)
        : null;

      this.pending.set(requestId, {
        sessionId: ctx.sessionId,
        payload,
        emit: ctx.emit,
        resolve: () => {
          if (timeout) clearTimeout(timeout);
          resolve(true);
        },
        reject: () => {
          if (timeout) clearTimeout(timeout);
          resolve(false);
        },
      });
    });
  }

  private canAutoApprove(toolName: string, ctx: StreamContext): boolean {
    const agentRun = ctx.agentRun as SubagentAgentRunContext | undefined;
    if (
      agentRun?.agentType !== 'subagent'
      || agentRun.vfsMode !== 'isolated'
      || ctx.vfsSessionId !== ctx.sessionId
    ) {
      return false;
    }

    if (BUILTIN_SUBAGENT_AUTO_APPROVE_TOOLS.has(toolName)) {
      return true;
    }

    return Array.isArray(agentRun.autoApproveTools)
      && agentRun.autoApproveTools.some(
        (candidate) => candidate === toolName && OPT_IN_SUBAGENT_AUTO_APPROVE_TOOLS.has(candidate),
      );
  }

  private withMeta(result: ToolResult, toolName: string, ctx: StreamContext): ToolResult {
    if (!ctx.agentRun) return result;
    return {
      ...result,
      sessionId: ctx.sessionId,
      toolName,
      agentRun: ctx.agentRun,
    };
  }

  private emitConfirmationInvalidated(
    pending: PendingConfirmation,
    reason: ToolConfirmationInvalidated['reason'],
    message?: string,
  ): void {
    pending.emit('tool:confirmation_invalidated', {
      requestId: pending.payload.requestId,
      toolCallId: pending.payload.toolCallId,
      sessionId: pending.payload.sessionId,
      reason,
      ...(message !== undefined ? { message } : {}),
      ...(pending.payload.agentRun !== undefined ? { agentRun: pending.payload.agentRun } : {}),
    });
  }
}
