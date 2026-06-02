import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatMessage, ChatSession, CreateSessionDto } from '@kalio/types';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionsService } from '../chat/sessions.service';
import { ArchitectureRegistryController } from './architecture-registry.controller';
import { ArchitectureRegistryService } from './architecture-registry.service';
import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import { ArchitectureRunsController } from './architecture-runs.controller';
import { ArchitectureRuntimeService } from './architecture-runtime.service';

describe('Architecture controllers', () => {
  const tempDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all([...tempDirs].map((dirPath) => rm(dirPath, { recursive: true, force: true })));
    tempDirs.clear();
  });

  it('exposes registry schemas and 404s missing schema ids', () => {
    const controller = new ArchitectureRegistryController(new ArchitectureRegistryService());

    expect(controller.findAll()[0].id).toBe('strategic-decision-council');
    expect(controller.findOne('strategic-decision-council').name).toBe('Strategic Decision Council');
    expect(() => controller.findOne('missing')).toThrow(NotFoundException);
  });

  it('creates registry schema variants and 404s missing base schema ids', async () => {
    const controller = new ArchitectureRegistryController(await createTempRegistryService(tempDirs));

    const variant = await controller.createVariant('strategic-decision-council', {
      name: 'Cost-heavy council',
      roleSlotPersonaOverrides: { analyst: 'persona.cost_analyst' },
    });

    expect(variant.id).toBe('strategic-decision-council-variant-1');
    expect(variant.roleSlots.find((slot) => slot.id === 'analyst')?.defaultPersonaId).toBe('persona.cost_analyst');
    expect(controller.findAll().map((schema) => schema.id)).toContain('strategic-decision-council-variant-1');
    await expect(controller.createVariant('missing', {})).rejects.toThrow(NotFoundException);
  });

  it('deletes registry variants and rejects missing or base schema deletes', async () => {
    const controller = new ArchitectureRegistryController(await createTempRegistryService(tempDirs));
    await controller.createVariant('strategic-decision-council', {
      name: 'Delete me',
      roleSlotPersonaOverrides: { shadow: 'persona.security_shadow' },
    });

    await expect(controller.removeVariant('strategic-decision-council')).rejects.toThrow(BadRequestException);
    await expect(controller.removeVariant('missing')).rejects.toThrow(NotFoundException);
    await expect(controller.removeVariant('strategic-decision-council-variant-1')).resolves.toBeUndefined();
    expect(controller.findAll().map((schema) => schema.id)).not.toContain('strategic-decision-council-variant-1');
  });

  it('exposes created run projections and 404s missing run ids', async () => {
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions() as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );
    const controller = new ArchitectureRunsController(runtime);

    const run = await controller.create({
      schemaId: 'strategic-decision-council',
      prompt: 'Pick the orchestration shape.',
    });

    await expect(controller.findOne(run.id)).resolves.toEqual(run);
    await expect(controller.events(run.id)).resolves.toHaveLength(runtime.getEvents(run.id).length);
    await expect(controller.graph(run.id)).resolves.toMatchObject({ runId: run.id });
    await expect(controller.chat(run.id)).resolves.toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ speaker: 'finalizer' })]),
    });
    await expect(controller.findOne('missing')).rejects.toThrow(NotFoundException);
    await expect(controller.events('missing')).rejects.toThrow(NotFoundException);
    await expect(controller.graph('missing')).rejects.toThrow(NotFoundException);
    await expect(controller.chat('missing')).rejects.toThrow(NotFoundException);
  });

  it('stops async architecture runs so they no longer look running', async () => {
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions() as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      {
        execute: () => new Promise(() => undefined),
      },
    );
    const controller = new ArchitectureRunsController(runtime);

    const run = await controller.createAsync({
      schemaId: 'strategic-decision-council',
      prompt: 'Keep running until stopped.',
      executionMode: 'subagent_execution',
    });
    const stopped = await controller.stop(run.id);
    const events = await controller.events(run.id);

    expect(stopped.status).toBe('failed');
    expect(stopped.completedAt).toBeDefined();
    expect(events.at(-1)).toMatchObject({
      type: 'router_decision',
      message: 'Architecture run stopped by user.',
      data: { stoppedByUser: true },
    });
    await expect(controller.findOne(run.id)).resolves.toMatchObject({ status: 'failed' });
  });

  it('enriches architecture run context with configured CLI-agent preferences', async () => {
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions() as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
      undefined,
      undefined,
      {
        getConfig: async (agentId: string) => ({
          enabled: true,
          cliPath: '',
          timeoutMs: 900_000,
          hardTimeoutEnabled: false,
          hardTimeoutMs: 3_600_000,
          autoRecoveryEnabled: false,
          autoRecoveryPrompt: 'continue',
          maxOutputChars: 16_000,
          model: agentId === 'codex' ? 'gpt-5.2' : '',
          architecturePreference: agentId === 'codex'
            ? 'Use conservative verification.'
            : '',
          extraArgs: [],
        }),
      } as never,
    );

    const run = await runtime.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Check the run.',
    });

    expect(run.context?.['cliAgentToolPreferences']).toEqual({
      codex: {
        model: 'gpt-5.2',
        preference: 'Use conservative verification.',
      },
    });
  });

  it('keeps persisted CLI child agents visible when live graph events exist', async () => {
    const persistedMessages: ChatMessage[] = [];
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions({ messages: persistedMessages }) as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );
    const controller = new ArchitectureRunsController(runtime);

    const run = await controller.create({
      schemaId: 'strategic-decision-council',
      prompt: 'Build the demo site.',
      executionMode: 'subagent_execution',
    });
    const toolCallId = `architecture:${run.id}:${run.id}:event:4`;
    const rootSessionId = run.rootSessionId ?? `arch-${run.id}-root`;
    persistedMessages.push(
      {
        id: `architecture:${run.id}:user`,
        sessionId: rootSessionId,
        role: 'user',
        content: '[Architecture: Strategic Decision Council]\nBuild the demo site.',
        createdAt: 1,
      },
      {
        id: `architecture:${run.id}:tool-calls`,
        sessionId: `arch-${run.id}-orchestrator`,
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: toolCallId,
          name: 'spawn_cli_agent',
          args: {
            architectureRunId: run.id,
            nodeId: 'shadow',
            roleSlotId: 'shadow',
            agentId: 'copilot',
            workdir: 'C:\\Projekty\\TurboProject2',
            expectedChangedFiles: ['src/App.tsx'],
          },
        }],
        createdAt: 2,
      },
      {
        id: `architecture:${run.id}:tool-result`,
        sessionId: `arch-${run.id}-orchestrator`,
        role: 'tool_result',
        toolCallId,
        content: JSON.stringify({
          childSessionId: 'cli-child-live-overlay',
          agentId: 'copilot',
          workdir: 'C:\\Projekty\\TurboProject2',
          status: 'running',
        }),
        createdAt: 3,
      },
    );

    await expect(controller.graph(run.id)).resolves.toMatchObject({
      runId: run.id,
      childAgents: [expect.objectContaining({
        id: 'cli-child-live-overlay',
        parentNodeId: 'shadow',
        parentRoleSlotId: 'shadow',
        kind: 'cli-agent',
        backend: 'copilot',
        status: 'running',
        toolName: 'spawn_cli_agent',
      })],
    });
  });

  it('reconstructs graph projections from persisted architecture parent messages after runtime memory is gone', async () => {
    const runId = 'persisted-run-1';
    const persistedMessages: ChatMessage[] = [
      {
        id: `architecture:${runId}:user`,
        sessionId: 'parent-session',
        role: 'user',
        content: '[Architecture: Five Minds Council]\nReview the release workflow.',
        createdAt: 1,
      },
      {
        id: `architecture:${runId}:tool-calls`,
        sessionId: 'parent-session',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: `architecture:${runId}:${runId}:event:3`,
            name: 'run_subagent',
            args: {
              architectureRunId: runId,
              nodeId: 'pragmatist',
              roleSlotId: 'pragmatist',
              childSessionId: `arch-${runId}-pragmatist`,
            },
          },
        ],
        createdAt: 2,
      },
      {
        id: `architecture:${runId}:text:${runId}:event:8`,
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Router\n\nRoute: agent -> final-artifact\n\nSynthesize findings.',
        createdAt: 3,
      },
    ];
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions({ messages: persistedMessages }) as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );
    const controller = new ArchitectureRunsController(runtime);

    await expect(controller.graph(runId)).resolves.toMatchObject({
      runId,
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'pragmatist', status: 'completed' }),
        expect.objectContaining({ id: 'synthesizer', status: 'completed' }),
        expect.objectContaining({ id: 'final-artifact', status: 'completed' }),
      ]),
      routeHops: expect.arrayContaining([
        expect.objectContaining({ fromNodeId: 'pragmatist', toNodeId: 'synthesizer' }),
        expect.objectContaining({ fromNodeId: 'synthesizer', toNodeId: 'final-artifact' }),
      ]),
    });
  });

  it('reconstructs CLI child agents from persisted architecture tool history', async () => {
    const runId = 'persisted-cli-run';
    const toolCallId = `architecture:${runId}:${runId}:event:4`;
    const persistedMessages: ChatMessage[] = [
      {
        id: `architecture:${runId}:user`,
        sessionId: 'parent-session',
        role: 'user',
        content: '[Architecture: Goal Master Delivery Loop]\nCreate a project.',
        createdAt: 1,
      },
      {
        id: `architecture:${runId}:tool-calls`,
        sessionId: 'parent-session',
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: toolCallId,
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
        createdAt: 2,
      },
      {
        id: `architecture:${runId}:tool-result`,
        sessionId: 'parent-session',
        role: 'tool_result',
        toolCallId,
        content: JSON.stringify({
          childSessionId: 'cli-child-1',
          agentId: 'copilot',
          workdir: 'C:\\Projekty\\TurboProject2',
          status: 'running',
        }),
        createdAt: 3,
      },
    ];
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions({ messages: persistedMessages }) as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );

    const graph = await runtime.getGraphDurable(runId);

    expect(graph?.childAgents).toEqual([{
      id: 'cli-child-1',
      parentNodeId: 'implementer',
      parentRoleSlotId: 'implementer',
      parentEventId: `${runId}:event:4`,
      kind: 'cli-agent',
      backend: 'copilot',
      status: 'running',
      toolName: 'spawn_cli_agent',
      workdir: 'C:\\Projekty\\TurboProject2',
      targetPaths: ['src/App.tsx'],
      updatedAt: 2,
    }]);
  });

  it('detects schema from real architecture branch prompt headers', async () => {
    const runId = 'persisted-real-header-run';
    const toolCallId = 'call-real-header';
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions({
        sessions: [
          {
            id: `arch-${runId}-orchestrator`,
            personaId: 'orchestrator',
            title: 'Goal Master Delivery Loop: Orchestrator',
            kind: 'subagent',
            parentSessionId: `arch-${runId}-root`,
            createdAt: 1,
            updatedAt: 3,
          },
          {
            id: 'cli-child-snapshot',
            personaId: 'orchestrator',
            title: 'gemini CLI',
            kind: 'cli-agent',
            parentSessionId: `arch-${runId}-orchestrator`,
            createdAt: 3,
            updatedAt: 4,
          },
        ],
        messages: [
          {
            id: 'real-header-user',
            sessionId: `arch-${runId}-orchestrator`,
            role: 'user',
            content: 'Architecture: Goal Master Delivery Loop v0.1.0\nSlot: Orchestrator (router)\nTask: Create a project.',
            createdAt: 1,
          },
          {
            id: 'real-header-tool-call',
            sessionId: `arch-${runId}-orchestrator`,
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: toolCallId,
              name: 'spawn_cli_agent',
              args: {
                agentId: 'copilot',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
            }],
            createdAt: 2,
          },
          {
            id: 'real-header-tool-result',
            sessionId: `arch-${runId}-orchestrator`,
            role: 'tool_result',
            toolCallId,
            content: JSON.stringify({
              childSessionId: 'cli-real-header-child',
              agentId: 'copilot',
              workdir: 'C:\\Projekty\\TurboProject2',
              status: 'running',
            }),
            createdAt: 3,
          },
        ],
      }) as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );

    await expect(runtime.getGraphDurable(runId)).resolves.toMatchObject({
      runId,
      childAgents: [expect.objectContaining({
        id: 'cli-real-header-child',
        parentNodeId: 'orchestrator',
        parentRoleSlotId: 'orchestrator',
        backend: 'copilot',
        status: 'running',
      })],
    });
  });

  it('updates persisted CLI child status from child-session snapshots after async completion', async () => {
    const runId = 'persisted-cli-child-snapshot-run';
    const toolCallId = 'call-cli-child-snapshot';
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions({
        messages: [
          {
            id: 'snapshot-header-user',
            sessionId: `arch-${runId}-orchestrator`,
            role: 'user',
            content: 'Architecture: Goal Master Delivery Loop v0.1.0\nSlot: Orchestrator (router)\nTask: Create a project.',
            createdAt: 1,
          },
          {
            id: 'snapshot-tool-call',
            sessionId: `arch-${runId}-orchestrator`,
            role: 'assistant',
            content: '',
            toolCalls: [{
              id: toolCallId,
              name: 'spawn_cli_agent',
              args: {
                agentId: 'gemini',
                workdir: 'C:\\Projekty\\TurboProject2',
              },
            }],
            createdAt: 2,
          },
          {
            id: 'snapshot-tool-result-running',
            sessionId: `arch-${runId}-orchestrator`,
            role: 'tool_result',
            toolCallId,
            content: JSON.stringify({
              childSessionId: 'cli-child-snapshot',
              agentId: 'gemini',
              workdir: 'C:\\Projekty\\TurboProject2',
              status: 'running',
            }),
            createdAt: 3,
          },
          {
            id: 'snapshot-child-tool-result-failed',
            sessionId: 'cli-child-snapshot',
            role: 'tool_result',
            toolCallId: 'cli-run-1',
            content: JSON.stringify({
              childSessionId: 'cli-child-snapshot',
              parentSessionId: `arch-${runId}-orchestrator`,
              agentId: 'gemini',
              workdir: 'C:\\Projekty\\TurboProject2',
              status: 'failed',
              lastOutput: 'Acceptance hints: missing expected changed files',
            }),
            createdAt: 4,
          },
        ],
      }) as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );

    await expect(runtime.getGraphDurable(runId)).resolves.toMatchObject({
      runId,
      childAgents: [expect.objectContaining({
        id: 'cli-child-snapshot',
        parentNodeId: 'orchestrator',
        parentRoleSlotId: 'orchestrator',
        backend: 'gemini',
        status: 'failed',
        updatedAt: 4,
      })],
    });
  });

  it('marks a persisted fan-out node completed when all outgoing branch nodes completed', async () => {
    const runId = 'persisted-run-2';
    const toolCalls = ['pragmatist', 'innovator', 'analyst', 'user-advocate', 'devil-advocate'].map((nodeId, index) => ({
      id: `architecture:${runId}:${runId}:event:${index + 3}`,
      name: 'run_subagent',
      args: {
        architectureRunId: runId,
        nodeId,
        roleSlotId: nodeId.replace(/-/g, '_'),
        childSessionId: `arch-${runId}-${nodeId}`,
      },
    }));
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions({
        messages: [
          {
            id: `architecture:${runId}:user`,
            sessionId: 'parent-session',
            role: 'user',
            content: '[Architecture: Five Minds Council]\nReview the release workflow.',
            createdAt: 1,
          },
          {
            id: `architecture:${runId}:tool-calls`,
            sessionId: 'parent-session',
            role: 'assistant',
            content: '',
            toolCalls,
            createdAt: 2,
          },
        ],
      }) as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );

    const graph = await runtime.getGraphDurable(runId);

    expect(graph?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'five-minds-debate', status: 'completed' }),
    ]));
  });

  it('reconstructs durable graph from only the requested architecture run messages', async () => {
    const targetRunId = 'persisted-target-run';
    const siblingRunId = 'persisted-sibling-run';
    const messages: ChatMessage[] = [
      {
        id: `architecture:${siblingRunId}:user`,
        sessionId: 'parent-session',
        role: 'user',
        content: '[Architecture: Strategic Decision Council]\nSibling run.',
        createdAt: 1,
      },
      {
        id: `architecture:${siblingRunId}:text:${siblingRunId}:event:8`,
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Router\n\nRoute: router -> final-artifact\n\nSibling router output.',
        createdAt: 2,
      },
      {
        id: `architecture:${siblingRunId}:text:${siblingRunId}:event:9`,
        sessionId: 'parent-session',
        role: 'assistant',
        content: '### Finalizer\n\nSibling finalizer output.',
        createdAt: 3,
      },
      {
        id: `architecture:${targetRunId}:user`,
        sessionId: 'parent-session',
        role: 'user',
        content: '[Architecture: Five Minds Council]\nTarget run.',
        createdAt: 4,
      },
      {
        id: `architecture:${targetRunId}:tool-calls`,
        sessionId: 'parent-session',
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: `architecture:${targetRunId}:${targetRunId}:event:3`,
            name: 'run_subagent',
            args: {
              architectureRunId: targetRunId,
              nodeId: 'pragmatist',
              roleSlotId: 'pragmatist',
              childSessionId: `arch-${targetRunId}-pragmatist`,
            },
          },
        ],
        createdAt: 5,
      },
    ];
    const runtime = new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      createSessions({ messages }) as unknown as SessionsService,
      { persistMessage: async () => undefined } as never,
      createRoleExecutor(),
    );

    const graph = await runtime.getGraphDurable(targetRunId);

    expect(graph?.nodes.find((node) => node.id === 'pragmatist')).toMatchObject({ status: 'completed' });
    expect(graph?.nodes.find((node) => node.id === 'synthesizer')).toMatchObject({ status: 'completed' });
    expect(graph?.nodes.find((node) => node.id === 'final-artifact')).toMatchObject({ status: 'pending' });
    const routeHops = graph?.routeHops ?? [];
    expect(routeHops).toEqual([
      expect.objectContaining({ fromNodeId: 'pragmatist', toNodeId: 'synthesizer' }),
    ]);
    expect(routeHops.some((hop) => hop.eventId.includes(siblingRunId))).toBe(false);
  });
});

async function createTempRegistryService(tempDirs: Set<string>): Promise<ArchitectureRegistryService> {
  const registryPath = await mkdtemp(join(tmpdir(), 'kalio-architecture-controller-'));
  tempDirs.add(registryPath);
  return new ArchitectureRegistryService({
    get: (key: string, defaultValue?: string) => (key === 'ARCHITECTURE_REGISTRY_PATH' ? registryPath : defaultValue),
  } as ConfigService);
}

function createSessions(options: { messages?: ChatMessage[]; sessions?: ChatSession[] } = {}): {
  createWithId: (id: string, dto: CreateSessionDto) => Promise<ChatSession>;
  list: () => Promise<ChatSession[]>;
  getMessages: (sessionId: string) => Promise<ChatMessage[]>;
} {
  return {
    createWithId: async (id, dto) => ({
      id,
      personaId: dto.personaId,
      title: dto.title ?? 'New Chat',
      kind: dto.kind ?? 'chat',
      parentSessionId: dto.parentSessionId,
      parentTurnId: dto.parentTurnId,
      parentToolCallId: dto.parentToolCallId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
    list: async () => options.sessions ?? [{
      id: 'parent-session',
      personaId: 'default',
      title: 'Parent',
      kind: 'chat',
      createdAt: 1,
      updatedAt: 3,
    }],
    getMessages: async () => options.messages ?? [],
  };
}

function createRoleExecutor(): ArchitectureRoleExecutor {
  return {
    execute: async ({ branchSessionId, personaId, run, slot }) => ({
      message: `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      },
    }),
  };
}
