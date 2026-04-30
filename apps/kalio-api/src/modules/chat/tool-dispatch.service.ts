import { Injectable, Inject, Optional, Logger } from '@nestjs/common';

import { nanoid } from 'nanoid';
import type { ToolMeta, ToolCallRequest, ToolResult, ToolConfirmationRequest } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { ToolRegistryEntry } from './interfaces/tool-registry-entry.interface';
import { TOOL_REGISTRY } from './chat.tokens';
import { MCPService } from '../mcp/mcp.service';

const HITL_TIMEOUT_MS = 30_000;

interface PendingConfirmation {
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
              return { callId, status: 'cancelled' };
            }
          }
          try {
            const data = await this.mcpService.callTool(mcpRef.serverId, mcpRef.originalName, args);
            return { callId, status: 'success', data };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`MCP tool [${toolName}] failed: ${message}`, err instanceof Error ? err.stack : undefined);
            return { callId, status: 'error', errorCode: 'TOOL_EXECUTION_FAILED', errorMessage: message };
          }
        }
      }
      return {
        callId,
        status: 'error',
        errorCode: 'TOOL_NOT_FOUND',
        errorMessage: `Unknown tool: ${toolName}`,
      };
    }

    if (entry.meta.requiresConfirmation) {
      const confirmed = await this.awaitConfirmation(callId, toolName, args, ctx);
      if (!confirmed) {
        return { callId, status: 'cancelled' };
      }
    }

    try {
      const req: ToolCallRequest = {
        sessionId: ctx.sessionId,
        toolName,
        args,
        callId,
        availableTools: toolMetas,
      };
      const data = await entry.execute(req);
      return { callId, status: 'success', data };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Tool [${toolName}] failed for session ${ctx.sessionId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return {
        callId,
        status: 'error',
        errorCode: 'TOOL_EXECUTION_FAILED',
        errorMessage: message,
      };
    }
  }

  resolveConfirmation(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.resolve();
  }

  cancelConfirmation(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    pending.reject(new Error('User cancelled tool confirmation'));
  }

  private awaitConfirmation(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
  ): Promise<boolean> {
    const requestId = nanoid();

    const payload: ToolConfirmationRequest = {
      requestId,
      toolCallId: callId,
      sessionId: ctx.sessionId,
      toolName,
      args,
      timeoutMs: HITL_TIMEOUT_MS,
    };

    ctx.emit('tool:confirmation_required', payload);

    return new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        this.logger.warn(
          `HITL confirmation timed out for tool [${toolName}] session=${ctx.sessionId}`,
        );
        resolve(false);
      }, HITL_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: () => {
          clearTimeout(timeout);
          resolve(true);
        },
        reject: () => {
          clearTimeout(timeout);
          resolve(false);
        },
      });
    });
  }
}
