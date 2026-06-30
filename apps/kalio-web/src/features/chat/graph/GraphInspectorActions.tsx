import { useState } from 'react';
import { CheckCircle2, ExternalLink, PauseCircle, Send, XCircle } from 'lucide-react';
import type { ToolConfirmationRequest } from '@kalio/types';
import { eventBus } from '../../../services/eventBus';
import { useSessionStore } from '../../../store/sessionStore';
import { useAgentStore } from '../../../store/agentStore';
import { selectRuntimeContinuationActions } from '../../../store/agentRuntimeSelectors';
import type { ExecutionGraphNode } from './executionGraphModel';
import { activateConversationSession } from '../activeConversationSession';
import { AgentFlowResumeAction } from '../../agent-flow/AgentFlowResumeAction';

interface GraphInspectorActionsProps {
  node: ExecutionGraphNode;
  activeSessionId: string;
  selectedConfirmation: ToolConfirmationRequest | null;
  onOpenSessionInConversation?: (sessionId: string) => void;
  setActiveSession: (sessionId: string | null) => void;
  setPendingMessage: (message: string | null) => void;
  removePendingConfirmation: (sessionId: string, requestId: string) => void;
}

const CLI_FOLLOW_UP_MESSAGE = 'Continue from the current task. Share a concise status update and your next concrete step.';

export function GraphInspectorActions({
  node,
  activeSessionId,
  selectedConfirmation,
  onOpenSessionInConversation,
  setActiveSession,
  setPendingMessage,
  removePendingConfirmation,
}: GraphInspectorActionsProps) {
  const [cliActionNotice, setCliActionNotice] = useState<string | null>(null);
  const sessions = useSessionStore((state) => state.sessions);
  const sessionMessages = useSessionStore((state) => state.sessionMessages);
  const runtimeActivitySnapshots = useAgentStore((state) => state.runtimeActivitySnapshots);
  let agentFlowContinuationAction = null;
  if (node.payload.kind === 'agent-flow') {
    const agentFlowPayload = node.payload;
    agentFlowContinuationAction = selectRuntimeContinuationActions({
        runtimeActivitySnapshots,
        sessions,
        sessionMessages,
      }).find((action) => (
        action.flowRunId === agentFlowPayload.graphRunId
        || action.sessionId === agentFlowPayload.childSessionId
      )) ?? null
  }
  const childSessionExists = useSessionStore((state) => (
    node.sessionId != null && state.sessions.some((session) => session.id === node.sessionId)
  ));
  const isArchitectureRunNode = node.payload.kind === 'architecture-run';
  const hasOpenableSession = isArchitectureRunNode || childSessionExists;
  const openConversation = (sessionId: string, reason: 'canvas' | 'confirmation') => {
    void activateConversationSession({
      sessionId,
      sessions,
      setActiveSession: (nextSessionId) => setActiveSession(nextSessionId),
      reason,
    });
  };
  const isChildSessionNode = (
    node.payload.kind === 'subagent'
    || node.payload.kind === 'cli-agent'
    || node.payload.kind === 'agent-flow'
    || isArchitectureRunNode
  )
    && node.sessionId
    && hasOpenableSession
    && node.sessionId !== activeSessionId;
  const isRunningCliChildNode = (
    node.payload.kind === 'cli-agent'
    && isChildSessionNode
    && node.payload.snapshot.status === 'running'
  );
  const isAgentFlowChildNode = node.payload.kind === 'agent-flow' && isChildSessionNode;
  const shouldRender = isChildSessionNode || selectedConfirmation != null;

  if (!shouldRender) {
    return null;
  }

  return (
    <section className="rounded-[22px] border border-base-300 bg-base-200/35 px-5 py-4 space-y-3">
      <h4 className="text-xl font-black tracking-tight">Actions</h4>
      {isChildSessionNode && (
        <button
          type="button"
          className="w-full rounded-xl bg-sky-500/85 hover:bg-sky-500 text-white px-4 py-3 text-sm font-medium transition-colors"
          onClick={() => {
            if (!node.sessionId) return;
            if (onOpenSessionInConversation) {
              onOpenSessionInConversation(node.sessionId);
              return;
            }
            openConversation(node.sessionId, 'canvas');
          }}
        >
          <span className="flex items-center justify-center gap-2">
            <ExternalLink size={14} />
            Open child chat
          </span>
        </button>
      )}
      {isRunningCliChildNode && (
        <>
          <button
            type="button"
            aria-label="Send follow-up"
            className="w-full rounded-xl bg-cyan-500/85 hover:bg-cyan-500 text-white px-4 py-3 text-sm font-medium transition-colors"
            onClick={() => {
              setCliActionNotice(null);
              setPendingMessage(CLI_FOLLOW_UP_MESSAGE);
              if (!node.sessionId) return;
              if (onOpenSessionInConversation) {
                onOpenSessionInConversation(node.sessionId);
                return;
              }
              openConversation(node.sessionId, 'canvas');
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <Send size={14} />
              Send follow-up
            </span>
          </button>
          <button
            type="button"
            aria-label="Stop run"
            className="w-full rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-sm font-medium transition-colors hover:bg-base-200"
            onClick={() => {
              setCliActionNotice(null);
              if (!node.sessionId || eventBus.stopTurn(node.sessionId)) {
                return;
              }
              setCliActionNotice('Stop request could not be delivered. Reconnect and retry.');
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <PauseCircle size={14} />
              Stop run
            </span>
          </button>
          {cliActionNotice && (
            <p className="text-sm text-warning">{cliActionNotice}</p>
          )}
        </>
      )}
      {isAgentFlowChildNode && (
        <>
          <button
            type="button"
            className="w-full rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-sm font-medium transition-colors hover:bg-base-200"
            onClick={() => {
              if (!node.sessionId) return;
              openConversation(node.sessionId, 'canvas');
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <ExternalLink size={14} />
              Open child graph
            </span>
          </button>
          {agentFlowContinuationAction && (
            <AgentFlowResumeAction flowRunId={agentFlowContinuationAction.flowRunId} />
          )}
        </>
      )}
      {selectedConfirmation && (
        <>
          <button
            type="button"
            className="w-full rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-sm font-medium transition-colors hover:bg-base-200"
            onClick={() => {
              if (onOpenSessionInConversation) {
                onOpenSessionInConversation(selectedConfirmation.sessionId);
                return;
              }
              openConversation(selectedConfirmation.sessionId, 'confirmation');
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <ExternalLink size={14} />
              Open conversation
            </span>
          </button>
          <button
            type="button"
            aria-label="Accept tool request"
            className="w-full rounded-xl bg-emerald-500/85 hover:bg-emerald-500 text-white px-4 py-3 text-sm font-medium transition-colors"
            onClick={() => {
              eventBus.confirmTool({ requestId: selectedConfirmation.requestId, sessionId: selectedConfirmation.sessionId });
              removePendingConfirmation(selectedConfirmation.sessionId, selectedConfirmation.requestId);
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <CheckCircle2 size={14} />
              Accept tool request
            </span>
          </button>
          <button
            type="button"
            aria-label="Cancel tool request"
            className="w-full rounded-xl border border-base-300 bg-base-100 px-4 py-3 text-sm font-medium transition-colors hover:bg-base-200"
            onClick={() => {
              eventBus.cancelTool({ requestId: selectedConfirmation.requestId, sessionId: selectedConfirmation.sessionId });
              removePendingConfirmation(selectedConfirmation.sessionId, selectedConfirmation.requestId);
            }}
          >
            <span className="flex items-center justify-center gap-2">
              <XCircle size={14} />
              Cancel tool request
            </span>
          </button>
        </>
      )}
    </section>
  );
}
