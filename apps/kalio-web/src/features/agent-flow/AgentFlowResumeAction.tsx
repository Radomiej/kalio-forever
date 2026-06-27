import { useState } from 'react';
import { Play } from 'lucide-react';
import type { AgentFlowRunSnapshot } from '@kalio/types';
import { resumeAgentFlowRun } from './agentFlow.api';

export const AGENT_FLOW_RESUME_INPUT = 'Continue.';

export function isResumableAgentFlowStatus(status: string | null | undefined): boolean {
  return status === 'waiting_on_orchestrator' || status === 'waiting';
}

export function AgentFlowResumeAction({
  flowRunId,
  onResumed,
}: {
  flowRunId: string;
  onResumed?: (snapshot: AgentFlowRunSnapshot) => void;
}) {
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResume = () => {
    if (resuming) {
      return;
    }
    setResuming(true);
    setError(null);
    void resumeAgentFlowRun(flowRunId, { input: AGENT_FLOW_RESUME_INPUT })
      .then((snapshot) => {
        onResumed?.(snapshot);
      })
      .catch((err: unknown) => {
        console.error('[AgentFlowResumeAction] failed to resume AgentFlow run', err instanceof Error ? err : new Error(String(err)));
        setError('Resume request failed. Reconnect and retry.');
      })
      .finally(() => {
        setResuming(false);
      });
  };

  return (
    <div className="rounded border border-warning/25 bg-warning/10 px-2 py-1.5 text-xs text-warning/90 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span>Waiting on orchestrator</span>
        <button
          type="button"
          className="btn btn-warning btn-xs min-h-0 h-6 px-2"
          data-testid={`resume-agentflow-${flowRunId}`}
          onClick={handleResume}
          disabled={resuming}
        >
          <Play size={11} />
          {resuming ? 'Resuming...' : 'Resume AgentFlow'}
        </button>
      </div>
      {error && <p className="text-[11px] text-error">{error}</p>}
    </div>
  );
}
