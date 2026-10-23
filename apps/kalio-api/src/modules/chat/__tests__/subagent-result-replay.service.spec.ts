import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatRunSnapshot, SocketEvents } from '@kalio/types';
import type { SubagentEmit, RunSubagentRequest } from '../../tool/subagent-runtime.port';
import type { IMessageRepository } from '../interfaces/message-repository.interface';
import type { RunJournalService } from '../run-journal.service';
import { SubagentResultReplayService } from '../subagent-result-replay.service';

describe('SubagentResultReplayService', () => {
  it('replays completed child tool evidence from the exact persisted turn', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'call-message',
        sessionId: 'child-session',
        turnId: 'child-turn',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'write-call', name: 'vfs_write', args: { path: 'proof.json', content: '{}' } }],
        createdAt: 1,
      },
      {
        id: 'result-message',
        sessionId: 'child-session',
        turnId: 'child-turn',
        role: 'tool_result',
        content: JSON.stringify({ path: 'proof.json', bytesWritten: 2 }),
        toolCallId: 'write-call',
        createdAt: 2,
      },
      {
        id: 'final-message',
        sessionId: 'child-session',
        turnId: 'child-turn',
        role: 'assistant',
        content: 'Wrote proof.json.',
        createdAt: 3,
      },
      {
        id: 'other-turn-message',
        sessionId: 'child-session',
        turnId: 'other-turn',
        role: 'assistant',
        content: 'Not part of this replay.',
        toolCalls: [{ id: 'other-call', name: 'vfs_write', args: { path: 'other.json', content: '{}' } }],
        createdAt: 4,
      },
    ];
    const runs = {
      getCompletedTurn: vi.fn().mockResolvedValue({
        outcome: { finalText: 'Wrote proof.json.' },
      } as ChatRunSnapshot),
    } as unknown as RunJournalService;
    const repository = {
      loadMessagesForTurn: vi.fn(async (sessionId: string, turnId: string) =>
        messages.filter((message) => message.sessionId === sessionId && message.turnId === turnId)),
    } as unknown as IMessageRepository;
    const emitted: Array<{ event: keyof SocketEvents; data: unknown }> = [];
    const emit: SubagentEmit = (event, data) => emitted.push({ event, data });
    const request: RunSubagentRequest = {
      parentSessionId: 'parent-session',
      parentToolCallId: 'architecture:run-1:implementer',
      objective: 'Write proof.json.',
      childSessionId: 'child-session',
      resumeTurnId: 'child-turn',
      timeoutMs: 10_000,
      vfsMode: 'shared',
      copyOutputs: false,
      emit,
    };
    const service = new SubagentResultReplayService(runs, repository);

    const result = await service.replay(request, 'child-session', 'child-session', 20);

    expect(result).toMatchObject({ status: 'completed', result: 'Wrote proof.json.' });
    expect(repository.loadMessagesForTurn).toHaveBeenCalledWith('child-session', 'child-turn');
    expect(emitted).toEqual([
      {
        event: 'tool:start',
        data: {
          callId: 'write-call',
          toolName: 'vfs_write',
          args: { path: 'proof.json', content: '{}' },
          sessionId: 'child-session',
          turnId: 'child-turn',
        },
      },
      {
        event: 'tool:result',
        data: {
          callId: 'write-call',
          toolName: 'vfs_write',
          sessionId: 'child-session',
          status: 'success',
          data: { path: 'proof.json', bytesWritten: 2 },
        },
      },
    ]);
  });
});
