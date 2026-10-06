import { describe, expect, it } from 'vitest';
import type { ChatMessage, ChatSession, Persona } from '@kalio/types';
import type { ToolActivity } from '../../../store/agentStore';
import type { AgentTurn } from '../../../store/sessionStore';
import {
  buildToolSnapshots,
  buildCopiedFileArtifact,
  buildTurnIdentity,
  extractArtifactFromData,
  extractCLIAgentSessionResult,
  extractSubagentContextPrompt,
  getFinalAnswerMessage,
  getTurnStatus,
  statusFromActivity,
  statusFromRuntimeChildExecution,
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

  it('does not trust an unknown persisted CLI lifecycle value', () => {
    expect(extractCLIAgentSessionResult({
      childSessionId: 'cli-child-legacy',
      agentId: 'codex',
      status: 'looks_done',
    })).toMatchObject({ status: 'idle' });
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

  it('does not present a persona recommendation as the actual explicitly selected runtime model', () => {
    const turn = makeTurn({ done: true });
    const session = {
      id: turn.sessionId,
      personaId: 'devin-persona',
      executionProfileId: 'explicit-swe-2-profile',
      title: 'HomeSite',
      createdAt: 1,
      updatedAt: 1,
    } satisfies ChatSession;
    const persona = { id: session.personaId, name: 'Devin SWE-2 QA', model: 'swe-2-medium' } as Persona;

    const identity = buildTurnIdentity(turn, new Map([[session.id, session]]), new Map([[persona.id, persona]]));

    expect(identity.actorLabel).toBe('Devin SWE-2 QA');
    expect(identity.modelLabel).not.toBe('swe-2-medium');
    expect(identity.subtitle).not.toContain('swe-2-medium');
  });

  it('uses recorded turn model rather than a changed persona recommendation', () => {
    const turn = makeTurn({ done: true });
    const session = { id: turn.sessionId, personaId: 'devin-persona', title: 'HomeSite', createdAt: 1, updatedAt: 2 } satisfies ChatSession;
    const persona = { id: session.personaId, name: 'Devin SWE-2 QA', model: 'changed-model' } as Persona;
    expect(buildTurnIdentity(turn, new Map([[session.id, session]]), new Map([[persona.id, persona]]), 'swe-2')).toMatchObject({
      modelLabel: 'swe-2', subtitle: 'Devin SWE-2 QA - swe-2', detail: 'Turn completed',
    });
  });

  it('distinguishes cancelled tools from expired tool errors', () => {
    const cancelled = { status: 'cancelled' } as ToolActivity;
    const expired = { status: 'expired' } as ToolActivity;

    expect(statusFromActivity(cancelled, false)).toBe('cancelled');
    expect(statusFromActivity(expired, false)).toBe('error');
  });

  it('restores success from a raw persisted result', () => {
    expect(statusFromActivity(null, true, { output: 'unclassified' })).toBe('success');
  });

  it.each([
    [{ output: 'saved' }, 'success'],
    [{ status: 'error', error: 'failed' }, 'error'],
    [{ status: 'cancelled', error: 'denied' }, 'cancelled'],
    [null, 'success'],
  ] as const)('hydrates generic result %j without transient activities', (result, expected) => {
    const messages: ChatMessage[] = [
      { id: 'a', sessionId: 'session-1', role: 'assistant', content: '', createdAt: 1,
        turnId: 'turn-1', promptMessageId: 'prompt-1', toolCalls: [{ id: 'call', name: 'fs_write', args: {} }] },
      { id: 'r', sessionId: 'session-1', role: 'tool_result', content: JSON.stringify(result), createdAt: 2,
        turnId: 'turn-1', promptMessageId: 'prompt-1', toolCallId: 'call' },
    ];
    const snapshots = buildToolSnapshots(messages, []);
    const snapshot = snapshots.get('call')!;
    expect(statusFromActivity(snapshot.activity, snapshot.result != null, snapshot.result, snapshot.toolName)).toBe(expected);
    expect(getTurnStatus(makeTurn({ done: true, items: [{ kind: 'tool', callId: 'call' }] }), snapshots)).toBe(expected === 'cancelled' ? 'success' : expected);
    expect(statusFromActivity(null, false)).toBe('idle');
  });

  it('keeps waiting child executions distinct from active running work', () => {
    expect(statusFromRuntimeChildExecution('waiting')).toBe('waiting');
  });

  it('keeps awaiting-confirmation tools distinct from active running work', () => {
    const awaitingConfirmation = { status: 'awaiting_confirmation' } as ToolActivity;

    expect(statusFromActivity(awaitingConfirmation, false)).toBe('waiting');
  });

  it('marks a completed turn as waiting when a tool still needs human confirmation', () => {
    const turn = makeTurn({
      done: true,
      items: [{ kind: 'tool', callId: 'call-delete-1' }],
    });
    const toolSnapshots = new Map([[
      'call-delete-1',
      {
        callId: 'call-delete-1',
        toolName: 'vfs_delete',
        args: { path: 'draft.txt' },
        activity: { status: 'awaiting_confirmation' } as ToolActivity,
        result: null,
      },
    ]]);

    expect(getTurnStatus(turn, toolSnapshots)).toBe('waiting');
  });

  it('normalizes stale running CLI activities to terminal success when the snapshot is completed', () => {
    const snapshots = buildToolSnapshots(
      [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex' } }],
          createdAt: 1,
        },
        {
          id: 'tool-1',
          sessionId: 'session-1',
          role: 'tool_result',
          toolCallId: 'call-cli-1',
          content: JSON.stringify({
            childSessionId: 'cli-child-1',
            agentId: 'codex',
            status: 'completed',
            lastOutput: 'done',
          }),
          createdAt: 2,
        },
      ],
      [{
        callId: 'call-cli-1',
        toolName: 'spawn_cli_agent',
        args: { agentId: 'codex' },
        sessionId: 'session-1',
        status: 'running',
        startedAt: 1,
      }],
    );

    const cliSnapshot = snapshots.get('call-cli-1');
    expect(statusFromActivity(
      cliSnapshot?.activity ?? null,
      cliSnapshot?.result != null,
      cliSnapshot?.result,
      cliSnapshot?.toolName,
    )).toBe('success');
  });

  it('keeps a completed turn running while a delegated CLI child snapshot is still running', () => {
    const turn = makeTurn({
      done: true,
      items: [{ kind: 'tool', callId: 'call-cli-1' }],
    });
    const snapshots = buildToolSnapshots(
      [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex' } }],
          createdAt: 1,
        },
        {
          id: 'tool-1',
          sessionId: 'session-1',
          role: 'tool_result',
          toolCallId: 'call-cli-1',
          content: JSON.stringify({
            childSessionId: 'cli-child-1',
            agentId: 'codex',
            status: 'running',
            lastOutput: 'still working',
            updatedAt: 2,
          }),
          createdAt: 2,
        },
      ],
      [],
    );

    expect(getTurnStatus(turn, snapshots)).toBe('running');
  });

  it('keeps a completed turn failed when a delegated CLI child snapshot is failed after reload', () => {
    const turn = makeTurn({
      done: true,
      items: [{ kind: 'tool', callId: 'call-cli-1' }],
    });
    const snapshots = buildToolSnapshots(
      [
        {
          id: 'assistant-1',
          sessionId: 'session-1',
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-cli-1', name: 'spawn_cli_agent', args: { agentId: 'codex' } }],
          createdAt: 1,
        },
        {
          id: 'tool-1',
          sessionId: 'session-1',
          role: 'tool_result',
          toolCallId: 'call-cli-1',
          content: JSON.stringify({
            childSessionId: 'cli-child-1',
            agentId: 'codex',
            status: 'failed',
            lastOutput: 'Authentication required.',
            updatedAt: 2,
          }),
          createdAt: 2,
        },
      ],
      [],
    );

    expect(getTurnStatus(turn, snapshots)).toBe('error');
  });

  it('ignores malformed final-answer content instead of crashing graph projection', () => {
    const turn = makeTurn({
      done: true,
      items: [
        { kind: 'text', messageId: 'bad-final' },
        { kind: 'text', messageId: 'good-final' },
      ],
    });
    const messages = new Map<string, ChatMessage>([
      ['bad-final', {
        id: 'bad-final',
        sessionId: 'session-1',
        role: 'assistant',
        content: undefined as unknown as string,
        createdAt: 1,
      }],
      ['good-final', {
        id: 'good-final',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'Final answer from typed turn.',
        createdAt: 2,
      }],
    ]);

    expect(() => getFinalAnswerMessage(turn, messages)).not.toThrow();
    expect(getFinalAnswerMessage(turn, messages)?.id).toBe('good-final');
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

  it('builds copied file artifact fallbacks when copied-file target path is missing', () => {
    expect(buildCopiedFileArtifact({
      fromPath: 'wireframe.svg',
      sizeBytes: 128,
    } as never)).toMatchObject({
      id: 'artifact:wireframe.svg',
      kind: 'file',
      label: 'wireframe.svg',
      subtitle: 'wireframe.svg',
      preview: '128 bytes copied',
    });
  });
});
