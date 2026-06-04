import type { ChatMessage } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { reconstructDurableArchitectureGraph } from './architecture-durable-graph';
import type { SessionsService } from '../chat/sessions.service';

describe('reconstructDurableArchitectureGraph', () => {
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
        expect.objectContaining({ id: 'final-artifact', status: 'completed' }),
        expect.objectContaining({ id: 'implementer', status: 'pending' }),
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
          createdAt: 101,
        },
      ],
    });

    await expect(reconstructDurableArchitectureGraph(runId, sessions, registry)).resolves.toBeNull();
  });
});

function createPersistedSessions(messagesBySession: Record<string, ChatMessage[]>): SessionsService {
  return {
    list: vi.fn(async () => Object.keys(messagesBySession).map((id) => ({ id }))),
    getMessages: vi.fn(async (sessionId: string) => messagesBySession[sessionId] ?? []),
  } as unknown as SessionsService;
}
