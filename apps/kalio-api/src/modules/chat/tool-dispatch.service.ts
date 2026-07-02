import { Injectable, Inject, Optional, Logger } from '@nestjs/common';

import type { ToolMeta, ToolCallRequest, ToolResult, ToolConfirmationRequest } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { ToolRegistryEntry } from './interfaces/tool-registry-entry.interface';
import { TOOL_REGISTRY } from './chat.tokens';
import { ToolConfirmationService, type ConfirmationResolutionStatus, type PendingMutationStatus } from './tool-confirmation.service';
import { MCPService } from '../mcp/mcp.service';
import { HitlNotificationService } from '../hitl/hitl-notification.service';
import { HitlPolicyService } from '../hitl/hitl-policy.service';
import { RuntimeAuditLogger } from './runtime-audit-logger.service';

/**
 * Resolves tool calls by name, handles HITL (human-in-the-loop) confirmation
 * for tools with requiresConfirmation=true, and executes the tool.
 *
 * Gateway calls resolveConfirmation / cancelConfirmation when the client responds.
 */
@Injectable()
export class ToolDispatchService {
  private readonly logger = new Logger(ToolDispatchService.name);
  private readonly toolMap: ReadonlyMap<string, ToolRegistryEntry>;
  private readonly confirmations: ToolConfirmationService;

  constructor(
    @Inject(TOOL_REGISTRY) tools: ToolRegistryEntry[],
    @Optional() @Inject(MCPService) private readonly mcpService: MCPService | null,
    @Optional() @Inject(HitlPolicyService) hitlPolicy: HitlPolicyService | null,
    @Optional() @Inject(HitlNotificationService) hitlNotifications: HitlNotificationService | null,
    @Optional() @Inject(RuntimeAuditLogger) runtimeAudit: RuntimeAuditLogger | null = null,
    @Optional() @Inject(ToolConfirmationService) confirmations?: ToolConfirmationService | null,
  ) {
    this.confirmations = confirmations ?? new ToolConfirmationService(hitlPolicy, hitlNotifications, runtimeAudit);
    this.toolMap = new Map(tools.map(t => [t.meta.name, t]));
    this.logger.log(`Tool registry loaded: [${[...this.toolMap.keys()].join(', ')}]`);
  }

  getToolMetas(): ToolMeta[] {
    const staticMetas = Array.from(this.toolMap.values()).map(t => t.meta);
    const mcpMetas: ToolMeta[] = this.mcpService
      ? this.mcpService.getAllTools().map(t => ({
          name: t.name,
          description: t.description,
          serverKey: t.serverKey,
          aliases: t.aliases,
          domain: 'mcp' as const,
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
    if (toolMetas && !toolMetas.some((tool) => tool.name === toolName)) {
      return this.withMeta({
        callId,
        status: 'error',
        errorCode: 'TOOL_NOT_AVAILABLE',
        errorMessage: `Tool ${toolName} is not available in this runtime scope.`,
      }, toolName, ctx);
    }

    const entry = this.toolMap.get(toolName);
    if (!entry) {
      // Route MCP tools by their canonical mcp_{serverKey}_{toolName} names.
      if (this.mcpService) {
        const mcpRef = this.mcpService.resolveToolName(toolName);
        if (mcpRef) {
          // Check requiresConfirmation for MCP tools the same way native tools do
          const mcpMeta = this.mcpService.getToolByName(toolName);
          if (mcpMeta?.requiresConfirmation) {
            const approval = await this.confirmations.approveOrRequestConfirmation(callId, toolName, args, ctx);
            if (!approval.approved) {
              return this.cancelledResult(callId, toolName, ctx, approval.rejectionMessage);
            }
          }
          try {
            const data = await this.mcpService.callTool(mcpRef.serverKey, mcpRef.originalName, args);
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

    if (entry.meta.requiresConfirmation) {
      const approval = await this.confirmations.approveOrRequestConfirmation(callId, toolName, args, ctx);
      if (!approval.approved) {
        return this.cancelledResult(callId, toolName, ctx, approval.rejectionMessage);
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
        abortSignal: ctx.abortSignal,
      };
      const data = await entry.execute(req);
      return this.withMeta({ callId, status: 'success', data }, toolName, ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorCode = typeof (err as { code?: unknown })?.code === 'string'
        ? (err as { code: string }).code
        : 'TOOL_EXECUTION_FAILED';
      this.logger.error(
        `Tool [${toolName}] failed for session ${ctx.sessionId}: ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      return this.withMeta({
        callId,
        status: 'error',
        errorCode,
        errorMessage: message,
      }, toolName, ctx);
    }
  }

  resolveConfirmation(requestId: string, sessionId?: string, message?: string): ConfirmationResolutionStatus {
    return this.confirmations.resolveConfirmation(requestId, sessionId, message);
  }

  cancelConfirmation(requestId: string, sessionId?: string, message?: string): ConfirmationResolutionStatus {
    return this.confirmations.cancelConfirmation(requestId, sessionId, message);
  }

  getPendingConfirmations(sessionId: string): ToolConfirmationRequest[] {
    return this.confirmations.getPendingConfirmations(sessionId);
  }

  seedPendingConfirmation(payload: ToolConfirmationRequest): void {
    this.confirmations.seedPendingConfirmation(payload);
  }

  dropPendingConfirmation(requestId: string, sessionId?: string): PendingMutationStatus {
    return this.confirmations.dropPendingConfirmation(requestId, sessionId);
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

  private cancelledResult(callId: string, toolName: string, ctx: StreamContext, rejectionMessage?: string): ToolResult {
    return this.withMeta({
      callId,
      status: 'cancelled',
      ...(rejectionMessage ? { errorMessage: `User rejected tool confirmation: ${rejectionMessage}` } : {}),
    }, toolName, ctx);
  }

}
