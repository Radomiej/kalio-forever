import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSession } from '@kalio/types';
import type { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import type { CLIAgentService } from './cli-agent.service';
import type { CLIAgentSessionService } from './cli-agent-session.service';
import { CLIAgentSessionRuntimeService } from './cli-agent-session-runtime.service';

function makeChildSession(): ChatSession {
  return {
    id: 'cli-child-1',
    personaId: 'default',
    title: 'Codex CLI',
    kind: 'cli-agent',
    parentSessionId: 'sess-parent',
    parentToolCallId: 'call-cli-tools',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('CLIAgentSessionRuntimeService', () => {
  let cliAgent: CLIAgentService;
  let sessions: CLIAgentSessionService;
  let allowedPaths: AllowedPathsService;

  beforeEach(() => {
    cliAgent = {
      isRunning: vi.fn().mockReturnValue(false),
      run: vi.fn(),
      stop: vi.fn(),
    } as unknown as CLIAgentService;

    sessions = {
      getChildSession: vi.fn().mockResolvedValue(makeChildSession()),
      loadSessionMetadata: vi.fn().mockResolvedValue({ agentId: 'codex', workdir: 'C:/repo' }),
      listMessages: vi.fn().mockResolvedValue([]),
      persistUserMessage: vi.fn(),
      persistAssistantToolCallMessage: vi.fn(),
      saveToolResult: vi.fn(),
      createChildSession: vi.fn(),
      saveSessionMetadata: vi.fn(),
      loadLatestToolResult: vi.fn(),
    } as unknown as CLIAgentSessionService;

    allowedPaths = {
      isAllowed: vi.fn().mockResolvedValue(false),
    } as unknown as AllowedPathsService;
  });

  it('rejects continueSession when the stored workdir is no longer allowed', async () => {
    const service = new CLIAgentSessionRuntimeService(cliAgent, sessions, allowedPaths);

    await expect(service.continueSession({
      parentSessionId: 'sess-parent',
      childSessionId: 'cli-child-1',
      prompt: 'Continue with tests',
    })).rejects.toThrow('ACCESS_DENIED');

    expect(allowedPaths.isAllowed).toHaveBeenCalledWith('C:/repo');
    expect(cliAgent.run).not.toHaveBeenCalled();
    expect(sessions.listMessages).not.toHaveBeenCalled();
  });
});