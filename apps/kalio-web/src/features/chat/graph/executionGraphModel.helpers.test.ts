import { describe, expect, it } from 'vitest';
import type { ChatSession, Persona } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';
import {
  buildCopiedFileArtifact,
  buildTurnIdentity,
  extractArtifactFromData,
  extractCLIAgentSessionResult,
  extractSubagentContextPrompt,
  statusFromActivity,
} from './executionGraphModel.helpers';

function makeTurn(overrides: Partial<AgentTurn> = {}): AgentTurn {
  return {
    id: 'turn-1',
    sessionId: 'session-1',
    promptMessageId: 'prompt-1',
    done: false,
    items: [],
    ...overrides,
  } as AgentTurn;
}

describe('executionGraphModel.helpers', () => {
  it('picks the first usable subagent prompt and trims whitespace', () => {
    expect(extractSubagentContextPrompt({
      prompt: '   ',
      task: '  Review the execution graph  ',
      message: 'Ignored',
    })).toBe('Review the execution graph');
  });

  it('normalizes CLI child snapshots that only provide exit codes and generic output fields', () => {
    expect(extractCLIAgentSessionResult({
      childSessionId: 'cli-child-1',
      agentId: 'codex',
      parentSessionId: 'session-1',
      workdir: 'C:/workspace/project',
      exitCode: 0,
      output: 'kalio-forever',
      updatedAt: 9,
      startedAt: 8,
      completedAt: 9,
    })).toMatchObject({
      childSessionId: 'cli-child-1',
      agentId: 'codex',
      status: 'completed',
      lastOutput: 'kalio-forever',
      lastExitCode: 0,
    });
  });

  it('extracts file artifacts from raw tool payloads and keeps the preview text', () => {
    expect(extractArtifactFromData('call-1', {
      path: 'sub-agents/child-session-1/wireframe.txt',
      message: '128 bytes copied',
    })).toMatchObject({
      id: 'artifact:sub-agents/child-session-1/wireframe.txt',
      kind: 'file',
      label: 'wireframe.txt',
      subtitle: 'sub-agents/child-session-1/wireframe.txt',
      path: 'sub-agents/child-session-1/wireframe.txt',
      preview: '128 bytes copied',
    });
  });

  it('extracts image artifacts from raw tool payloads', () => {
    expect(extractArtifactFromData('call-2', {
      path: 'generated/preview.png',
      message: 'Image generated',
    })).toMatchObject({
      id: 'artifact:generated/preview.png',
      kind: 'image',
      label: 'preview.png',
      subtitle: 'generated/preview.png',
      path: 'generated/preview.png',
      preview: 'Image generated',
    });
  });

  it('falls back to the turn state when no persona or agent label is known', () => {
    const turn = makeTurn();
    const sessionById = new Map<string, ChatSession>();
    const personaById = new Map<string, Persona>();

    expect(buildTurnIdentity(turn, sessionById, personaById)).toEqual({
      subtitle: 'Turn in progress',
      actorLabel: null,
      modelLabel: null,
    });
  });

  it('marks cancelled and expired tool states as errors', () => {
    const cancelled = { status: 'cancelled' } as ToolActivity;
    const expired = { status: 'expired' } as ToolActivity;

    expect(statusFromActivity(cancelled, false)).toBe('error');
    expect(statusFromActivity(expired, false)).toBe('error');
  });

  it('builds copied file artifacts with readable labels and byte previews', () => {
    expect(buildCopiedFileArtifact({
      fromPath: 'wireframe.svg',
      toPath: 'sub-agents/child-session-1/wireframe.svg',
      sizeBytes: 128,
    })).toMatchObject({
      id: 'artifact:sub-agents/child-session-1/wireframe.svg',
      kind: 'file',
      label: 'wireframe.svg',
      subtitle: 'sub-agents/child-session-1/wireframe.svg',
      path: 'sub-agents/child-session-1/wireframe.svg',
      preview: '128 bytes copied',
    });
  });
});
