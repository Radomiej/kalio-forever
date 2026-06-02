import {
  getArchitectureRunResult,
  getGoalGuardAgentFlowRunResult,
  resumeGoalGuardAgentFlowRunWithQualityGate,
} from './architect.api';
import type { ArchitectProjectionTab, ArchitectRunResult, ExternalQualityGateInput } from './architect.types';

interface ResumeAgentFlowWithQualityGateOptions {
  gate: ExternalQualityGateInput;
  run: ArchitectRunResult;
  taskPrompt: string;
  context: Record<string, unknown>;
  maxSteps: number;
  pollIntervalMs: number;
  setError: (error: string | null) => void;
  setProjectionTab: (tab: ArchitectProjectionTab) => void;
  setRun: (run: ArchitectRunResult) => void;
  setRunning: (running: boolean) => void;
  refreshConversationSessions: (rootSessionId?: string) => Promise<void>;
}

export async function resumeAgentFlowWithQualityGate({
  gate,
  run,
  taskPrompt,
  context,
  maxSteps,
  pollIntervalMs,
  setError,
  setProjectionTab,
  setRun,
  setRunning,
  refreshConversationSessions,
}: ResumeAgentFlowWithQualityGateOptions): Promise<void> {
  if (!run.agentFlowRunId) {
    return;
  }
  setRunning(true);
  setError(null);
  setProjectionTab('events');
  let lastResult: ArchitectRunResult | null = null;
  try {
    let result = await resumeGoalGuardAgentFlowRunWithQualityGate(
      run.agentFlowRunId,
      taskPrompt,
      context,
      gate,
      maxSteps,
    );
    lastResult = result;
    setRun(result);
    await refreshConversationSessionsSafely(refreshConversationSessions, result.run.rootSessionId);
    while (shouldPollAfterResume(result, gate.status)) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      result = result.agentFlowRunId
        ? await getGoalGuardAgentFlowRunResult(result.agentFlowRunId, taskPrompt, context)
        : await getArchitectureRunResult(result.run);
      lastResult = result;
      setRun(result);
      await refreshConversationSessionsSafely(refreshConversationSessions, result.run.rootSessionId);
    }
  } catch (err) {
    const recoverableRunId = lastResult?.agentFlowRunId ?? run.agentFlowRunId;
    if (recoverableRunId) {
      try {
        const recovered = await getGoalGuardAgentFlowRunResult(recoverableRunId, taskPrompt, context);
        setRun(recovered);
        let result = recovered;
        while (shouldPollAfterResume(result, gate.status)) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          result = result.agentFlowRunId
            ? await getGoalGuardAgentFlowRunResult(result.agentFlowRunId, taskPrompt, context)
            : await getArchitectureRunResult(result.run);
          setRun(result);
        }
        setError(null);
        return;
      } catch (recoveryErr) {
        console.warn('Failed to recover AgentFlow run after resume projection error', recoveryErr);
      }
    }
    setError(err instanceof Error ? err.message : 'Failed to resume AgentFlow with QA evidence');
  } finally {
    setRunning(false);
  }
}

function shouldPollAfterResume(result: ArchitectRunResult, gateStatus: ExternalQualityGateInput['status']): boolean {
  const status = result.agentFlowStatus ?? result.run.status;
  return status === 'running'
    || status === 'queued'
    || (gateStatus === 'passed' && status === 'waiting_on_orchestrator');
}

async function refreshConversationSessionsSafely(
  refreshConversationSessions: (rootSessionId?: string) => Promise<void>,
  rootSessionId?: string,
): Promise<void> {
  try {
    await refreshConversationSessions(rootSessionId);
  } catch (err) {
    console.warn('Failed to refresh Architect conversation sessions after AgentFlow resume', err);
  }
}
