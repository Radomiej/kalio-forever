import { Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type {
  AgentBudgetApprovalDecision,
  AgentBudgetApprovalInvalidated,
  AgentBudgetApprovalRequest,
  SessionRuntimeKind,
} from '@kalio/types';
import type { StreamContext } from './interfaces/stream-context.interface';

interface PendingBudgetApproval {
  sessionId: string;
  payload: AgentBudgetApprovalRequest;
  emit: StreamContext['emit'];
  resolve: (limit: number | null) => void;
  synthetic?: boolean;
}

@Injectable()
export class AgentBudgetApprovalService {
  private readonly logger = new Logger(AgentBudgetApprovalService.name);
  private readonly pending = new Map<string, PendingBudgetApproval>();

  async requestAdditionalBudget(
    ctx: StreamContext,
    input: {
      currentLimit: number;
      usedIterations: number;
      personaId?: string;
      runtimeKind: Extract<SessionRuntimeKind, 'chat' | 'subagent' | 'agent-flow-branch'>;
      nodeId?: string;
      roleSlotId?: string;
      requestedBy?: string;
    },
  ): Promise<number | null> {
    const requestId = nanoid();
    const payload: AgentBudgetApprovalRequest = {
      requestId,
      sessionId: ctx.sessionId,
      scope: input.runtimeKind,
      usedIterations: input.usedIterations,
      currentLimit: input.currentLimit,
      suggestedNextLimit: Math.min(1000, input.currentLimit + 10),
      personaId: input.personaId,
      nodeId: input.nodeId,
      roleSlotId: input.roleSlotId,
      requestedBy: input.requestedBy,
      agentRun: ctx.agentRun,
    };

    ctx.emit('agent:budget_required', payload);

    return new Promise<number | null>((resolve) => {
      const handleAbort = () => {
        const pending = this.pending.get(requestId);
        if (!pending) {
          return;
        }
        this.pending.delete(requestId);
        this.emitInvalidated(pending, { reason: 'aborted' });
        resolve(null);
      };

      this.pending.set(requestId, {
        sessionId: ctx.sessionId,
        payload,
        emit: ctx.emit,
        resolve: (limit) => {
          ctx.abortSignal?.removeEventListener('abort', handleAbort);
          resolve(limit);
        },
        synthetic: false,
      });

      if (ctx.abortSignal?.aborted) {
        handleAbort();
        return;
      }
      ctx.abortSignal?.addEventListener('abort', handleAbort, { once: true });
    });
  }

  resolveApproval(requestId: string, sessionId: string, decision: AgentBudgetApprovalDecision): 'resolved' | 'not_found' | 'session_mismatch' {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return 'not_found';
    }
    if (pending.sessionId !== sessionId) {
      this.logger.warn(`Ignoring budget approval ${requestId}: session mismatch (${sessionId} !== ${pending.sessionId})`);
      return 'session_mismatch';
    }

    this.pending.delete(requestId);
    const approvedLimit = nextApprovedLimit(pending.payload.currentLimit, decision);
    this.emitInvalidated(pending, {
      reason: decision === 'block' ? 'cancelled' : 'approved',
      decision,
      approvedLimit: approvedLimit ?? undefined,
    });
    pending.resolve(approvedLimit);
    return 'resolved';
  }

  getPendingApprovals(sessionId: string): AgentBudgetApprovalRequest[] {
    return [...this.pending.values()]
      .filter((pending) => pending.sessionId === sessionId)
      .map((pending) => pending.payload);
  }

  isSyntheticPendingApproval(requestId: string, sessionId?: string): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return false;
    }
    if (sessionId && pending.sessionId !== sessionId) {
      return false;
    }
    return pending.synthetic === true;
  }

  seedPendingApproval(payload: AgentBudgetApprovalRequest): void {
    this.pending.set(payload.requestId, {
      sessionId: payload.sessionId,
      payload,
      emit: () => undefined,
      resolve: () => undefined,
      synthetic: true,
    });
  }

  dropPendingApproval(requestId: string, sessionId?: string): 'removed' | 'not_found' | 'session_mismatch' {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return 'not_found';
    }
    if (sessionId && pending.sessionId !== sessionId) {
      return 'session_mismatch';
    }

    this.pending.delete(requestId);
    return 'removed';
  }

  private emitInvalidated(
    pending: PendingBudgetApproval,
    patch: Omit<AgentBudgetApprovalInvalidated, 'requestId' | 'sessionId' | 'agentRun'>,
  ): void {
    pending.emit('agent:budget_invalidated', {
      requestId: pending.payload.requestId,
      sessionId: pending.payload.sessionId,
      agentRun: pending.payload.agentRun,
      ...patch,
    });
  }
}

function nextApprovedLimit(currentLimit: number, decision: AgentBudgetApprovalDecision): number | null {
  switch (decision) {
    case 'allow_one':
      return currentLimit + 1;
    case 'allow_ten':
      return currentLimit + 10;
    case 'allow_unlimited':
      return 1000;
    case 'block':
    default:
      return null;
  }
}
