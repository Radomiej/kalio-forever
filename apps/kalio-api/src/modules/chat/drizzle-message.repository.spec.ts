import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@kalio/types';
import { DrizzleMessageRepository } from './drizzle-message.repository';

describe('DrizzleMessageRepository', () => {
  let repository: DrizzleMessageRepository;
  let selectSessionResult: ReturnType<typeof vi.fn>;
  let selectMessagesResult: ReturnType<typeof vi.fn>;
  let insertValues: ReturnType<typeof vi.fn>;

  function createSessionQueryMock() {
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          then: selectSessionResult,
        }),
      }),
    };
  }

  function createMessagesQueryMock() {
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: selectMessagesResult,
        }),
      }),
    };
  }

  beforeEach(() => {
    selectSessionResult = vi.fn();
    selectMessagesResult = vi.fn();
    insertValues = vi.fn().mockResolvedValue(undefined);

    const db = {
      select: vi.fn((selection?: unknown) => {
        if (selection) {
          return createSessionQueryMock();
        }

        return createMessagesQueryMock();
      }),
      insert: vi.fn().mockReturnValue({
        values: insertValues,
      }),
    };

    repository = new DrizzleMessageRepository({ db } as never);
  });

  it('throws a SESSION_NOT_FOUND error when ensureSession cannot find the session', async () => {
    selectSessionResult.mockResolvedValue(undefined);

    await expect(repository.ensureSession('session-1', 'persona-1')).rejects.toMatchObject({
      message: expect.stringContaining('session-1'),
      code: 'SESSION_NOT_FOUND',
    });
  });

  it('maps stored rows to chat messages and persists new messages', async () => {
    selectSessionResult.mockResolvedValue({ id: 'session-1' });
    selectMessagesResult.mockResolvedValue([
      {
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'hello',
        thinking: null,
        toolCalls: [{ id: 'tool-1' }],
        toolCallId: 'tool-call-1',
        attachments: [{ id: 'file-1' }],
        createdAt: new Date(1_700_000_000_000),
      },
    ]);

    await expect(repository.ensureSession('session-1', 'persona-1')).resolves.toBeUndefined();
    await expect(repository.loadHistory('session-1')).resolves.toEqual([
      {
        id: 'msg-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'hello',
        thinking: undefined,
        toolCalls: [{ id: 'tool-1' }],
        toolCallId: 'tool-call-1',
        attachments: [{ id: 'file-1' }],
        createdAt: 1_700_000_000_000,
      },
    ]);

    const message: ChatMessage = {
      id: 'msg-2',
      sessionId: 'session-1',
      role: 'user',
      content: 'hi',
      createdAt: 1_700_000_000_100,
    };

    await expect(repository.saveMessage(message)).resolves.toBeUndefined();
    expect(insertValues).toHaveBeenCalledWith({
      id: 'msg-2',
      sessionId: 'session-1',
      role: 'user',
      content: 'hi',
      thinking: null,
      toolCalls: null,
      toolCallId: null,
      attachments: null,
      createdAt: new Date(1_700_000_000_100),
    });
  });
});
