import { Injectable } from '@nestjs/common';
import type { ICLIAgentAdapter } from './cli-agent.adapter';

@Injectable()
export class ClaudeCodeAdapter implements ICLIAgentAdapter {
  readonly id = 'claude';
  readonly displayName = 'Claude Code';
  readonly installUrl = 'https://code.claude.com/docs/en/quickstart';
  readonly supportsModelSelection = true;

  executable(platform: NodeJS.Platform): string {
    // On Windows claude is a .cmd shim — must be run via cmd /c
    return platform === 'win32' ? 'cmd' : 'claude';
  }

  wrapperArgs(platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? ['/c', 'claude'] : [];
  }

  buildArgs(prompt: string, workdir: string, extra: string[] = [], model = ''): string[] {
    // -p / --print = non-interactive (SDK) mode
    // --dangerously-skip-permissions = required for headless operation
    // --output-format text = plain text (vs json / stream-json)
    // --max-turns 50 = safety cap; prevents runaway agentic loops
    // --add-dir grants filesystem access beyond the cwd
    return [
      '-p', prompt,
      '--dangerously-skip-permissions',
      '--output-format', 'text',
      '--max-turns', '50',
      '--add-dir', workdir,
      ...this.modelArgs(model),
      ...extra,
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
