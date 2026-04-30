import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolCallRequest, CLIAgentResult } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';

const execFileAsync = promisify(execFile);

/** Max timeout cap: 20 minutes */
const MAX_TIMEOUT_MS = 1_200_000;
/** Default timeout: 10 minutes */
const DEFAULT_TIMEOUT_MS = 600_000;

@Injectable()
@Tool({
  name: 'run_cli_agent',
  description:
    'Run a GitHub Copilot CLI agent (copilot -p) to autonomously complete a coding task in a real ' +
    'project directory. The agent can read, write, and edit files and run shell commands. ' +
    'Use this to delegate implementation tasks, bug fixes, refactors, or test writing to Copilot CLI. ' +
    'Requires workdir to be in the AllowedPaths list. Returns the full agent output and exit code.',
  parameters: {
    type: 'object',
    required: ['prompt', 'workdir'],
    properties: {
      prompt: {
        type: 'string',
        description:
          'Clear task description for the Copilot CLI agent. Include: what to do, which files, ' +
          'acceptance criteria (e.g. "tests must pass"). More detail = better results.',
      },
      workdir: {
        type: 'string',
        description:
          'Absolute path to the project directory where Copilot CLI will operate. ' +
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

  constructor(private readonly allowedPaths: AllowedPathsService) {}

  async execute(request: ToolCallRequest): Promise<CLIAgentResult> {
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
      `[run_cli_agent] Starting copilot -p in ${workdir} (timeout=${timeoutMs}ms, prompt=${prompt.slice(0, 80)}...)`,
    );

    const startedAt = Date.now();

    try {
      const { stdout, stderr } = await execFileAsync(
        'copilot',
        ['-p', prompt, '--allow-all', '--add-dir', workdir, '--silent', '--output-format', 'text'],
        {
          cwd: workdir,
          timeout: timeoutMs,
          maxBuffer: 4 * 1024 * 1024, // 4 MB
          // Close stdin immediately — copilot -p checks stdin liveness and will hang
          // if we don't send EOF up front.
          // stdin is /dev/null when input is not a tty.
        },
      );

      const durationMs = Date.now() - startedAt;
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      this.logger.log(`[run_cli_agent] Done in ${durationMs}ms, exitCode=0, outputLen=${output.length}`);

      return { output, exitCode: 0, durationMs };
    } catch (err: unknown) {
      const durationMs = Date.now() - startedAt;

      // execFile throws on non-zero exit or timeout; extract partial output if available
      const execErr = err as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string };

      if (execErr.killed || execErr.code === 'ETIMEDOUT') {
        throw new Error(`Copilot CLI timed out after ${timeoutMs}ms`);
      }

      const output = [execErr.stdout ?? '', execErr.stderr ?? ''].filter(Boolean).join('\n').trim();
      const exitCode = typeof execErr.code === 'number' ? execErr.code : 1;

      this.logger.warn(
        `[run_cli_agent] Finished with exitCode=${exitCode} after ${durationMs}ms`,
      );

      // Return failure as a result (not thrown error) so the LLM can see the output
      return { output, exitCode, durationMs };
    }
  }
}
