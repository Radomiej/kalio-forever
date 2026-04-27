import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DoneHandler } from '../handlers/done.handler';
import { TurnState } from '../turn-state';
import type { StreamContext } from '../interfaces/stream-context.interface';
import type { SessionManagerService } from '../session-manager.service';

function makeCtx(state?: TurnState): StreamContext & { emit: ReturnType<typeof vi.fn> } {
  const emit = vi.fn();
  return {
    sessionId: 'sid-04',
    messageId: 'mid-04',
    abortSignal: new AbortController().signal,
    state: state ?? new TurnState(),
    emit,
  };
}

function makeSessionManager(): Partial<SessionManagerService> {
  return {
    persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
  };
}

describe('DoneHandler', () => {
  let handler: DoneHandler;
  let sessionManager: ReturnType<typeof makeSessionManager>;

  beforeEach(() => {
    sessionManager = makeSessionManager();
    handler = new DoneHandler(sessionManager as SessionManagerService);
  });

  it('has chunkType "done"', () => {
    expect(handler.chunkType).toBe('done');
  });

  it('calls persistAssistantMessage with correct params', async () => {
    const state = new TurnState();
    state.appendText('Final answer');
    const ctx = makeCtx(state);

    await handler.handle({ type: 'done' }, ctx);

    expect(sessionManager.persistAssistantMessage).toHaveBeenCalledWith(
      'sid-04',
      'mid-04',
      state,
    );
  });

  it('does NOT emit chat:complete (ChatService owns lifecycle event)', async () => {
    const ctx = makeCtx();
    await handler.handle({ type: 'done' }, ctx);
    expect(ctx.emit).not.toHaveBeenCalled();
  });
});
