import type { ChatMessage } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { reconstructDurableArchitectureGraph } from './architecture-durable-graph';
import type { SessionsService } from '../chat/sessions.service';

describe('reconstructDurableArchitectureGraph', () => {
  it('does not double-prefix node session ids when replaying an arch-prefixed run id', async () => {
    const runId = 'arch-prefixed-replay-run';
    const registry = new ArchitectureRegistryService();
    const sessions = createPersistedSessions({
      [`${runId}-root`]: [
        {
          id: `architecture:${runId}:user`,
          sessionId: `${runId}-root`,
          role: 'user',
          content: '[Architecture: strategic-decision-council]\nAssess the project architecture.',
          createdAt: 100,
        },
        {
          id: `architecture:${runId}:router`,
          sessionId: `${runId}-router`,
          role: 'assistant',
          content: '### Router\nRoute: router -> final-artifact',
          architectureRun: {
            runId,
            schemaId: 'strategic-decision-council',
            status: 'completed',
            trace: [],
            routeHops: [{
              eventId: `architecture:${runId}:router`,
              source: 'router',
              fromNodeId: 'router',
              toNodeId: 'final-artifact',
            }],
          },
          createdAt: 101,
        },
        {
          id: `architecture:${runId}:finalizer`,
          sessionId: `${runId}-finalizer`,
          role: 'assistant',
          content: '### Finalizer\nFinal answer.',
          createdAt: 102,
        },
      ],
    });

    const graph = await reconstructDurableArchitectureGraph(runId, sessions, registry);

    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'router',
        sessionId: `${runId}-router`,
        action: 'router_selected',
        detail: 'Selected final-artifact.',
      }),
      expect.objectContaining({
        id: 'final-artifact',
        sessionId: `${runId}-finalizer`,
        action: 'finalizer_completed',
        detail: 'Final answer ready.',
      }),
    ]));
    expect(graph?.nodes.map((node) => node.sessionId)).not.toContain(`arch-${runId}-router`);
  });

  it('does not infer router or finalizer completion from assistant markdown headers', async () => {
    const runId = 'durable-no-prose-state-run';
    const registry = new ArchitectureRegistryService();
    const sessions = createPersistedSessions({
      [`arch-${runId}-root`]: [
        {
          id: `architecture:${runId}:tool-calls`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: `architecture:${runId}:tool-call:1`,
            name: 'run_subagent',
            args: {
              architectureRunId: runId,
              schemaName: 'Goal Master Delivery Loop',
            },
          }],
          createdAt: 100,
        },
        {
          id: `architecture:${runId}:router-prose`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '### Router\nRoute: router -> final-artifact',
          createdAt: 101,
        },
        {
          id: `architecture:${runId}:finalizer-prose`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '### Finalizer\nVerified completion report.',
          createdAt: 102,
        },
      ],
    });

    const graph = await reconstructDurableArchitectureGraph(runId, sessions, registry);

    expect(graph?.routeHops).toEqual([]);
    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'orchestrator', status: 'pending' }),
      expect.objectContaining({ id: 'final-artifact', status: 'pending' }),
    ]));
  });

  it('uses typed architecture event ids and treats tool call ids as opaque fallbacks', async () => {
    const runId = 'durable-typed-event-id-run';
    const registry = new ArchitectureRegistryService();
    const sessions = createPersistedSessions({
      [`arch-${runId}-root`]: [
        {
          id: `architecture:${runId}:user`,
          sessionId: `arch-${runId}-root`,
          role: 'user',
          content: '[Architecture: strategic-decision-council]\nAssess architecture.',
          createdAt: 100,
        },
        {
          id: `architecture:${runId}:tool-calls`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: `architecture:${runId}:legacy-pragmatist-event`,
              name: 'run_subagent',
              args: {
                architectureRunId: runId,
                nodeId: 'pragmatist',
                architectureEventId: 'typed-pragmatist-event',
              },
            },
            {
              id: `architecture:${runId}:legacy-analyst-event`,
              name: 'run_subagent',
              args: {
                architectureRunId: runId,
                nodeId: 'analyst',
              },
            },
          ],
          createdAt: 101,
        },
      ],
    });

    const graph = await reconstructDurableArchitectureGraph(runId, sessions, registry);

    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'pragmatist',
        eventIds: ['typed-pragmatist-event'],
      }),
      expect.objectContaining({
        id: 'analyst',
        eventIds: [`architecture:${runId}:legacy-analyst-event`],
      }),
    ]));
  });

  it('projects persisted CLI child evidence from expected files and keeps completed status over stale running snapshots', async () => {
    const runId = 'durable-child-proof-run';
    const registry = new ArchitectureRegistryService();
    const sessions = createPersistedSessions({
      [`arch-${runId}-root`]: [
        {
          id: `architecture:${runId}:user`,
          sessionId: `arch-${runId}-root`,
          role: 'user',
          content: '[Architecture: goal-master-delivery-loop]\nDeliver the proof run.',
          createdAt: 100,
        },
        {
          id: `architecture:${runId}:finalizer`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '### Finalizer\nVerified completion report.',
          architectureRun: {
            runId,
            schemaId: 'goal-master-delivery-loop',
            status: 'completed',
            trace: [],
            routeHops: [],
          },
          createdAt: 105,
        },
      ],
      [`arch-${runId}-implementer`]: [
        {
          id: `architecture:${runId}:spawn`,
          sessionId: `arch-${runId}-implementer`,
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: `architecture:${runId}:tool-call:1`,
            name: 'spawn_cli_agent',
            args: {
              architectureRunId: runId,
              nodeId: 'implementer',
              roleSlotId: 'implementer',
              agentId: 'copilot',
              workdir: 'C:\\Projekty\\TurboProject2',
              expectedChangedFiles: ['src/App.tsx'],
            },
          }],
          createdAt: 101,
        },
        {
          id: `architecture:${runId}:spawn-result`,
          sessionId: `arch-${runId}-implementer`,
          role: 'tool_result',
          toolCallId: `architecture:${runId}:tool-call:1`,
          content: JSON.stringify({
            childSessionId: 'cli-child-1',
            agentId: 'copilot',
            status: 'completed',
            workdir: 'C:\\Projekty\\TurboProject2',
          }),
          createdAt: 102,
        },
        {
          id: `architecture:${runId}:status`,
          sessionId: `arch-${runId}-implementer`,
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: `architecture:${runId}:tool-call:2`,
            name: 'get_cli_agent_status',
            args: {
              architectureRunId: runId,
              childSessionId: 'cli-child-1',
              nodeId: 'implementer',
              roleSlotId: 'implementer',
            },
          }],
          createdAt: 103,
        },
        {
          id: `architecture:${runId}:status-result`,
          sessionId: `arch-${runId}-implementer`,
          role: 'tool_result',
          toolCallId: `architecture:${runId}:tool-call:2`,
          content: JSON.stringify({
            childSessionId: 'cli-child-1',
            agentId: 'copilot',
            status: 'running',
            workdir: 'C:\\Projekty\\TurboProject2',
          }),
          createdAt: 104,
        },
      ],
    });

    const graph = await reconstructDurableArchitectureGraph(runId, sessions, registry);

    expect(graph).toMatchObject({
      runId,
      nodes: expect.arrayContaining([
        expect.objectContaining({
          id: 'final-artifact',
          sessionId: `arch-${runId}-finalizer`,
          status: 'completed',
          action: 'finalizer_completed',
          detail: 'Final answer ready.',
        }),
        expect.objectContaining({ id: 'implementer', sessionId: `arch-${runId}-implementer`, status: 'pending' }),
      ]),
      childAgents: [
        expect.objectContaining({
          id: 'cli-child-1',
          parentNodeId: 'implementer',
          parentRoleSlotId: 'implementer',
          backend: 'copilot',
          status: 'completed',
          toolName: 'get_cli_agent_status',
          workdir: 'C:\\Projekty\\TurboProject2',
          targetPaths: ['src/App.tsx'],
        }),
      ],
    });
  });

  it('normalizes success, terminal-success and exited CLI child snapshots to completed status during durable reconstruction', async () => {
    const runId = 'durable-child-terminal-aliases-run';
    const registry = new ArchitectureRegistryService();
    const sessions = createPersistedSessions({
      [`arch-${runId}-root`]: [
        {
          id: `architecture:${runId}:user`,
          sessionId: `arch-${runId}-root`,
          role: 'user',
          content: '[Architecture: goal-master-delivery-loop]\nDeliver the alias run.',
          createdAt: 100,
        },
        {
          id: `architecture:${runId}:finalizer`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '### Finalizer\nVerified completion report.',
          architectureRun: {
            runId,
            schemaId: 'goal-master-delivery-loop',
            status: 'completed',
            trace: [],
            routeHops: [],
          },
          createdAt: 106,
        },
      ],
      [`arch-${runId}-implementer`]: [
        {
          id: `architecture:${runId}:spawn`,
          sessionId: `arch-${runId}-implementer`,
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: `architecture:${runId}:tool-call:1`,
            name: 'spawn_cli_agent',
            args: {
              architectureRunId: runId,
              nodeId: 'implementer',
              roleSlotId: 'implementer',
              agentId: 'copilot',
              workdir: 'C:\\Projekty\\TurboProject2',
              expectedChangedFiles: ['src/App.tsx'],
            },
          }],
          createdAt: 101,
        },
        {
          id: `architecture:${runId}:spawn-result`,
          sessionId: `arch-${runId}-implementer`,
          role: 'tool_result',
          toolCallId: `architecture:${runId}:tool-call:1`,
          content: JSON.stringify({
            childSessionId: 'cli-child-2',
            agentId: 'copilot',
            status: 'success',
            workdir: 'C:\\Projekty\\TurboProject2',
          }),
          createdAt: 102,
        },
        {
          id: `architecture:${runId}:status`,
          sessionId: `arch-${runId}-implementer`,
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: `architecture:${runId}:tool-call:2`,
            name: 'get_cli_agent_status',
            args: {
              architectureRunId: runId,
              childSessionId: 'cli-child-2',
              nodeId: 'implementer',
              roleSlotId: 'implementer',
            },
          }],
          createdAt: 103,
        },
        {
          id: `architecture:${runId}:status-result`,
          sessionId: `arch-${runId}-implementer`,
          role: 'tool_result',
          toolCallId: `architecture:${runId}:tool-call:2`,
          content: JSON.stringify({
            childSessionId: 'cli-child-2',
            agentId: 'copilot',
            status: 'terminal-success',
            workdir: 'C:\\Projekty\\TurboProject2',
          }),
          createdAt: 104,
        },
      ],
    });

    const graph = await reconstructDurableArchitectureGraph(runId, sessions, registry);

    expect(graph).toMatchObject({
      runId,
      childAgents: [
        expect.objectContaining({
          id: 'cli-child-2',
          parentNodeId: 'implementer',
          parentRoleSlotId: 'implementer',
          backend: 'copilot',
          status: 'completed',
          toolName: 'get_cli_agent_status',
          workdir: 'C:\\Projekty\\TurboProject2',
          targetPaths: ['src/App.tsx'],
        }),
      ],
    });
    expect(graph?.childAgents).toHaveLength(1);
  });

  it('returns null when persisted messages resolve to an unknown architecture schema', async () => {
    const runId = 'wrong-schema-run';
    const registry = new ArchitectureRegistryService();
    const sessions = createPersistedSessions({
      [`arch-${runId}-root`]: [
        {
          id: `architecture:${runId}:user`,
          sessionId: `arch-${runId}-root`,
          role: 'user',
          content: '[Architecture: not-a-real-schema]\nDeliver the proof run.',
          createdAt: 100,
        },
        {
          id: `architecture:${runId}:finalizer`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '### Finalizer\nVerified completion report.',
          architectureRun: {
            runId,
            schemaId: 'not-a-real-schema',
            status: 'completed',
            trace: [],
            routeHops: [],
          },
          createdAt: 101,
        },
      ],
    });

    await expect(reconstructDurableArchitectureGraph(runId, sessions, registry)).resolves.toBeNull();
  });

  it('recovers the schema from persisted subagent tool-call args when the parent prompt no longer carries an architecture header', async () => {
    const runId = 'schema-name-fallback-run';
    const registry = new ArchitectureRegistryService();
    const sessions = createPersistedSessions({
      [`arch-${runId}-root`]: [
        {
          id: `architecture:${runId}:user`,
          sessionId: `arch-${runId}-root`,
          role: 'user',
          content: 'Deliver the proof run.',
          createdAt: 100,
        },
        {
          id: `architecture:${runId}:tool-calls`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '',
          toolCalls: [{
            id: `architecture:${runId}:tool-call:1`,
            name: 'run_subagent',
            args: {
              architectureRunId: runId,
              schemaName: 'Goal Master Delivery Loop',
              nodeId: 'implementer',
              roleSlotId: 'implementer',
              childSessionId: `arch-${runId}-implementer`,
            },
          }],
          createdAt: 101,
        },
        {
          id: `architecture:${runId}:finalizer`,
          sessionId: `arch-${runId}-root`,
          role: 'assistant',
          content: '### Finalizer\nVerified completion report.',
          createdAt: 102,
        },
      ],
    });

    const graph = await reconstructDurableArchitectureGraph(runId, sessions, registry);

    expect(graph).toMatchObject({
      runId,
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'implementer' }),
        expect.objectContaining({ id: 'final-artifact' }),
      ]),
    });
  });
});

function createPersistedSessions(messagesBySession: Record<string, ChatMessage[]>): SessionsService {
  return {
    list: vi.fn(async () => Object.entries(messagesBySession).map(([id, messages]) => ({
      id,
      runtimeContext: {
        runtimeKind: 'agent-flow-branch' as const,
        architectureContext: {
          architectureRunId: inferFixtureArchitectureRunId(messages),
        },
      },
    }))),
    getMessages: vi.fn(async (sessionId: string) => messagesBySession[sessionId] ?? []),
  } as unknown as SessionsService;
}

function inferFixtureArchitectureRunId(messages: ChatMessage[]): string | undefined {
  for (const message of messages) {
    if (message.architectureRun?.runId) {
      return message.architectureRun.runId;
    }
    for (const toolCall of message.toolCalls ?? []) {
      const runId = toolCall.args['architectureRunId'];
      if (typeof runId === 'string') {
        return runId;
      }
    }
  }
  return undefined;
}
