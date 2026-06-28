import { describe, expect, it, vi } from 'vitest';
import {
  extractAllowanceContext,
  mergeAgentFlowLaunchContext,
  resolveEffectiveAgentFlowContext,
  resolveParentAllowanceBaseline,
} from './agent-flow-launch-context';
import type { AgentFlowLaunchContextDeps } from './agent-flow-launch-context';

function makeDeps(input: {
  sessions?: Record<string, {
    parentSessionId?: string;
    architectureContext?: Record<string, unknown>;
  }>;
  architectureRuns?: Record<string, { context?: Record<string, unknown> }>;
}): AgentFlowLaunchContextDeps {
  return {
    sessions: {
      get: vi.fn(async (id: string) => {
        const session = input.sessions?.[id];
        if (!session) {
          throw new Error(`Session not found: ${id}`);
        }
        return {
          id,
          personaId: 'default',
          title: 'Test',
          kind: 'chat' as const,
          parentSessionId: session.parentSessionId,
          runtimeContext: session.architectureContext
            ? { runtimeKind: 'agent-flow-branch' as const, architectureContext: session.architectureContext }
            : undefined,
          createdAt: 1,
          updatedAt: 1,
        };
      }) as AgentFlowLaunchContextDeps['sessions']['get'],
    },
    architectureRuntime: {
      findRunDurable: vi.fn(async (runId: string) => {
        const run = input.architectureRuns?.[runId];
        return run
          ? {
              id: runId,
              schemaId: 'goal-master-delivery-loop',
              prompt: 'Test',
              executionMode: 'subagent_execution' as const,
              context: run.context,
              status: 'running' as const,
              createdAt: 1,
              updatedAt: 1,
            }
          : null;
      }) as AgentFlowLaunchContextDeps['architectureRuntime']['findRunDurable'],
    },
  };
}

describe('agent-flow-launch-context', () => {
  it('extractAllowanceContext keeps only allowance-relevant keys', () => {
    expect(extractAllowanceContext({
      projectPath: 'C:\\demo',
      launchAllowedToolNames: ['fs_read'],
      parentSessionId: 'spoofed',
      subAgentFlow: { flowId: 'x' },
      noise: true,
    })).toEqual({
      projectPath: 'C:\\demo',
      launchAllowedToolNames: ['fs_read'],
    });
  });

  it('inherits projectPath from parent session runtimeContext when launch context is empty', async () => {
    const deps = makeDeps({
      sessions: {
        'branch-1': {
          parentSessionId: 'arch-run-1-root',
          architectureContext: {
            projectPath: 'C:\\Projekty\\kalio-forever',
            executionCwd: 'C:\\Projekty\\kalio-forever',
          },
        },
        'arch-run-1-root': {
          parentSessionId: 'chat-parent',
        },
      },
    });

    const effective = await resolveEffectiveAgentFlowContext('branch-1', undefined, deps);
    expect(effective).toEqual({
      projectPath: 'C:\\Projekty\\kalio-forever',
      executionCwd: 'C:\\Projekty\\kalio-forever',
    });
  });

  it('explicit launch context overrides inherited defaults', async () => {
    const deps = makeDeps({
      sessions: {
        'parent-1': {
          architectureContext: {
            projectPath: 'C:\\Projekty\\old',
            executionCwd: 'C:\\Projekty\\old',
          },
        },
      },
    });

    const effective = await resolveEffectiveAgentFlowContext('parent-1', {
      projectPath: 'C:\\Projekty\\new',
      executionCwd: 'C:\\Projekty\\new',
    }, deps);

    expect(effective).toEqual({
      projectPath: 'C:\\Projekty\\new',
      executionCwd: 'C:\\Projekty\\new',
    });
  });

  it('honors orchestratorScopeRestriction with narrower explicit paths', () => {
    const merged = mergeAgentFlowLaunchContext({
      baseline: {
        projectPath: 'C:\\Projekty\\wide',
        executionCwd: 'C:\\Projekty\\wide',
        allowArchitectureOrchestratorSubagents: true,
      },
      launchContext: {
        orchestratorScopeRestriction: { reason: 'folder scoped run' },
        projectPath: 'C:\\Projekty\\wide\\sub',
        executionCwd: 'C:\\Projekty\\wide\\sub',
        allowArchitectureOrchestratorSubagents: false,
      },
    });

    expect(merged).toEqual({
      projectPath: 'C:\\Projekty\\wide\\sub',
      executionCwd: 'C:\\Projekty\\wide\\sub',
      allowArchitectureOrchestratorSubagents: false,
      orchestratorScopeRestriction: { reason: 'folder scoped run' },
    });
  });

  it('clears inherited launchAllowedToolNames when orchestrator scope narrows without an explicit tool list', () => {
    const merged = mergeAgentFlowLaunchContext({
      baseline: {
        projectPath: 'C:\\Projekty\\wide',
        executionCwd: 'C:\\Projekty\\wide',
        launchAllowedToolNames: ['fs_read', 'fs_list', 'terminal_spawn'],
      },
      launchContext: {
        orchestratorScopeRestriction: { reason: 'folder scoped run' },
        projectPath: 'C:\\Projekty\\wide\\sub',
        executionCwd: 'C:\\Projekty\\wide\\sub',
      },
    });

    expect(merged).toEqual({
      projectPath: 'C:\\Projekty\\wide\\sub',
      executionCwd: 'C:\\Projekty\\wide\\sub',
      orchestratorScopeRestriction: { reason: 'folder scoped run' },
    });
  });

  it('does not reuse stale AgentFlow checkpoint allowance when session has no runtime context', async () => {
    const deps = makeDeps({
      sessions: {
        'chat-parent': {},
      },
    });

    const baseline = await resolveParentAllowanceBaseline('chat-parent', deps);
    expect(baseline).toEqual({});
  });

  it('does not copy parentSessionId from launch args', () => {
    const merged = mergeAgentFlowLaunchContext({
      baseline: { projectPath: 'C:\\base' },
      launchContext: {
        parentSessionId: 'spoofed-parent',
        goal: 'ignored',
        projectPath: 'C:\\explicit',
      },
    });

    expect(merged).toEqual({
      projectPath: 'C:\\explicit',
    });
    expect(merged).not.toHaveProperty('parentSessionId');
  });

  it('loads architecture run context from typed parent session architecture context', async () => {
    const deps = makeDeps({
      sessions: {
        'arch-run-1-implementer': {
          parentSessionId: 'arch-run-1-root',
        },
        'arch-run-1-root': {
          parentSessionId: 'chat-parent',
          architectureContext: {
            architectureRunId: 'run-1',
          },
        },
      },
      architectureRuns: {
        'run-1': {
          context: {
            projectPath: 'C:\\Projekty\\from-run',
            allowArchitectureOrchestratorSubagents: true,
          },
        },
      },
    });

    const baseline = await resolveParentAllowanceBaseline('arch-run-1-implementer', deps);
    expect(baseline).toEqual({
      projectPath: 'C:\\Projekty\\from-run',
      allowArchitectureOrchestratorSubagents: true,
    });
  });

  it('inherits launchAllowedToolNames from parent session architecture context', async () => {
    const deps = makeDeps({
      sessions: {
        'branch-allowance': {
          architectureContext: {
            projectPath: 'C:\\Projekty\\kalio-forever',
            launchAllowedToolNames: ['vfs_read', 'fs_read', 'terminal_spawn'],
          },
        },
      },
    });

    const effective = await resolveEffectiveAgentFlowContext('branch-allowance', undefined, deps);
    expect(effective).toEqual({
      projectPath: 'C:\\Projekty\\kalio-forever',
      launchAllowedToolNames: ['vfs_read', 'fs_read', 'terminal_spawn'],
    });
  });
});
