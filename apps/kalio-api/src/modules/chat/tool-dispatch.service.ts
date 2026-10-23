import { Injectable, Inject, Optional, Logger } from '@nestjs/common';
import { types } from 'node:util';

import type { ToolMeta, ToolCallRequest, ToolResult, ToolConfirmationRequest, HostDispatchApproval, HostResolvedToolDispatch } from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';
import type { ToolRegistryEntry } from './interfaces/tool-registry-entry.interface';
import { TOOL_REGISTRY } from './chat.tokens';
import { ToolConfirmationService, type ConfirmationResolutionStatus, type PendingMutationStatus, type ToolApprovalOutcome } from './tool-confirmation.service';
import { MCPService } from '../mcp/mcp.service';
import { HitlNotificationService } from '../hitl/hitl-notification.service';
import { HitlPolicyService } from '../hitl/hitl-policy.service';
import { RuntimeAuditLogger } from './runtime-audit-logger.service';
import { detachHostReceiptArgs } from './llm-turn-runtime-dispatch';
import { readHostConfirmationRequirement } from './tool-confirmation.persistence';

const SUBAGENT_AUTO_APPROVE_TOOL_NAMES = new Set([
  'vfs_write',
  'image_generate',
  'run_cli_agent',
  'spawn_cli_agent',
  'message_cli_agent',
  'fs_write',
  'terminal_spawn',
]);

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

  dispatch(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
    toolMetas?: ToolMeta[],
  ): Promise<ToolResult> {
    return this.dispatchInternal(callId, toolName, args, ctx, toolMetas, true);
  }

  async dispatchApproved(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
    toolMetas?: ToolMeta[],
  ): Promise<ToolResult> {
    if (Object.hasOwn(ctx, 'hostConfirmationRequirement')) throw new Error('HOST_CONFIRMATION_BYPASS_FORBIDDEN');
    return this.dispatchInternal(callId, toolName, args, ctx, toolMetas, false);
  }

  private async dispatchInternal(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: StreamContext,
    toolMetas: ToolMeta[] | undefined,
    requestConfirmation: boolean,
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
    const observed = Boolean(ctx.onResolvedToolDispatch);
    const execute = entry?.execute;
    const canonicalName = entry?.meta.name;
    const requiresConfirmation = Boolean(entry?.meta.requiresConfirmation);
    const hostRequirement = readHostConfirmationRequirement(ctx, callId, canonicalName ?? toolName);
    if (hostRequirement && (!entry || canonicalName !== toolName || !requestConfirmation
      || !ctx.onResolvedToolDispatch || !ctx.registerToolResultReceiptCommit)) throw new Error('HOST_CONFIRMATION_DURABILITY_REQUIRED');
    if (observed && entry && canonicalName !== toolName) throw new Error('HOST_DISPATCH_REGISTRY_MISMATCH');
    if (observed) args = detachHostReceiptArgs(args);
    let approvalProof: HostDispatchApproval = Object.freeze({ kind: 'non_durable', reason: requestConfirmation ? 'not_required' : 'explicit_bypass' });
    if (!entry) {
      // Route MCP tools by their canonical mcp_{serverKey}_{toolName} names.
      if (this.mcpService) {
        const mcpRef = this.mcpService.resolveToolName(toolName);
        if (mcpRef) {
          const resolvedMcpTarget = observed
            ? Object.freeze({ serverKey: mcpRef.serverKey, originalName: mcpRef.originalName }) : mcpRef;
          // External MCP calls always require a human, regardless of global policy or tool metadata.
          if (requestConfirmation) {
            const approval = await this.confirmations.approveOrRequestConfirmation(callId, toolName, args, ctx, true);
            if (!approval.approved) {
              return this.cancelledResult(callId, toolName, ctx, approval.rejectionMessage);
            }
            approvalProof = this.approvalProof(approval);
            this.registerLiveExecution(ctx, approval);
          }
          if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
          await ctx.markToolRunning?.();
          if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
          if (observed) await this.resolvedDispatch(ctx, callId, toolName, toolName, args,
            { kind: 'external_mcp', serverKey: resolvedMcpTarget.serverKey, originalName: resolvedMcpTarget.originalName }, approvalProof);
          if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
          if (observed) acknowledgeExecutorEntry(ctx);
          try {
            const data = await this.mcpService.callTool(resolvedMcpTarget.serverKey, resolvedMcpTarget.originalName, args);
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

    if (
      requestConfirmation
      && (hostRequirement || (observed ? requiresConfirmation : entry.meta.requiresConfirmation))
      && (hostRequirement || !isAutoApprovedSubagentTool(toolName, ctx))
    ) {
      const approval = await this.confirmations.approveOrRequestConfirmation(callId, toolName, args, ctx, Boolean(hostRequirement));
      if (!approval.approved) {
        return this.cancelledResult(callId, toolName, ctx, approval.rejectionMessage);
      }
      if (hostRequirement && !approval.execution) throw new Error('HOST_CONFIRMATION_DURABLE_CLAIM_REQUIRED');
      approvalProof = this.approvalProof(approval);
      this.registerLiveExecution(ctx, approval);
    }
    else if (requestConfirmation && requiresConfirmation && isAutoApprovedSubagentTool(toolName, ctx)) {
      approvalProof = Object.freeze({ kind: 'non_durable', reason: 'subagent_auto' });
    }

    if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
    await ctx.markToolRunning?.();
    if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
    if (observed) await this.resolvedDispatch(ctx, callId, toolName, canonicalName ?? toolName, args,
      { kind: 'kalio_registry', entryIdentity: entry, executorIdentity: execute!, requiresConfirmation }, approvalProof);
    if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
    const req: ToolCallRequest = {
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        promptMessageId: ctx.promptMessageId,
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
    if (observed) acknowledgeExecutorEntry(ctx);
    try {
      const data = observed ? await execute!.call(entry, req) : await entry.execute(req);
      if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
      return this.withMeta({ callId, status: 'success', data }, toolName, ctx);
    } catch (err) {
      if (ctx.abortSignal.aborted) return this.cancelledResult(callId, toolName, ctx);
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

  async resolveConfirmation(requestId: string, sessionId?: string, message?: string): Promise<ConfirmationResolutionStatus> {
    return this.confirmations.resolveConfirmation(requestId, sessionId, message);
  }
  async resolveConfirmationFromGateway(requestId: string, sessionId: string, socketId: string, message?: string): Promise<ConfirmationResolutionStatus> {
    return this.confirmations.resolveConfirmationFromGateway(requestId, sessionId, socketId, message);
  }

  async cancelConfirmation(requestId: string, sessionId?: string, message?: string): Promise<ConfirmationResolutionStatus> {
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

  private registerLiveExecution(ctx: StreamContext, approval: ToolApprovalOutcome): void {
    const execution = approval.execution;
    if (execution && ctx.onResolvedToolDispatch) {
      if (!ctx.registerToolResultReceiptCommit) throw new Error('HOST_DISPATCH_COMMIT_OWNER_REQUIRED');
      const claimed = Object.freeze({ requestId: execution.requestId, revision: execution.revision });
      ctx.registerToolResultReceiptCommit((result) => this.confirmations.finishLiveExecutionRequired(claimed, { status: result.status }));
      return;
    }
    if (execution) ctx.registerToolResultCommit?.((result) => this.confirmations.finishLiveExecution(execution, { status: result.status }));
  }

  private approvalProof(approval: ToolApprovalOutcome): HostDispatchApproval {
    return Object.freeze(approval.execution
      ? { kind: 'durable_confirmation', requestId: approval.execution.requestId, claimedRevision: approval.execution.revision }
      : { kind: 'non_durable', reason: approval.nonDurableReason ?? 'legacy_confirmation' });
  }

  private async resolvedDispatch(ctx: StreamContext, callId: string, requestedName: string, canonicalName: string,
    args: Record<string, unknown>, target: HostResolvedToolDispatch['target'], approval: HostDispatchApproval): Promise<void> {
    if (!ctx.onResolvedToolDispatch) return;
    const { runId, sessionId, turnId, promptMessageId } = ctx;
    if (!runId || !sessionId || !turnId || !promptMessageId) throw new Error('HOST_DISPATCH_IDENTITY_REQUIRED');
    await ctx.onResolvedToolDispatch(Object.freeze({ identity: Object.freeze({ runId, sessionId, turnId, promptMessageId }),
      callId, requestedName, canonicalName, args, target: Object.freeze(target), approval }));
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

function acknowledgeExecutorEntry(ctx: StreamContext): void {
  const callback = ctx.onToolExecutorEntered;
  if (!callback) return;
  if (types.isAsyncFunction(callback)) throw new Error('HOST_DISPATCH_ENTRY_ASYNC');
  const result: unknown = callback();
  if (result !== undefined) {
    if (types.isPromise(result)) void result.then(() => undefined, () => undefined);
    throw new Error('HOST_DISPATCH_ENTRY_ASYNC');
  }
}

function isAutoApprovedSubagentTool(toolName: string, ctx: StreamContext): boolean {
  const agentRun = ctx.agentRun;
  if (!agentRun || agentRun.agentType !== 'subagent') {
    return false;
  }

  if (!agentRun.autoApproveTools?.includes(toolName)) {
    return false;
  }
  if (!SUBAGENT_AUTO_APPROVE_TOOL_NAMES.has(toolName)) {
    return false;
  }

  const isIsolatedChildVfs = agentRun.vfsMode === 'isolated'
    && (agentRun.vfsSessionId ?? ctx.vfsSessionId) === ctx.sessionId;
  return toolName !== 'image_generate' || isIsolatedChildVfs;
}
