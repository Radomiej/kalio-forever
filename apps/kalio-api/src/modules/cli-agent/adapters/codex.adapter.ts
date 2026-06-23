import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ICLIAgentAdapter } from './cli-agent.adapter';

export function defaultCodexCommand(platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') {
    return 'codex';
  }

  const appData = process.env.APPDATA;
  const appDataShim = appData ? join(appData, 'npm', 'codex.cmd') : '';
  if (appDataShim && existsSync(appDataShim)) {
    return appDataShim;
  }

  return 'codex.cmd';
}

@Injectable()
export class CodexAdapter implements ICLIAgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex CLI';
  readonly installUrl = 'https://developers.openai.com/codex/quickstart';
  readonly supportsModelSelection = true;

  executable(platform: NodeJS.Platform): string {
    // On Windows the npm-installed codex binary is exposed via a .cmd shim.
    return platform === 'win32' ? 'cmd' : 'codex';
  }

  wrapperArgs(platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? ['/c', defaultCodexCommand(platform)] : [];
  }

  buildArgs(prompt: string, _workdir: string, extra: string[] = [], model = ''): string[] {
    return [
      '-a', 'never',
      'exec',
      '--sandbox', 'workspace-write',
      '--color', 'never',
      '--json',
      ...this.modelArgs(model),
      ...extra,
      prompt,
    ];
  }

  private modelArgs(model: string): string[] {
    const trimmed = model.trim();
    return trimmed.length > 0 ? ['--model', trimmed] : [];
  }

  probeArgs(): string[] {
    return ['--version'];
  }
}
