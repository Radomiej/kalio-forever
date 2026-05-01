import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest, CLIAgentResult } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';
import { CLIAgentService } from '../../cli-agent/cli-agent.service';

/** Max timeout cap: 20 minutes */
const MAX_TIMEOUT_MS = 1_200_000;
/** Default timeout: 10 minutes */
const DEFAULT_TIMEOUT_MS = 600_000;

@Injectable()
@Tool({
  name: 'run_cli_agent',
  description:
    'Run a CLI coding agent (Copilot, Gemini, Claude Code) to autonomously complete a coding task in a ' +
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
          '"claude" (Anthropic Claude Code). Defaults to "copilot" if omitted.',
        enum: ['copilot', 'gemini', 'claude'],
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
  ) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentResult> {
    const agentId = (request.args['agentId'] as string | undefined) ?? 'copilot';
    const prompt = request.args['prompt'] as string;
    const workdir = request.args['workdir'] as string;
    const rawTimeout = request.args['timeoutMs'] as number | undefined;
    const timeoutMs = Math.min(rawTimeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

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

    // Wire up progress streaming if the calling context provided an emitter
    const emitFn = request._emit;

    return this.cliAgent.run(
      agentId,
      prompt,
      workdir,
      request.callId,
      request.sessionId,
      emitFn
        ? (event, data) => { emitFn(event, data); }
        : undefined,
      timeoutMs,
    );
  }
}
