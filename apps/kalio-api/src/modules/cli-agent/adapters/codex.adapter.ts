import { Injectable } from '@nestjs/common';
import type { ICLIAgentAdapter } from './cli-agent.adapter';

@Injectable()
export class CodexAdapter implements ICLIAgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex CLI';
  readonly installUrl = 'https://developers.openai.com/codex/quickstart';

  executable(platform: NodeJS.Platform): string {
    // On Windows the npm-installed codex binary is exposed via a .cmd shim.
    return platform === 'win32' ? 'cmd' : 'codex';
  }

  wrapperArgs(platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? ['/c', 'codex'] : [];
  }

  buildArgs(prompt: string, _workdir: string, extra: string[] = []): string[] {
    return [
      'exec',
      '--sandbox', 'workspace-write',
      '--ask-for-approval', 'never',
      '--color', 'never',
      ...extra,
      prompt,
    ];
  }

  probeArgs(): string[] {
    return ['--version'];
  }
}