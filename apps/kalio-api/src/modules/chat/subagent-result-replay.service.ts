import { Inject, Injectable } from '@nestjs/common';
import type { ChatMessage, ChatRunSnapshot, ToolResult } from '@kalio/types';
import type { RunSubagentRequest, RunSubagentResult } from '../tool/subagent-runtime.port';
import { MESSAGE_REPOSITORY } from './chat.tokens';
import type { IMessageRepository } from './interfaces/message-repository.interface';
import { RunJournalService } from './run-journal.service';

@Injectable()
export class SubagentResultReplayService {
  constructor(
    private readonly runs: RunJournalService,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: IMessageRepository,
  ) {}

  async findCompleted(childSessionId: string, turnId: string): Promise<ChatRunSnapshot['outcome'] | null> {
    const run = await this.runs.getCompletedTurn(childSessionId, turnId);
    return run?.outcome?.finalText ? run.outcome : null;
  }

  async replay(
    request: RunSubagentRequest,
    childSessionId: string,
    vfsSessionId: string,
    durationMs: number,
  ): Promise<RunSubagentResult | null> {
    if (!request.resumeTurnId) return null;
    const cached = await this.findCompleted(childSessionId, request.resumeTurnId);
    if (!cached) return null;
    if (request.emit) {
      const messages = await this.messages.loadMessagesForTurn(childSessionId, request.resumeTurnId);
      replayToolEvents(request.emit, childSessionId, request.resumeTurnId, messages);
    }
    return {
      result: cached.finalText,
      structuredOutput: cached.structuredOutput,
      taskId: `replay-${request.resumeTurnId}`,
      childSessionId,
      parentSessionId: request.parentSessionId,
      status: 'completed',
      vfsMode: request.vfsMode,
      vfsSessionId,
      copiedFiles: [],
      durationMs,
    };
  }
}

function replayToolEvents(
  emit: NonNullable<RunSubagentRequest['emit']>,
  sessionId: string,
  turnId: string,
  messages: ChatMessage[],
): void {
  const calls = new Map<string, NonNullable<ChatMessage['toolCalls']>[number]>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        calls.set(call.id, call);
        emit('tool:start', {
          callId: call.id,
          toolName: call.name,
          args: call.args,
          sessionId,
          turnId,
        });
      }
      continue;
    }
    if (message.role !== 'tool_result' || !message.toolCallId) continue;
    const call = calls.get(message.toolCallId);
    if (!call) continue;
    emit('tool:result', parseToolResult(message, call.name, sessionId));
  }
}

function parseToolResult(message: ChatMessage, toolName: string, sessionId: string): ToolResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message.content) as unknown;
  } catch (error) {
    throw new Error(`Unable to replay tool result ${message.toolCallId} from child turn ${message.turnId}`, { cause: error });
  }

  const base = {
    callId: message.toolCallId ?? '',
    toolName,
    sessionId,
  };
  if (!isRecord(parsed)) {
    return { ...base, status: 'success', data: parsed };
  }
  if (isToolResultStatus(parsed['toolResultStatus'])) {
    const data = { ...parsed };
    delete data['toolResultStatus'];
    const errorCode = readString(data, 'toolResultErrorCode');
    const errorMessage = readString(data, 'toolResultErrorMessage');
    delete data['toolResultErrorCode'];
    delete data['toolResultErrorMessage'];
    return {
      ...base,
      status: parsed['toolResultStatus'],
      data,
      ...(errorCode ? { errorCode } : {}),
      ...(errorMessage ? { errorMessage } : {}),
    };
  }
  if (
    (parsed['status'] === 'error' || parsed['status'] === 'cancelled')
    && (typeof parsed['errorCode'] === 'string' || typeof parsed['errorMessage'] === 'string')
  ) {
    return {
      ...base,
      status: parsed['status'],
      ...(typeof parsed['errorCode'] === 'string' ? { errorCode: parsed['errorCode'] } : {}),
      ...(typeof parsed['errorMessage'] === 'string' ? { errorMessage: parsed['errorMessage'] } : {}),
    };
  }
  return { ...base, status: 'success', data: parsed };
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function isToolResultStatus(value: unknown): value is ToolResult['status'] {
  return value === 'success' || value === 'error' || value === 'cancelled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
