import { describe, expect, it, vi } from 'vitest';
import type { AgentFlowRunSnapshot, ChatSession } from '@kalio/types';
import type { AgentFlowRuntimePort } from '../agent-flow/agent-flow-runtime.port';
import type { ArchitectureRuntimeStopPort } from './architecture-runtime-stop.port';
import type { CLIAgentSessionRuntimePort } from '../cli-agent/cli-agent-session-runtime.port';
import type { SubagentRuntimePort } from '../tool/subagent-runtime.port';
import { SessionRuntimeStopService } from './session-runtime-stop.service';

const rootSession: ChatSession = {
  id: 'root-session',
  personaId: 'default',
  title: 'Root',
  createdAt: 1,
  updatedAt: 1,
};

const branchSession: ChatSession = {
  id: 'branch-session',
  parentSessionId: 'root-session',
  personaId: 'agent',
  title: 'Branch',
  kind: 'subagent',
  createdAt: 2,
  updatedAt: 2,
};

const cliSession: ChatSession = {
  id: 'cli-session',
  parentSessionId: 'branch-session',
  personaId: 'agent',
  title: 'CLI',
  kind: 'cli-agent',
  createdAt: 3,
  updatedAt: 3,
};

function makeAgentFlowSnapshot(id: string, status: 'running' | 'completed'): AgentFlowRunSnapshot {
  return {
    run: {
      id,
      parentSessionId: 'root-session',
      childSessionId: 'branch-session',
      status,
      phase: status === 'running' ? 'executing' : 'completed',
      createdAt: 1,
      updatedAt: 2,
    },
    trace: [],
  } as unknown as AgentFlowRunSnapshot;
}

describe('SessionRuntimeStopService', () => {
  it('stops architecture, agent flow, CLI, and chat pipeline for the full session tree', async () => {
    const sessions = {
      listChildren: vi.fn(async (sessionId: string): Promise<ChatSession[]> => {
        if (sessionId === 'root-session') {
          return [branchSession];
        }
        if (sessionId === 'branch-session') {
          return [cliSession];
        }
        return [];
      }),
      get: vi.fn(async (sessionId: string): Promise<ChatSession> => {
        if (sessionId === 'root-session') return rootSession;
        if (sessionId === 'branch-session') return branchSession;
        if (sessionId === 'cli-session') return cliSession;
        throw new Error(`Unexpected session ${sessionId}`);
      }),
    };
    const pipeline = {
      stopAndDrain: vi.fn(async () => undefined),
    };
    const architectureRuntime: ArchitectureRuntimeStopPort = {
      stopRunsForSessions: vi.fn(async () => ['architecture-run-1']),
    };
    const stopAndDrainSubagents = vi.fn(async () => undefined);
    const subagentRuntime: Pick<Required<SubagentRuntimePort>, 'stopAndDrainSessions'> = {
      stopAndDrainSessions: stopAndDrainSubagents,
    };
    const agentFlowRuntime: Pick<AgentFlowRuntimePort, 'findByParentSessionId' | 'stop'> = {
      findByParentSessionId: vi.fn(async () => [
        makeAgentFlowSnapshot('agentflow-run-1', 'running'),
        makeAgentFlowSnapshot('agentflow-run-1', 'running'),
        makeAgentFlowSnapshot('agentflow-run-2', 'completed'),
      ]),
      stop: vi.fn(async () => undefined),
    };
    const cliRuntime: CLIAgentSessionRuntimePort = {
      stopSession: vi.fn(async () => ({
        parentSessionId: 'branch-session',
        childSessionId: 'cli-session',
        agentId: 'codex',
        workdir: 'C:\\Projekty\\FamilyQuest',
        status: 'stopped' as const,
        lastPrompt: 'stop',
        updatedAt: Date.now(),
      })),
    };
    const service = new SessionRuntimeStopService(
      sessions as never,
      pipeline as never,
      agentFlowRuntime as AgentFlowRuntimePort,
      cliRuntime,
      architectureRuntime,
      subagentRuntime as SubagentRuntimePort,
    );

    const sessionTree = await service.stopSessionTree('root-session');

    expect(sessionTree.sessionIds).toEqual(['root-session', 'branch-session', 'cli-session']);
    expect(architectureRuntime.stopRunsForSessions).toHaveBeenCalledWith([
      'root-session',
      'branch-session',
      'cli-session',
    ]);
    expect(agentFlowRuntime.stop).toHaveBeenCalledTimes(1);
    expect(agentFlowRuntime.stop).toHaveBeenCalledWith('agentflow-run-1');
    expect(stopAndDrainSubagents).toHaveBeenCalledWith([
      'root-session',
      'branch-session',
      'cli-session',
    ]);
    expect(cliRuntime.stopSession).toHaveBeenCalledWith('branch-session', 'cli-session');
    expect(stopAndDrainSubagents.mock.invocationCallOrder[0]).toBeLessThan(
      pipeline.stopAndDrain.mock.invocationCallOrder[0],
    );
    expect(pipeline.stopAndDrain).toHaveBeenNthCalledWith(1, 'root-session');
    expect(pipeline.stopAndDrain).toHaveBeenNthCalledWith(2, 'branch-session');
    expect(pipeline.stopAndDrain).toHaveBeenNthCalledWith(3, 'cli-session');
  });

  it('logs subagent stop failures and still drains the chat pipeline', async () => {
    const sessions = {
      listChildren: vi.fn(async () => []),
      get: vi.fn(async () => rootSession),
    };
    const pipeline = {
      stopAndDrain: vi.fn(async () => undefined),
    };
    const stopAndDrainSubagents = vi.fn(async () => {
      throw new Error('transport down');
    });
    const service = new SessionRuntimeStopService(
      sessions as never,
      pipeline as never,
      undefined,
      undefined,
      undefined,
      { stopAndDrainSessions: stopAndDrainSubagents } as unknown as SubagentRuntimePort,
    );
    const warn = vi.spyOn(
      (service as unknown as { logger: { warn: (message: string) => void } }).logger,
      'warn',
    ).mockImplementation(() => undefined);

    const sessionTree = await service.stopSessionTree('root-session');

    expect(sessionTree.sessionIds).toEqual(['root-session']);
    expect(stopAndDrainSubagents).toHaveBeenCalledWith(['root-session']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to stop subagent runs: transport down'));
    expect(pipeline.stopAndDrain).toHaveBeenCalledTimes(1);
    expect(pipeline.stopAndDrain).toHaveBeenCalledWith('root-session');
  });
});
