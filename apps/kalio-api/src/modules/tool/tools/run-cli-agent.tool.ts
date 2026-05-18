import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest, CLIAgentResult } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import { CLIAgentService } from '../../cli-agent/cli-agent.service';
import { CLIAgentSessionService } from '../../cli-agent/cli-agent-session.service';

/** Max timeout cap: 20 minutes */
const MAX_TIMEOUT_MS = 1_200_000;
/** Default timeout: 10 minutes */
const DEFAULT_TIMEOUT_MS = 600_000;
const SUPPORTED_AGENT_IDS = new Set(['copilot', 'gemini', 'claude', 'codex']);

function getNonEmptyStringArg(args: ToolCallRequest['args'], key: 'prompt' | 'workdir'): string {
  const rawValue = args[key];
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    throw new Error(`INVALID_${key === 'prompt' ? 'PROMPT' : 'WORKDIR'}: ${key} must be a non-empty string`);
  }
  return rawValue.trim();
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

function getTimeoutArg(args: ToolCallRequest['args']): number {
  const rawValue = args['timeoutMs'];
  if (rawValue === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 1) {
    throw new Error('INVALID_TIMEOUT_MS: timeoutMs must be a positive integer');
  }
  return Math.min(rawValue, MAX_TIMEOUT_MS);
}

function buildChildSessionTitle(agentLabel: string, prompt: string): string {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length === 0) {
    return agentLabel;
  }

  const preview = trimmedPrompt.slice(0, 48);
  return `${agentLabel}: ${preview}${trimmedPrompt.length > 48 ? '…' : ''}`;
}

@Injectable()
@Tool({
  name: 'run_cli_agent',
  description:
    'Run a CLI coding agent (Copilot, Gemini, Claude Code, Codex) to autonomously complete a coding task in a ' +
    'real project directory. The agent can read, write, and edit files and run shell commands. ' +
    'Use this to delegate implementation tasks, bug fixes, refactors, or test writing. ' +
    'Requires workdir to be in the AllowedPaths list. Returns the full agent output and exit code.',
  parameters: {
    type: 'object',
    required: ['prompt', 'workdir'],
    properties: {
      agentId: {
        type: 'string',
        description:
          'Which CLI agent to use. Supported: "copilot" (GitHub Copilot CLI), "gemini" (Google Gemini CLI), ' +
          '"claude" (Anthropic Claude Code), "codex" (OpenAI Codex CLI). Defaults to "copilot" if omitted.',
        enum: ['copilot', 'gemini', 'claude', 'codex'],
      },
      prompt: {
        type: 'string',
        description:
          'Clear task description for the agent. Include: what to do, which files, ' +
          'acceptance criteria (e.g. "tests must pass"). More detail = better results.',
      },
      workdir: {
        type: 'string',
        description:
          'Absolute path to the project directory where the agent will operate. ' +
          'Must be registered in AllowedPaths.',
      },
      timeoutMs: {
        type: 'integer',
        description: `Max execution time in ms. Default: ${DEFAULT_TIMEOUT_MS} (10 min). Max: ${MAX_TIMEOUT_MS} (20 min).`,
      },
    },
  },
  requiresConfirmation: true,
})
export class RunCliAgentTool {
  private readonly logger = new Logger(RunCliAgentTool.name);

  constructor(
    private readonly allowedPaths: AllowedPathsService,
    private readonly cliAgent: CLIAgentService,
    private readonly cliAgentSessions: CLIAgentSessionService,
  ) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentResult> {
    const agentId = getAgentIdArg(request.args);
    const prompt = getNonEmptyStringArg(request.args, 'prompt');
    const workdir = getNonEmptyStringArg(request.args, 'workdir');
    const timeoutMs = getTimeoutArg(request.args);

    // Security: validate workdir is in AllowedPaths
    const allowed = await this.allowedPaths.isAllowed(workdir);
    if (!allowed) {
      throw new Error(
        `ACCESS_DENIED: workdir is not in AllowedPaths: ${workdir}. ` +
          `Add it via Settings → Allowed Paths first.`,
      );
    }

    this.logger.log(
      `[run_cli_agent] agentId=${agentId} workdir=${workdir} timeout=${timeoutMs}ms`,
    );

    const childSession = await this.cliAgentSessions.createChildSession({
      parentSessionId: request.sessionId,
      parentToolCallId: request.callId,
      agentId,
      title: buildChildSessionTitle(
        this.cliAgent.getAdapter(agentId)?.displayName ?? `${agentId} CLI`,
        prompt,
      ),
    });

    request._emit?.('session:created', childSession);
    await this.cliAgentSessions.persistUserMessage(childSession.id, prompt);

    try {
      const result = await this.cliAgent.run({
        agentId,
        prompt,
        workdir,
        callId: request.callId,
        sessionId: childSession.id,
        emitFn: request._emit,
        timeoutMs,
      });

      const persistedResult: CLIAgentResult = {
        ...result,
        childSessionId: childSession.id,
      };

      await this.cliAgentSessions.saveToolResult(
        childSession.id,
        request.callId,
        JSON.stringify(persistedResult),
      );

      return persistedResult;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const failureResult: CLIAgentResult = {
        output: error.message,
        exitCode: 1,
        durationMs: 0,
        agentId,
        childSessionId: childSession.id,
      };

      await this.cliAgentSessions.saveToolResult(
        childSession.id,
        request.callId,
        JSON.stringify(failureResult),
      );

      throw error;
    }
  }
}
