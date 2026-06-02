import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ToolCallRequest } from '@kalio/types';
import type { DrizzleService } from '../../../database/drizzle.service';
import type { CLIAgentSessionRuntimeService } from '../../cli-agent/cli-agent-session-runtime.service';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';
import { WaitForTool } from './wait-for.tool';

function makeRequest(args: Record<string, unknown>): ToolCallRequest {
  return {
    callId: 'call-wait',
    sessionId: 'parent-session',
    toolName: 'wait_for',
    args,
  };
}

function makeRuntime(statuses: string[]): CLIAgentSessionRuntimeService {
  let index = 0;
  return {
    getStatus: vi.fn(async () => {
      const status = statuses[Math.min(index, statuses.length - 1)] ?? 'running';
      index += 1;
      return {
        childSessionId: 'cli-child-1',
        parentSessionId: 'parent-session',
        agentId: 'codex',
        workdir: 'C:/repo',
        status,
        lastPrompt: 'ship it',
        updatedAt: Date.now(),
      };
    }),
  } as unknown as CLIAgentSessionRuntimeService;
}

function makeDrizzle(counts: number[]): DrizzleService {
  let index = 0;
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => {
            const count = counts[Math.min(index, counts.length - 1)] ?? 0;
            index += 1;
            return Array.from({ length: count }, (_, itemIndex) => ({ id: `message-${itemIndex}` }));
          }),
        })),
      })),
    },
  } as unknown as DrizzleService;
}

describe('WaitForTool metadata', () => {
  it('publishes wait_for as a regular native tool', () => {
    const meta = new Reflector().get(TOOL_METADATA, WaitForTool);

    expect(meta.name).toBe('wait_for');
    expect(meta.requiresConfirmation).toBe(false);
    expect(meta.parameters.properties.targetType.enum).toEqual(['cli_agent', 'conversation', 'tool_result']);
  });
});

describe('WaitForTool', () => {
  it('waits for a CLI child session to reach a terminal status', async () => {
    const runtime = makeRuntime(['running', 'completed']);
    const tool = new WaitForTool(runtime, makeDrizzle([]));

    const result = await tool.execute(makeRequest({
      targetType: 'cli_agent',
      childSessionId: 'cli-child-1',
      timeoutMs: 100,
      intervalMs: 1,
    }));

    expect(runtime.getStatus).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'completed',
      targetType: 'cli_agent',
      snapshot: {
        childSessionId: 'cli-child-1',
        status: 'completed',
      },
    });
  });

  it('marks terminal failed CLI status as failed result', async () => {
    const runtime = makeRuntime(['running', 'failed']);
    const tool = new WaitForTool(runtime, makeDrizzle([]));

    const result = await tool.execute(makeRequest({
      targetType: 'cli_agent',
      childSessionId: 'cli-child-1',
      timeoutMs: 100,
      intervalMs: 1,
    }));

    expect(runtime.getStatus).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: 'failed',
      targetType: 'cli_agent',
      snapshot: {
        status: 'failed',
      },
    });
  });

  it('returns timeout when the CLI child keeps running', async () => {
    const tool = new WaitForTool(makeRuntime(['running']), makeDrizzle([]));

    const result = await tool.execute(makeRequest({
      targetType: 'cli_agent',
      childSessionId: 'cli-child-1',
      timeoutMs: 5,
      intervalMs: 1,
    }));

    expect(result).toMatchObject({
      status: 'timeout',
      targetType: 'cli_agent',
      snapshot: {
        status: 'running',
      },
    });
  });

  it('returns timeout when a CLI status poll hangs', async () => {
    const runtime = {
      getStatus: vi.fn(() => new Promise(() => undefined)),
    } as unknown as CLIAgentSessionRuntimeService;
    const tool = new WaitForTool(runtime, makeDrizzle([]));

    const result = await tool.execute(makeRequest({
      targetType: 'cli_agent',
      childSessionId: 'cli-child-1',
      timeoutMs: 5,
      intervalMs: 1,
    }));

    expect(runtime.getStatus).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'timeout',
      targetType: 'cli_agent',
      errorMessage: 'CLI status poll timed out after 5ms',
    });
  });

  it('waits for a matching tool_result message', async () => {
    const tool = new WaitForTool(makeRuntime(['running']), makeDrizzle([0, 1]));

    const result = await tool.execute(makeRequest({
      targetType: 'tool_result',
      toolCallId: 'call-123',
      sessionId: 'child-session',
      timeoutMs: 100,
      intervalMs: 1,
    }));

    expect(result).toMatchObject({
      status: 'completed',
      targetType: 'tool_result',
      messageCount: 1,
      toolCallId: 'call-123',
    });
  });

  it('waits for matching conversation messages', async () => {
    const tool = new WaitForTool(makeRuntime(['running']), makeDrizzle([1, 2]));

    const result = await tool.execute(makeRequest({
      targetType: 'conversation',
      sessionId: 'child-session',
      role: 'assistant',
      minMessages: 2,
      timeoutMs: 100,
      intervalMs: 1,
    }));

    expect(result).toMatchObject({
      status: 'completed',
      targetType: 'conversation',
      messageCount: 2,
    });
  });
});
