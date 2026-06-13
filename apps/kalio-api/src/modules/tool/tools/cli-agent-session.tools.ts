import { Injectable } from '@nestjs/common';
import type { CLIAgentSessionSnapshot, ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import { CLIAgentService } from '../../cli-agent/cli-agent.service';
import { type CLIAgentAcceptanceHints, normalizeAcceptanceHints } from '../../cli-agent/cli-agent-worktree-summary';
import { CLIAgentSessionRuntimeService } from '../../cli-agent/cli-agent-session-runtime.service';

const MAX_TIMEOUT_MS = 86_400_000;
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

function getOptionalInactivityTimeoutArg(args: ToolCallRequest['args']): number | undefined {
  const rawValue = args['inactivityTimeoutMs'] ?? args['timeoutMs'];
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 1) {
    throw new Error('INVALID_INACTIVITY_TIMEOUT_MS: inactivity timeout must be a positive integer');
  }
  return Math.min(rawValue, MAX_TIMEOUT_MS);
}

function getOptionalStringArrayArg(args: ToolCallRequest['args'], key: string): string[] | undefined {
  const rawValue = args[key];
  if (rawValue === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawValue) || rawValue.some((value) => typeof value !== 'string')) {
    throw new Error(`INVALID_${key.toUpperCase()}: ${key} must be an array of strings`);
  }
  const values = rawValue.map((value) => value.trim()).filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

function getAcceptanceHints(args: ToolCallRequest['args']): CLIAgentAcceptanceHints | undefined {
  return normalizeAcceptanceHints({
    expectedChangedFiles: getOptionalStringArrayArg(args, 'expectedChangedFiles'),
    verificationCommands: getOptionalStringArrayArg(args, 'verificationCommands'),
  });
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
        description: `Deprecated alias for inactivityTimeoutMs. Max ${MAX_TIMEOUT_MS} ms.`,
      },
      inactivityTimeoutMs: {
        type: 'integer',
        description: `Optional inactivity timeout for the current CLI turn. Max ${MAX_TIMEOUT_MS} ms.`,
      },
      expectedChangedFiles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional parent-orchestrator acceptance hint: relative file paths expected to be changed by this run.',
      },
      verificationCommands: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional parent-orchestrator acceptance hint: commands the CLI agent should run or explicitly report as skipped.',
      },
    },
  },
  requiresConfirmation: true,
})
export class SpawnCliAgentTool {
  constructor(
    private readonly allowedPaths: AllowedPathsService,
    private readonly cliAgent: CLIAgentService,
    private readonly runtime: CLIAgentSessionRuntimeService,
  ) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentSessionSnapshot> {
    const prompt = getRequiredStringArg(request.args, 'prompt');
    const workdir = getRequiredStringArg(request.args, 'workdir');
    const agentId = getAgentIdArg(request.args);
    const inactivityTimeoutMs = getOptionalInactivityTimeoutArg(request.args);
    const acceptanceHints = getAcceptanceHints(request.args);

    const allowed = await this.allowedPaths.isAllowed(workdir);
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: workdir is not in AllowedPaths: ${workdir}. Add it via Settings > Allowed Paths first.`);
    }

    await this.assertCliAgentAvailable(agentId);

    return this.runtime.spawnSession({
      parentSessionId: request.sessionId,
      parentToolCallId: request.callId,
      prompt,
      workdir,
      agentId,
      timeoutMs: inactivityTimeoutMs,
      acceptanceHints,
      emit: request._emit,
    });
  }

  private async assertCliAgentAvailable(agentId: string): Promise<void> {
    const agents = await this.cliAgent.listAll();
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error(`CLI_AGENT_UNAVAILABLE: ${agentId} is not a registered CLI agent.`);
    }
    if (!agent.available) {
      throw new Error(`CLI_AGENT_UNAVAILABLE: ${agent.displayName} is not available. Configure or disable it before spawning CLI child sessions.`);
    }
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
        description: 'When true, stop the current CLI turn first if the child session is still running. Default: false.',
      },
      timeoutMs: {
        type: 'integer',
        description: `Deprecated alias for inactivityTimeoutMs. Max ${MAX_TIMEOUT_MS} ms.`,
      },
      inactivityTimeoutMs: {
        type: 'integer',
        description: `Optional inactivity timeout for the next CLI turn. Max ${MAX_TIMEOUT_MS} ms.`,
      },
      expectedChangedFiles: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional parent-orchestrator acceptance hint: relative file paths expected to be changed by this turn.',
      },
      verificationCommands: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional parent-orchestrator acceptance hint: commands the CLI agent should run or explicitly report as skipped.',
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
      interruptRunning: getOptionalBooleanArg(request.args, 'interruptRunning', false),
      timeoutMs: getOptionalInactivityTimeoutArg(request.args),
      acceptanceHints: getAcceptanceHints(request.args),
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
