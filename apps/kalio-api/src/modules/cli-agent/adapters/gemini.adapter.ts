import { Injectable } from '@nestjs/common';
import type { ICLIAgentAdapter } from './cli-agent.adapter';

@Injectable()
export class GeminiAdapter implements ICLIAgentAdapter {
  readonly id = 'gemini';
  readonly displayName = 'Gemini CLI';
  readonly installUrl = 'https://github.com/google-gemini/gemini-cli?tab=readme-ov-file#-installation';

  executable(platform: NodeJS.Platform): string {
    // On Windows gemini is a .cmd shim — must be run via cmd /c
    return platform === 'win32' ? 'cmd' : 'gemini';
  }

  wrapperArgs(platform: NodeJS.Platform): string[] {
    return platform === 'win32' ? ['/c', 'gemini'] : [];
  }

  buildArgs(prompt: string, workdir: string, extra: string[] = []): string[] {
    // -p = print/non-interactive mode; --output-format text = plain text output
    // --include-directories grants file access to the working directory
    // --approval-mode yolo lets Gemini complete shell/edit steps after the outer Kalio confirmation gate.
    return [
      '-p', prompt,
      '--output-format', 'text',
      '--include-directories', workdir,
      '--approval-mode', 'yolo',
      ...extra,
    ];
  }

  probeArgs(): string[] {
    return ['--version'];
  }
}
