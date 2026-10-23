import { Injectable } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultCodexCommand } from './adapters/codex.adapter';
import type { CLIAgentRunLimits, RunCliAgentRequest } from './cli-agent.types';
import {
  WINDOWS_POWERSHELL_EXE,
  normalizeTimeoutMs,
  quotePowerShellArg,
} from './cli-agent-utils';

const WINDOWS_TEMP_PROMPT_THRESHOLD = 7_000;

export interface PreparedCliPrompt {
  prompt: string;
  includeDirectory?: string;
  cleanup?: () => Promise<void>;
}

export interface PreparedCodexPtyLaunch {
  executable: string;
  args: string[];
  auditCommand: string;
  cleanup?: () => Promise<void>;
}

@Injectable()
export class CLIAgentLaunchPreparationService {
  async preparePromptForAgent(
    agentId: string,
    platform: NodeJS.Platform,
    prompt: string,
  ): Promise<PreparedCliPrompt> {
    if (platform !== 'win32' || agentId !== 'gemini' || prompt.length <= WINDOWS_TEMP_PROMPT_THRESHOLD) {
      return { prompt };
    }

    const promptDir = await mkdtemp(join(tmpdir(), 'kalio-gemini-prompt-'));
    const promptPath = join(promptDir, 'prompt.txt');
    await writeFile(promptPath, prompt, 'utf8');

    return {
      prompt: `Read and follow the complete implementation instructions from this file: ${promptPath}`,
      includeDirectory: promptDir,
      cleanup: () => rm(promptDir, { recursive: true, force: true }),
    };
  }

  async buildCodexPtyLaunch(
    platform: NodeJS.Platform,
    cliPath: string,
    promptArgs: string[],
    prompt: string,
  ): Promise<PreparedCodexPtyLaunch> {
    if (platform !== 'win32') {
      return { executable: cliPath || 'codex', args: promptArgs, auditCommand: cliPath || 'codex' };
    }

    const promptDir = await mkdtemp(join(tmpdir(), 'kalio-codex-prompt-'));
    const promptPath = join(promptDir, 'prompt.txt');
    await writeFile(promptPath, prompt, 'utf8');

    const codexCommand = cliPath || defaultCodexCommand(platform);
    const argsWithoutPrompt = promptArgs.at(-1) === prompt ? promptArgs.slice(0, -1) : promptArgs;
    const command = [
      `$prompt = Get-Content -Raw -LiteralPath ${quotePowerShellArg(promptPath)}`,
      `$prompt | & ${quotePowerShellArg(codexCommand)} ${[...argsWithoutPrompt, '-'].map(quotePowerShellArg).join(' ')}`,
    ].join('; ');
    return {
      executable: WINDOWS_POWERSHELL_EXE,
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      auditCommand: codexCommand,
      cleanup: () => rm(promptDir, { recursive: true, force: true }),
    };
  }

  resolveRunLimits(
    agentId: string,
    request: RunCliAgentRequest,
    agentConfig: { timeoutMs: number; hardTimeoutEnabled?: boolean; hardTimeoutMs?: number },
  ): CLIAgentRunLimits {
    const inactivityTimeoutMs = normalizeTimeoutMs(
      agentId,
      request.inactivityTimeoutMs ?? request.timeoutMs ?? agentConfig.timeoutMs,
    );
    const requestedHardTimeout = request.hardTimeoutMs
      ?? (agentConfig.hardTimeoutEnabled ? agentConfig.hardTimeoutMs : undefined);

    return {
      inactivityTimeoutMs,
      ...(requestedHardTimeout !== undefined
        ? { hardTimeoutMs: normalizeTimeoutMs(agentId, requestedHardTimeout) }
        : {}),
    };
  }
}
