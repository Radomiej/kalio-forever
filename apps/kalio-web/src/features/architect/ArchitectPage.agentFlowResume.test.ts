import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunStatus, ArchitectureRunStatus } from '@kalio/types';
import type { ArchitectRunResult, ExternalQualityGateInput } from './architect.types';
import { resumeAgentFlowWithQualityGate } from './ArchitectPage.agentFlowResume';
import {
  getArchitectureRunResult,
  getGoalGuardAgentFlowRunResult,
  resumeGoalGuardAgentFlowRunWithQualityGate,
} from './architect.api';

vi.mock('./architect.api', () => ({
  getArchitectureRunResult: vi.fn(),
  getGoalGuardAgentFlowRunResult: vi.fn(),
  resumeGoalGuardAgentFlowRunWithQualityGate: vi.fn(),
}));

const resumeGoalGuardMock = vi.mocked(resumeGoalGuardAgentFlowRunWithQualityGate);
const getGoalGuardMock = vi.mocked(getGoalGuardAgentFlowRunResult);
const getArchitectureRunResultMock = vi.mocked(getArchitectureRunResult);

function result(
  status: ArchitectureRunStatus,
  agentFlowStatus?: AgentFlowRunStatus,
): ArchitectRunResult {
  return {
    run: {
      id: `run-${status}`,
      schemaId: 'goal_guard_delivery_loop',
      prompt: 'Build and verify.',
      executionMode: 'subagent_execution',
      rootSessionId: `root-${status}`,
      status,
      createdAt: 1,
      updatedAt: 2,
    },
    agentFlowRunId: 'agent-flow-1',
    agentFlowStatus: agentFlowStatus ?? (status === 'completed' ? 'done' : status),
    events: [],
    graph: { runId: `run-${status}`, nodes: [], edges: [], routeHops: [] },
    chat: { runId: `run-${status}`, messages: [] },
  };
}

function options(overrides: Partial<Parameters<typeof resumeAgentFlowWithQualityGate>[0]> = {}) {
  const gate: ExternalQualityGateInput = {
    source: 'playwright',
    status: 'passed',
    highFindings: 0,
    summary: 'QA passed.',
  };
  return {
    gate,
    run: result('running', 'waiting_on_orchestrator'),
    taskPrompt: 'Build and verify.',
    context: { requireImplementerWriteProof: true },
    maxSteps: 8,
    pollIntervalMs: 1,
    setError: vi.fn(),
    setProjectionTab: vi.fn(),
    setRun: vi.fn(),
    setRunning: vi.fn(),
    refreshConversationSessions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('resumeAgentFlowWithQualityGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns without mutating UI state when there is no AgentFlow run id', async () => {
    const setRunning = vi.fn();
    const setError = vi.fn();

    await resumeAgentFlowWithQualityGate(options({
      run: {
        ...result('running', 'waiting_on_orchestrator'),
        agentFlowRunId: undefined,
      },
      setRunning,
      setError,
    }));

    expect(resumeGoalGuardMock).not.toHaveBeenCalled();
    expect(setRunning).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalled();
  });

  it('polls after passed QA evidence until the resumed AgentFlow reaches a terminal status', async () => {
    const waiting = result('running', 'waiting_on_orchestrator');
    const done = result('completed', 'done');
    resumeGoalGuardMock.mockResolvedValueOnce(waiting);
    getGoalGuardMock.mockResolvedValueOnce(done);
    const setRun = vi.fn();
    const refreshConversationSessions = vi.fn().mockResolvedValue(undefined);

    const promise = resumeAgentFlowWithQualityGate(options({
      setRun,
      refreshConversationSessions,
    }));
    await vi.runAllTimersAsync();
    await promise;

    expect(resumeGoalGuardMock).toHaveBeenCalledWith(
      'agent-flow-1',
      'Build and verify.',
      { requireImplementerWriteProof: true },
      expect.objectContaining({ status: 'passed' }),
      8,
    );
    expect(getGoalGuardMock).toHaveBeenCalledWith(
      'agent-flow-1',
      'Build and verify.',
      { requireImplementerWriteProof: true },
    );
    expect(getArchitectureRunResultMock).not.toHaveBeenCalled();
    expect(setRun).toHaveBeenNthCalledWith(1, waiting);
    expect(setRun).toHaveBeenNthCalledWith(2, done);
    expect(refreshConversationSessions).toHaveBeenCalledWith('root-running');
    expect(refreshConversationSessions).toHaveBeenCalledWith('root-completed');
  });

  it('polls architecture runs through the architecture result endpoint when AgentFlow metadata is absent', async () => {
    const waiting = result('running', 'waiting_on_orchestrator');
    const architectureReady = result('completed', 'done');
    resumeGoalGuardMock.mockResolvedValueOnce({
      ...waiting,
      agentFlowRunId: undefined,
      agentFlowStatus: 'waiting_on_orchestrator',
    });
    getArchitectureRunResultMock.mockResolvedValueOnce(architectureReady);
    const setRun = vi.fn();
    const refreshConversationSessions = vi.fn().mockResolvedValue(undefined);

    const promise = resumeAgentFlowWithQualityGate(options({
      setRun,
      refreshConversationSessions,
    }));
    await vi.runAllTimersAsync();
    await promise;

    expect(resumeGoalGuardMock).toHaveBeenCalledWith(
      'agent-flow-1',
      'Build and verify.',
      { requireImplementerWriteProof: true },
      expect.objectContaining({ status: 'passed' }),
      8,
    );
    expect(getGoalGuardMock).not.toHaveBeenCalled();
    expect(getArchitectureRunResultMock).toHaveBeenCalledWith(waiting.run);
    expect(setRun).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentFlowRunId: undefined }));
    expect(setRun).toHaveBeenNthCalledWith(2, architectureReady);
    expect(refreshConversationSessions).toHaveBeenCalledWith('root-running');
    expect(refreshConversationSessions).toHaveBeenCalledWith('root-completed');
  });

  it('recovers the latest AgentFlow projection when the first resume projection fails', async () => {
    const recovered = result('completed', 'done');
    resumeGoalGuardMock.mockRejectedValueOnce(new Error('projection failed'));
    getGoalGuardMock.mockResolvedValueOnce(recovered);
    const setError = vi.fn();
    const setRun = vi.fn();

    await resumeAgentFlowWithQualityGate(options({
      setError,
      setRun,
    }));

    expect(getGoalGuardMock).toHaveBeenCalledWith(
      'agent-flow-1',
      'Build and verify.',
      { requireImplementerWriteProof: true },
    );
    expect(setRun).toHaveBeenCalledWith(recovered);
    expect(setError).toHaveBeenCalledWith(null);
    expect(setError).not.toHaveBeenCalledWith('projection failed');
  });

  it('does not poll again when the QA gate failed and the first resume projection is still waiting', async () => {
    const waiting = result('running', 'waiting_on_orchestrator');
    resumeGoalGuardMock.mockResolvedValueOnce(waiting);
    const setRun = vi.fn();
    const refreshConversationSessions = vi.fn().mockResolvedValue(undefined);

    await resumeAgentFlowWithQualityGate(options({
      gate: {
        source: 'playwright',
        status: 'failed',
        highFindings: 3,
        summary: 'QA found blocking issues.',
      },
      setRun,
      refreshConversationSessions,
    }));

    expect(resumeGoalGuardMock).toHaveBeenCalledTimes(1);
    expect(getGoalGuardMock).not.toHaveBeenCalled();
    expect(getArchitectureRunResultMock).not.toHaveBeenCalled();
    expect(setRun).toHaveBeenCalledTimes(1);
    expect(refreshConversationSessions).toHaveBeenCalledTimes(1);
  });

  it('surfaces the original resume error when recovery fails too', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resumeGoalGuardMock.mockRejectedValueOnce(new Error('projection failed'));
    getGoalGuardMock.mockRejectedValueOnce(new Error('recovery failed'));
    const setError = vi.fn();

    await resumeAgentFlowWithQualityGate(options({
      setError,
    }));

    expect(getGoalGuardMock).toHaveBeenCalledWith(
      'agent-flow-1',
      'Build and verify.',
      { requireImplementerWriteProof: true },
    );
    expect(setError).toHaveBeenCalledWith('projection failed');
    expect(setError).not.toHaveBeenCalledWith('recovery failed');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'Failed to recover AgentFlow run after resume projection error',
      expect.any(Error),
    );
    consoleWarnSpy.mockRestore();
  });

  it('continues after a conversation refresh failure while resuming a passed QA gate', async () => {
    const waiting = result('running', 'waiting_on_orchestrator');
    const done = result('completed', 'done');
    resumeGoalGuardMock.mockResolvedValueOnce(waiting);
    getGoalGuardMock.mockResolvedValueOnce(done);
    const refreshConversationSessions = vi.fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(undefined);
    const setError = vi.fn();
    const setRun = vi.fn();

    const promise = resumeAgentFlowWithQualityGate(options({
      gate: {
        source: 'playwright',
        status: 'passed',
        highFindings: 0,
        summary: 'QA passed.',
      },
      setError,
      setRun,
      refreshConversationSessions,
    }));

    await vi.runAllTimersAsync();
    await promise;

    expect(refreshConversationSessions).toHaveBeenCalledWith('root-running');
    expect(refreshConversationSessions).toHaveBeenCalledWith('root-completed');
    expect(setRun).toHaveBeenNthCalledWith(1, waiting);
    expect(setRun).toHaveBeenNthCalledWith(2, done);
    expect(setError).toHaveBeenCalledWith(null);
    expect(setError).not.toHaveBeenCalledWith(expect.stringContaining('refresh failed'));
  });
});
