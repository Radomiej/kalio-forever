import type { AgentFlowContinuationCursor, ChatSession, CLIAgentConfig, CreateSessionDto } from '@kalio/types';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectureRegistryService } from './architecture-registry.service';
import { ArchitectureRuntimeService } from './architecture-runtime.service';
import type { ArchitectureRoleExecutor } from './architecture-role-executor';
import type { SessionManagerService } from '../chat/session-manager.service';
import type { SessionsService } from '../chat/sessions.service';

describe('ArchitectureRuntimeService context defaults and resume behavior', () => {
  it('injects trimmed CLI agent preferences into the run context when none are provided', async () => {
    const { service } = createService({
      copilot: { model: '  gpt-4o-mini  ', architecturePreference: '  fast  ' },
      codex: { model: '', architecturePreference: '  review  ' },
      gemini: { model: '   ', architecturePreference: '   ' },
    });

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Prepare the run with CLI defaults.',
      context: {
        priority: 'ship',
      },
    });

    expect(run.context).toMatchObject({
      priority: 'ship',
      cliAgentToolPreferences: {
        copilot: {
          model: 'gpt-4o-mini',
          preference: 'fast',
        },
        codex: {
          preference: 'review',
        },
      },
    });
    expect(Object.keys((run.context?.cliAgentToolPreferences as Record<string, unknown>) ?? {})).toEqual([
      'copilot',
      'codex',
    ]);
  });

  it('preserves existing resume context while merging new context and max steps', async () => {
    const { service } = createService();
    const continuation: AgentFlowContinuationCursor = {
      reason: 'max_steps',
      pendingNodeIds: ['router-1'],
      visitCounts: { 'agent-1': 1, 'router-1': 1 },
      lastCompletedNodeId: 'agent-1',
      message: 'Runtime stopped after one pass.',
    };

    const run = await service.createRun({
      schemaId: 'strategic-decision-council',
      prompt: 'Start with the base prompt.',
      context: {
        existing: 'keep',
      },
    });

    const resumed = await service.resumeRun(run.id, {
      input: 'Please continue with the next pass.',
      context: {
        resumed: true,
      },
      maxSteps: 7,
      continuation,
    });

    expect(resumed.prompt).toContain('Start with the base prompt.');
    expect(resumed.prompt).toContain('Resume input: Please continue with the next pass.');
    expect(resumed.context).toMatchObject({
      existing: 'keep',
      resumed: true,
      maxArchitectureSteps: 7,
    });
  });
});

function createService(cliConfigs?: Record<string, Partial<CLIAgentConfig>>): {
  service: ArchitectureRuntimeService;
  executor: ArchitectureRoleExecutor;
  sessions: Pick<SessionsService, 'createWithId' | 'getMessages'> & {
    createWithId: ReturnType<typeof vi.fn>;
    getMessages: ReturnType<typeof vi.fn>;
  };
  sessionManager: Pick<SessionManagerService, 'persistMessage'> & {
    persistMessage: ReturnType<typeof vi.fn>;
  };
} {
  const created: Array<{ id: string; dto: CreateSessionDto }> = [];
  const sessions = {
    created,
    createWithId: vi.fn(async (id: string, dto: CreateSessionDto): Promise<ChatSession> => {
      created.push({ id, dto });
      const now = Date.now();
      return {
        id,
        personaId: dto.personaId,
        title: dto.title ?? 'New Chat',
        kind: dto.kind ?? 'chat',
        parentSessionId: dto.parentSessionId,
        parentTurnId: dto.parentTurnId,
        parentToolCallId: dto.parentToolCallId,
        createdAt: now,
        updatedAt: now,
      };
    }),
    getMessages: vi.fn().mockResolvedValue([]),
  };
  const executor: ArchitectureRoleExecutor = {
    execute: vi.fn(async ({ branchSessionId, personaId, run, slot }) => ({
      message: `${slot.label} branch prepared for: ${run.prompt}`,
      data: {
        branchSessionId,
        personaId,
        sessionPersonaId: personaId,
        rootSessionId: run.rootSessionId,
        slotType: slot.slotType,
        executionMode: run.executionMode,
      },
    })),
  };
  const sessionManager = {
    persistMessage: vi.fn().mockResolvedValue(undefined),
  };
  const cliAgentConfig = cliConfigs
    ? {
        getConfig: vi.fn(async (agentId: string): Promise<CLIAgentConfig> => ({
          enabled: true,
          cliPath: '',
          timeoutMs: 900_000,
          maxOutputChars: 16_000,
          model: '',
          architecturePreference: '',
          extraArgs: [],
          ...(cliConfigs[agentId] ?? {}),
        })),
      }
    : undefined;

  return {
    service: new ArchitectureRuntimeService(
      new ArchitectureRegistryService(),
      sessions as unknown as SessionsService,
      sessionManager as unknown as SessionManagerService,
      executor,
      undefined,
      undefined,
      cliAgentConfig,
    ),
    executor,
    sessions,
    sessionManager,
  };
}
