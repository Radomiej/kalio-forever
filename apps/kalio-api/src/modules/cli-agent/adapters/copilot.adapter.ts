import { Injectable } from '@nestjs/common';
import type { ICLIAgentAdapter } from './cli-agent.adapter';

@Injectable()
export class CopilotAdapter implements ICLIAgentAdapter {
  readonly id = 'copilot';
  readonly displayName = 'GitHub Copilot CLI';
  readonly installUrl = 'https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line';
  readonly supportsModelSelection = false;

  executable(platform: NodeJS.Platform): string {
    // On Windows copilot is a .cmd shim — must be run via cmd /c
    return platform === 'win32' ? 'cmd' : 'copilot';
  }

  wrapperArgs(platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? ['/c', 'copilot'] : [];
  }

  buildArgs(prompt: string, workdir: string, extra: string[] = []): string[] {
    return [
      '-p', prompt,
      '--allow-all',
      '--add-dir', workdir,
      '--silent',
      ...extra,
    ];
  }

  probeArgs(): string[] {
    return ['--version'];
  }
}
