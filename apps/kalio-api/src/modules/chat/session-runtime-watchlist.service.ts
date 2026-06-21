import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AgentFlowRunSnapshot, ChatSession } from '@kalio/types';
import { AGENT_FLOW_RUNTIME, type AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';
import { isActiveAgentFlowSnapshot } from './chat.gateway.agentflow-stop';
import { AgentBudgetApprovalService } from './agent-budget-approval.service';
import { SessionPipelineService } from './session-pipeline.service';
import { SessionsService } from './sessions.service';
import { ToolDispatchService } from './tool-dispatch.service';

export interface RuntimeWatchTarget {
  sessionId: string;
  reasons: string[];
}

@Injectable()
export class SessionRuntimeWatchlistService {
  constructor(
    private readonly sessions: SessionsService,
    private readonly pipeline: SessionPipelineService,
    private readonly toolDispatch: ToolDispatchService,
    private readonly agentBudgetApprovals: AgentBudgetApprovalService,
    @Optional() @Inject(AGENT_FLOW_RUNTIME) private readonly agentFlowRuntime?: AgentFlowRuntimePort | null,
  ) {}

  async list(): Promise<RuntimeWatchTarget[]> {
    const sessions = await this.sessions.list();
    const sessionById = new Map(sessions.map((session) => [session.id, session]));
    const reasonsByRoot = new Map<string, Set<string>>();

    for (const sessionId of this.pipeline.getActiveSessionIds()) {
      this.addReasonForSession(sessionById, reasonsByRoot, sessionId, 'active');
    }

    for (const session of sessions) {
      if (this.toolDispatch.getPendingConfirmations(session.id).length > 0) {
        this.addReasonForSession(sessionById, reasonsByRoot, session.id, 'pending_confirmation');
      }
      if (this.agentBudgetApprovals.getPendingApprovals(session.id).length > 0) {
        this.addReasonForSession(sessionById, reasonsByRoot, session.id, 'pending_budget');
      }
    }

    const agentFlowSnapshots = await this.listAgentFlowSnapshots();
    for (const snapshot of agentFlowSnapshots) {
      if (!isActiveAgentFlowSnapshot(snapshot)) {
        continue;
      }
      const relatedSessionIds = [
        snapshot.run.parentSessionId,
        snapshot.run.childSessionId,
        snapshot.run.openChatSessionId,
      ].filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.trim().length > 0);
      for (const sessionId of relatedSessionIds) {
        this.addReasonForSession(sessionById, reasonsByRoot, sessionId, 'agent_flow_live');
      }
    }

    return [...reasonsByRoot.entries()]
      .map(([sessionId, reasons]) => ({
        sessionId,
        reasons: [...reasons].sort(),
      }))
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  private async listAgentFlowSnapshots(): Promise<AgentFlowRunSnapshot[]> {
    if (!this.agentFlowRuntime?.findAll) {
      return [];
    }
    return this.agentFlowRuntime.findAll();
  }

  private addReasonForSession(
    sessionById: ReadonlyMap<string, ChatSession>,
    reasonsByRoot: Map<string, Set<string>>,
    sessionId: string,
    reason: string,
  ): void {
    const rootSessionId = resolveRootSessionId(sessionById, sessionId);
    if (!rootSessionId) {
      return;
    }
    const reasons = reasonsByRoot.get(rootSessionId) ?? new Set<string>();
    reasons.add(reason);
    reasonsByRoot.set(rootSessionId, reasons);
  }
}

function resolveRootSessionId(
  sessionById: ReadonlyMap<string, ChatSession>,
  sessionId: string,
): string | null {
  let current = sessionById.get(sessionId);
  if (!current) {
    return null;
  }

  const seen = new Set<string>();
  while (current.parentSessionId) {
    if (seen.has(current.id)) {
      break;
    }
    seen.add(current.id);
    const parent = sessionById.get(current.parentSessionId);
    if (!parent) {
      break;
    }
    current = parent;
  }

  return current.id;
}
