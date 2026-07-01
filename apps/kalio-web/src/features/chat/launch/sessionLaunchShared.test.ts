import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChatMessage, ChatSession } from '@kalio/types';
import type { AgentTurn } from '../../../store/sessionStore';
import type { ArchitectRunResult, ArchitectSchema } from '../../architect/architect.types';
import { launchWorkflowPrompt } from './sessionLaunchShared';

const getSessionVfsFilesMock = vi.hoisted(() => vi.fn());
const apiPatchMock = vi.hoisted(() => vi.fn());
const startArchitectureRunMock = vi.hoisted(() => vi.fn());
const startGoalGuardAgentFlowRunMock = vi.hoisted(() => vi.fn());

vi.mock('../../../services/apiClient', () => ({
  apiClient: {
    patch: apiPatchMock,
  },
  getSessionVfsFiles: getSessionVfsFilesMock,
}));

vi.mock('../../architect/architect.api', () => ({
  startArchitectureRun: startArchitectureRunMock,
  startGoalGuardAgentFlowRun: startGoalGuardAgentFlowRunMock,
}));

function makeSchema(): ArchitectSchema {
  return {
    id: 'strategic-decision-council',
    name: 'Strategic Decision Council',
    version: '0.1.0',
    description: '',
    nodes: [],
    edges: [],
    roleSlots: [],
    routerPolicy: {
      mode: 'rank_then_merge',
      mustAddressCriticFindings: false,
      canReturnNeedsMoreResearch: false,
    },
    contextPolicy: {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: false,
      includePriorDecisions: false,
    },
    memoryPolicy: {
      persistFinalArtifact: false,
      persistRouterDecision: false,
    },
    outputArtifactSchema: '',
  };
}

function makeRunResult(): ArchitectRunResult {
  return {
    run: {
      id: 'run-1',
      schemaId: 'strategic-decision-council',
      prompt: 'Assess project.',
      executionMode: 'subagent_execution',
      status: 'completed',
      context: {},
      createdAt: 1,
      updatedAt: 2,
      completedAt: 2,
    },
    events: [],
    graph: {
      runId: 'run-1',
      status: 'completed',
      nodes: [],
      edges: [],
      routeHops: [],
      childAgents: [],
    },
    chat: {
      runId: 'run-1',
      messages: [],
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('launchWorkflowPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiPatchMock.mockResolvedValue({ data: {} });
    getSessionVfsFilesMock.mockResolvedValue({ files: [] });
    startArchitectureRunMock.mockResolvedValue(makeRunResult());
    startGoalGuardAgentFlowRunMock.mockResolvedValue(makeRunResult());
  });

  it('does not let host session runtime-context persistence block workflow start', async () => {
    apiPatchMock.mockReturnValue(new Promise(() => undefined));

    const session: ChatSession = {
      id: 'session-1',
      title: 'New Chat',
      personaId: 'default',
      createdAt: 1,
      updatedAt: 1,
    };
    const messages: ChatMessage[] = [];
    const turns: AgentTurn[] = [];

    void launchWorkflowPrompt({
      session,
      content: 'Assess project.',
      schemaId: 'strategic-decision-council',
      architectures: [makeSchema()],
      projectPath: 'C:\\Projekty\\kalio-forever',
      activeToolNames: [],
      clearToolActivities: vi.fn(),
      setStreaming: vi.fn(),
      setAwaitingFirstChunk: vi.fn(),
      addMessage: (message) => {
        messages.push(message);
      },
      setMessages: (nextMessages) => {
        messages.splice(0, messages.length, ...nextMessages);
      },
      setAgentTurns: (nextTurns) => {
        turns.splice(0, turns.length, ...nextTurns);
      },
      getSessionMessages: () => messages,
      getSessionAgentTurns: () => turns,
      updateSession: vi.fn(),
      setError: vi.fn(),
      setRetryError: vi.fn(),
    });

    await wait(100);

    expect(startArchitectureRunMock).toHaveBeenCalledWith(
      'strategic-decision-council',
      'Assess project.',
      {},
      'subagent_execution',
      undefined,
      expect.objectContaining({
        parentSessionId: 'session-1',
        projectPath: 'C:\\Projekty\\kalio-forever',
      }),
      expect.any(Function),
    );
  });

  it('does not let optional VFS source-file discovery block workflow start', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    getSessionVfsFilesMock.mockReturnValue(new Promise(() => undefined));

    const session: ChatSession = {
      id: 'session-1',
      title: 'New Chat',
      personaId: 'default',
      createdAt: 1,
      updatedAt: 1,
    };
    const messages: ChatMessage[] = [];
    const turns: AgentTurn[] = [];

    void launchWorkflowPrompt({
      session,
      content: 'Assess project.',
      schemaId: 'strategic-decision-council',
      architectures: [makeSchema()],
      projectPath: 'C:\\Projekty\\kalio-forever',
      activeToolNames: [],
      clearToolActivities: vi.fn(),
      setStreaming: vi.fn(),
      setAwaitingFirstChunk: vi.fn(),
      addMessage: (message) => {
        messages.push(message);
      },
      setMessages: (nextMessages) => {
        messages.splice(0, messages.length, ...nextMessages);
      },
      setAgentTurns: (nextTurns) => {
        turns.splice(0, turns.length, ...nextTurns);
      },
      getSessionMessages: () => messages,
      getSessionAgentTurns: () => turns,
      updateSession: vi.fn(),
      setError: vi.fn(),
      setRetryError: vi.fn(),
    });

    await wait(1200);

    expect(startArchitectureRunMock).toHaveBeenCalledWith(
      'strategic-decision-council',
      'Assess project.',
      {},
      'subagent_execution',
      undefined,
      expect.objectContaining({
        parentSessionId: 'session-1',
        projectPath: 'C:\\Projekty\\kalio-forever',
      }),
      expect.any(Function),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      '[sessionLaunchShared] workflow VFS context check timed out; launching without attached source files',
    );
    warnSpy.mockRestore();
  });
});
