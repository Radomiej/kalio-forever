import { Injectable } from '@nestjs/common';
import type { CLIAgentSessionSnapshot, ToolCallRequest } from '@kalio/types';
import { and, eq, gt } from 'drizzle-orm';
import { Tool } from '../../../common/decorators/tool.decorator';
import { DrizzleService } from '../../../database/drizzle.service';
import { messages } from '../../../database/schema';
import { CLIAgentSessionRuntimeService } from '../../cli-agent/cli-agent-session-runtime.service';

type WaitForStatus = 'completed' | 'timeout' | 'failed';

interface WaitForResult {
  status: WaitForStatus;
  targetType: string;
  elapsedMs: number;
  snapshot?: CLIAgentSessionSnapshot;
  messageCount?: number;
  toolCallId?: string;
  errorMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_INTERVAL_MS = 1_000;
const STATUS_POLL_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 900_000;
const MAX_INTERVAL_MS = 30_000;

function stringArg(args: ToolCallRequest['args'], key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function requiredStringArg(args: ToolCallRequest['args'], key: string): string {
  const value = stringArg(args, key);
  if (!value) {
    throw new Error(`INVALID_${key.toUpperCase()}: ${key} must be a non-empty string`);
  }
  return value;
}

function boundedNumberArg(args: ToolCallRequest['args'], key: string, fallback: number, max: number): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`INVALID_${key.toUpperCase()}: ${key} must be a positive integer`);
  }
  return Math.min(value, max);
}

function roleArg(args: ToolCallRequest['args']): 'user' | 'assistant' | 'tool_result' | 'system' | undefined {
  const value = stringArg(args, 'role');
  if (value === undefined) return undefined;
  if (value !== 'user' && value !== 'assistant' && value !== 'tool_result' && value !== 'system') {
    throw new Error('INVALID_ROLE: role must be one of user, assistant, tool_result, or system');
  }
  return value;
}

function afterTimestampArg(args: ToolCallRequest['args']): number | undefined {
  const value = args['afterTimestamp'];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error('INVALID_AFTERTIMESTAMP: afterTimestamp must be a non-negative number');
  }
  return value;
}

function isTerminalCliStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped' || status === 'idle';
}

function isFailedCliStatus(status: string | undefined): boolean {
  return status === 'failed' || status === 'stopped';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([promise, timer]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

@Injectable()
@Tool({
  name: 'wait_for',
  description:
    'Wait for an asynchronous target to settle before judging completion. Supports cli_agent child sessions, conversation messages, and tool_result messages.',
  parameters: {
    type: 'object',
    required: ['targetType'],
    properties: {
      targetType: {
        type: 'string',
        enum: ['cli_agent', 'conversation', 'tool_result'],
        description: 'What to wait for.',
      },
      childSessionId: {
        type: 'string',
        description: 'CLI child session id when targetType is cli_agent.',
      },
      parentSessionId: {
        type: 'string',
        description: 'Parent session id for cli_agent. Defaults to the current session.',
      },
      sessionId: {
        type: 'string',
        description: 'Conversation session id for conversation or tool_result waits. Defaults to the current session.',
      },
      toolCallId: {
        type: 'string',
        description: 'Tool call id to wait for when targetType is tool_result.',
      },
      role: {
        type: 'string',
        enum: ['user', 'assistant', 'tool_result', 'system'],
        description: 'Optional role filter for conversation waits.',
      },
      afterTimestamp: {
        type: 'integer',
        description: 'Only count messages created after this timestamp in milliseconds.',
      },
      minMessages: {
        type: 'integer',
        description: 'Minimum matching conversation messages. Default: 1.',
      },
      timeoutMs: {
        type: 'integer',
        description: `Maximum wait time. Default ${DEFAULT_TIMEOUT_MS} ms, max ${MAX_TIMEOUT_MS} ms.`,
      },
      intervalMs: {
        type: 'integer',
        description: `Polling interval. Default ${DEFAULT_INTERVAL_MS} ms, max ${MAX_INTERVAL_MS} ms.`,
      },
    },
  },
})
export class WaitForTool {
  constructor(
    private readonly cliRuntime: CLIAgentSessionRuntimeService,
    private readonly drizzle: DrizzleService,
  ) {}

  async execute(request: ToolCallRequest): Promise<WaitForResult> {
    const targetType = requiredStringArg(request.args, 'targetType');
    const timeoutMs = boundedNumberArg(request.args, 'timeoutMs', DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const intervalMs = boundedNumberArg(request.args, 'intervalMs', DEFAULT_INTERVAL_MS, MAX_INTERVAL_MS);
    const startedAt = Date.now();

    if (targetType === 'cli_agent') {
      return this.waitForCliAgent(request, startedAt, timeoutMs, intervalMs);
    }
    if (targetType === 'conversation') {
      return this.waitForConversation(request, startedAt, timeoutMs, intervalMs);
    }
    if (targetType === 'tool_result') {
      return this.waitForToolResult(request, startedAt, timeoutMs, intervalMs);
    }

    throw new Error('INVALID_TARGETTYPE: targetType must be cli_agent, conversation, or tool_result');
  }

  private async waitForCliAgent(
    request: ToolCallRequest,
    startedAt: number,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<WaitForResult> {
    const parentSessionId = stringArg(request.args, 'parentSessionId') ?? request.sessionId;
    const childSessionId = requiredStringArg(request.args, 'childSessionId');
    let lastSnapshot: CLIAgentSessionSnapshot | undefined;
    let lastError: string | undefined;

    while (Date.now() - startedAt <= timeoutMs) {
      try {
        const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
        lastSnapshot = await withTimeout(
          this.cliRuntime.getStatus(parentSessionId, childSessionId),
          Math.min(STATUS_POLL_TIMEOUT_MS, remainingMs),
          `CLI status poll timed out after ${Math.min(STATUS_POLL_TIMEOUT_MS, remainingMs)}ms`,
        );
        lastError = undefined;
        if (isTerminalCliStatus(lastSnapshot.status)) {
          return {
            status: isFailedCliStatus(lastSnapshot.status) ? 'failed' : 'completed',
            targetType: 'cli_agent',
            elapsedMs: Date.now() - startedAt,
            snapshot: lastSnapshot,
          };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await sleep(intervalMs);
    }

    return {
      status: 'timeout',
      targetType: 'cli_agent',
      elapsedMs: Date.now() - startedAt,
      ...(lastSnapshot ? { snapshot: lastSnapshot } : {}),
      ...(lastError ? { errorMessage: lastError } : {}),
    };
  }

  private async waitForConversation(
    request: ToolCallRequest,
    startedAt: number,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<WaitForResult> {
    const sessionId = stringArg(request.args, 'sessionId') ?? request.sessionId;
    const role = roleArg(request.args);
    const afterTimestamp = afterTimestampArg(request.args);
    const minMessages = boundedNumberArg(request.args, 'minMessages', 1, 1_000);
    let count = 0;

    while (Date.now() - startedAt <= timeoutMs) {
      count = await this.countMessages({ sessionId, role, afterTimestamp });
      if (count >= minMessages) {
        return {
          status: 'completed',
          targetType: 'conversation',
          elapsedMs: Date.now() - startedAt,
          messageCount: count,
        };
      }
      await sleep(intervalMs);
    }

    return {
      status: 'timeout',
      targetType: 'conversation',
      elapsedMs: Date.now() - startedAt,
      messageCount: count,
    };
  }

  private async waitForToolResult(
    request: ToolCallRequest,
    startedAt: number,
    timeoutMs: number,
    intervalMs: number,
  ): Promise<WaitForResult> {
    const sessionId = stringArg(request.args, 'sessionId') ?? request.sessionId;
    const toolCallId = requiredStringArg(request.args, 'toolCallId');
    const afterTimestamp = afterTimestampArg(request.args);
    let count = 0;

    while (Date.now() - startedAt <= timeoutMs) {
      count = await this.countMessages({ sessionId, role: 'tool_result', toolCallId, afterTimestamp });
      if (count > 0) {
        return {
          status: 'completed',
          targetType: 'tool_result',
          elapsedMs: Date.now() - startedAt,
          messageCount: count,
          toolCallId,
        };
      }
      await sleep(intervalMs);
    }

    return {
      status: 'timeout',
      targetType: 'tool_result',
      elapsedMs: Date.now() - startedAt,
      messageCount: count,
      toolCallId,
    };
  }

  private async countMessages(params: {
    sessionId: string;
    role?: 'user' | 'assistant' | 'tool_result' | 'system';
    toolCallId?: string;
    afterTimestamp?: number;
  }): Promise<number> {
    const conditions = [eq(messages.sessionId, params.sessionId)];
    if (params.role) {
      conditions.push(eq(messages.role, params.role));
    }
    if (params.toolCallId) {
      conditions.push(eq(messages.toolCallId, params.toolCallId));
    }
    if (params.afterTimestamp !== undefined) {
      conditions.push(gt(messages.createdAt, new Date(params.afterTimestamp)));
    }
    const rows = await this.drizzle.db.select({ id: messages.id }).from(messages).where(and(...conditions));
    return rows.length;
  }
}
