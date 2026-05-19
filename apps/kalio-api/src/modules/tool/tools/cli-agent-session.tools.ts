import { Injectable } from '@nestjs/common';
import type { CLIAgentSessionSnapshot, ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import { CLIAgentSessionRuntimeService } from '../../cli-agent/cli-agent-session-runtime.service';

const MAX_TIMEOUT_MS = 1_200_000;
const SUPPORTED_AGENT_IDS = new Set(['copilot', 'gemini', 'claude', 'codex']);

function getRequiredStringArg(args: ToolCallRequest['args'], key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`INVALID_${key.toUpperCase()}: ${key} must be a non-empty string`);
  }
  return value.trim();
}

function getOptionalBooleanArg(args: ToolCallRequest['args'], key: string, fallback: boolean): boolean {
  const value = args[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`INVALID_${key.toUpperCase()}: ${key} must be a boolean`);
  }
  return value;
}

function getOptionalTimeoutArg(args: ToolCallRequest['args']): number | undefined {
  const rawValue = args['timeoutMs'];
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 1) {
    throw new Error('INVALID_TIMEOUT_MS: timeoutMs must be a positive integer');
  }
  return Math.min(rawValue, MAX_TIMEOUT_MS);
}

function getAgentIdArg(args: ToolCallRequest['args']): string {
  const rawValue = args['agentId'];
  if (rawValue === undefined) {
    return 'copilot';
  }
  if (typeof rawValue !== 'string' || !SUPPORTED_AGENT_IDS.has(rawValue)) {
    throw new Error('INVALID_AGENT_ID: agentId must be one of "copilot", "gemini", "claude", or "codex"');
  }
  return rawValue;
}

@Injectable()
@Tool({
  name: 'spawn_cli_agent',
  description:
    'Start a durable CLI child session in the background and return immediately with a childSessionId and live runtime state. ' +
    'Prefer this over run_cli_agent when an orchestrator needs to monitor, redirect, or stop the CLI session later.',
  parameters: {
    type: 'object',
    required: ['prompt', 'workdir'],
    properties: {
      agentId: {
        type: 'string',
        enum: ['copilot', 'gemini', 'claude', 'codex'],
        description: 'Which CLI agent to use. Defaults to "copilot".',
      },
      prompt: {
        type: 'string',
        description: 'Initial instruction for the new CLI child session.',
      },
      workdir: {
        type: 'string',
        description: 'Absolute project path. Must be in Allowed Paths.',
      },
      timeoutMs: {
        type: 'integer',
        description: `Optional timeout for the current CLI turn. Max ${MAX_TIMEOUT_MS} ms.`,
      },
    },
  },
  requiresConfirmation: true,
})
export class SpawnCliAgentTool {
  constructor(
    private readonly allowedPaths: AllowedPathsService,
    private readonly runtime: CLIAgentSessionRuntimeService,
  ) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentSessionSnapshot> {
    const prompt = getRequiredStringArg(request.args, 'prompt');
    const workdir = getRequiredStringArg(request.args, 'workdir');
    const agentId = getAgentIdArg(request.args);
    const timeoutMs = getOptionalTimeoutArg(request.args);

    const allowed = await this.allowedPaths.isAllowed(workdir);
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: workdir is not in AllowedPaths: ${workdir}. Add it via Settings → Allowed Paths first.`);
    }

    return this.runtime.spawnSession({
      parentSessionId: request.sessionId,
      parentToolCallId: request.callId,
      prompt,
      workdir,
      agentId,
      timeoutMs,
      emit: request._emit,
    });
  }
}

@Injectable()
@Tool({
  name: 'message_cli_agent',
  description:
    'Continue an existing durable CLI child session with a new instruction. ' +
    'Use this to redirect or refine an existing CLI session instead of spawning a new one.',
  parameters: {
    type: 'object',
    required: ['childSessionId', 'prompt'],
    properties: {
      childSessionId: {
        type: 'string',
        description: 'Existing cli-agent child session id to continue.',
      },
      prompt: {
        type: 'string',
        description: 'New instruction for the existing CLI child session.',
      },
      interruptRunning: {
        type: 'boolean',
        description: 'When true, stop the current CLI turn first if the child session is still running. Default: true.',
      },
      timeoutMs: {
        type: 'integer',
        description: `Optional timeout for the next CLI turn. Max ${MAX_TIMEOUT_MS} ms.`,
      },
    },
  },
  requiresConfirmation: true,
})
export class MessageCliAgentTool {
  constructor(private readonly runtime: CLIAgentSessionRuntimeService) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentSessionSnapshot> {
    return this.runtime.continueSession({
      parentSessionId: request.sessionId,
      childSessionId: getRequiredStringArg(request.args, 'childSessionId'),
      prompt: getRequiredStringArg(request.args, 'prompt'),
      interruptRunning: getOptionalBooleanArg(request.args, 'interruptRunning', true),
      timeoutMs: getOptionalTimeoutArg(request.args),
      emit: request._emit,
    });
  }
}

@Injectable()
@Tool({
  name: 'get_cli_agent_status',
  description:
    'Inspect the current runtime state of a durable CLI child session, including whether it is still running and the latest output tail.',
  parameters: {
    type: 'object',
    required: ['childSessionId'],
    properties: {
      childSessionId: {
        type: 'string',
        description: 'Existing cli-agent child session id to inspect.',
      },
    },
  },
})
export class GetCliAgentStatusTool {
  constructor(private readonly runtime: CLIAgentSessionRuntimeService) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentSessionSnapshot> {
    return this.runtime.getStatus(request.sessionId, getRequiredStringArg(request.args, 'childSessionId'));
  }
}

@Injectable()
@Tool({
  name: 'stop_cli_agent',
  description:
    'Stop the current turn of a durable CLI child session and keep the child session available for later follow-up guidance.',
  parameters: {
    type: 'object',
    required: ['childSessionId'],
    properties: {
      childSessionId: {
        type: 'string',
        description: 'Existing cli-agent child session id to interrupt.',
      },
    },
  },
  requiresConfirmation: true,
})
export class StopCliAgentTool {
  constructor(private readonly runtime: CLIAgentSessionRuntimeService) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentSessionSnapshot> {
    const childSessionId = getRequiredStringArg(request.args, 'childSessionId');
    return request._emit
      ? this.runtime.stopSession(request.sessionId, childSessionId, request._emit)
      : this.runtime.stopSession(request.sessionId, childSessionId);
  }
}