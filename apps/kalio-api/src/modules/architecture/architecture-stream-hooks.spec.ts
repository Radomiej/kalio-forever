import { describe, expect, it } from 'vitest';
import { createArchitectureBranchStreamHook } from './architecture-stream-hooks';

describe('architecture stream hooks', () => {
  it('collects independent branch streams while forwarding events to the parent emitter', () => {
    const forwarded: Array<{ event: string; sessionId?: string; delta?: string }> = [];
    const analyst = createArchitectureBranchStreamHook({
      runId: 'run-1',
      nodeId: 'analyst',
      roleSlotId: 'analyst',
      branchSessionId: 'branch-analyst',
      personaId: 'persona.analyst',
      parentEmit: (event, data) => {
        const payload: Record<string, unknown> = isRecord(data) ? data : {};
        forwarded.push({
          event,
          sessionId: typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined,
          delta: typeof payload['delta'] === 'string' ? payload['delta'] : undefined,
        });
      },
    });
    const shadow = createArchitectureBranchStreamHook({
      runId: 'run-1',
      nodeId: 'shadow',
      roleSlotId: 'shadow',
      branchSessionId: 'branch-shadow',
      personaId: 'persona.shadow',
      parentEmit: (event, data) => {
        const payload: Record<string, unknown> = isRecord(data) ? data : {};
        forwarded.push({
          event,
          sessionId: typeof payload['sessionId'] === 'string' ? payload['sessionId'] : undefined,
          delta: typeof payload['delta'] === 'string' ? payload['delta'] : undefined,
        });
      },
    });

    analyst.emit('chat:chunk', {
      sessionId: 'branch-analyst',
      messageId: 'message-analyst',
      delta: 'Cost ',
      done: false,
    });
    shadow.emit('chat:chunk', {
      sessionId: 'branch-shadow',
      messageId: 'message-shadow',
      delta: 'Risk ',
      done: false,
    });
    analyst.emit('chat:chunk', {
      sessionId: 'branch-analyst',
      messageId: 'message-analyst',
      delta: 'view',
      done: false,
    });
    shadow.emit('chat:complete', {
      sessionId: 'branch-shadow',
      messageId: 'message-shadow',
    });
    analyst.emit('chat:complete', {
      sessionId: 'branch-analyst',
      messageId: 'message-analyst',
    });

    expect(analyst.snapshot()).toMatchObject({
      streamGroupId: 'architecture:run-1:analyst',
      status: 'completed',
      chunkCount: 2,
      text: 'Cost view',
    });
    expect(shadow.snapshot()).toMatchObject({
      streamGroupId: 'architecture:run-1:shadow',
      status: 'completed',
      chunkCount: 1,
      text: 'Risk ',
    });
    expect(forwarded).toEqual([
      { event: 'chat:chunk', sessionId: 'branch-analyst', delta: 'Cost ' },
      { event: 'chat:chunk', sessionId: 'branch-shadow', delta: 'Risk ' },
      { event: 'chat:chunk', sessionId: 'branch-analyst', delta: 'view' },
      { event: 'chat:complete', sessionId: 'branch-shadow', delta: undefined },
      { event: 'chat:complete', sessionId: 'branch-analyst', delta: undefined },
    ]);
  });

  it('marks a branch as failed when the wrapped chat stream errors', () => {
    const hook = createArchitectureBranchStreamHook({
      runId: 'run-1',
      nodeId: 'validator',
      roleSlotId: 'validator',
      branchSessionId: 'branch-validator',
      personaId: 'persona.validator',
    });

    hook.emit('chat:chunk', {
      sessionId: 'branch-validator',
      messageId: 'message-validator',
      delta: 'partial',
      done: false,
    });
    hook.emit('chat:error', {
      sessionId: 'branch-validator',
      code: 'LLM_ERROR',
      message: 'provider failed',
      hadContent: true,
    });

    expect(hook.snapshot()).toMatchObject({
      status: 'failed',
      chunkCount: 1,
      text: 'partial',
    });
  });

  it('keeps CLI child session identity from tool args when a message attempt fails', () => {
    const hook = createArchitectureBranchStreamHook({
      runId: 'run-1',
      nodeId: 'orchestrator',
      roleSlotId: 'orchestrator',
      branchSessionId: 'branch-orchestrator',
      personaId: 'orchestrator',
    });

    hook.emit('tool:start', {
      sessionId: 'branch-orchestrator',
      callId: 'call-message-cli',
      toolName: 'message_cli_agent',
      args: {
        childSessionId: 'cli-child-full-id',
        prompt: 'continue',
      },
    });
    hook.emit('tool:result', {
      sessionId: 'branch-orchestrator',
      callId: 'call-message-cli',
      toolName: 'message_cli_agent',
      status: 'error',
      data: {
        id: 'call-message-cli',
        status: 'failed',
        error: 'child is already running',
      },
    });

    expect(hook.snapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'tool:start',
        toolName: 'message_cli_agent',
        childSessionId: 'cli-child-full-id',
      }),
      expect.objectContaining({
        event: 'tool:result',
        toolName: 'message_cli_agent',
        childSessionId: 'cli-child-full-id',
        status: 'error',
        childStatus: 'failed',
      }),
    ]));
  });

  it('captures terminal cwd as a tool evidence path', () => {
    const hook = createArchitectureBranchStreamHook({
      runId: 'run-1',
      nodeId: 'tester',
      roleSlotId: 'tester',
      branchSessionId: 'branch-tester',
      personaId: 'tester',
    });

    hook.emit('tool:start', {
      sessionId: 'branch-tester',
      callId: 'call-build',
      toolName: 'terminal_spawn',
      args: {
        command: 'npm.cmd',
        args: ['run', 'build'],
        cwd: 'C:\\Projekty\\TurboProject2',
      },
    });

    expect(hook.snapshot().events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: 'tool:start',
        toolName: 'terminal_spawn',
        toolPath: 'C:\\Projekty\\TurboProject2',
      }),
    ]));
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
