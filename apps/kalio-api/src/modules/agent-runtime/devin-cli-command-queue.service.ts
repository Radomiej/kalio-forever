import { Injectable, Optional } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CmdInvocationAuditService } from '../chat/cmd-invocation-audit.service';

const execFileAsync = promisify(execFile);

export type DevinCliCommandSource = 'devin.cli.probe' | 'devin.cli.models';

export interface DevinCliCommandOptions {
  timeout?: number;
  windowsHide?: boolean;
  maxBuffer?: number;
}

export interface DevinCliCommandResult {
  stdout: string;
  stderr: string;
}

@Injectable()
export class DevinCliCommandQueueService {
  private queue: Promise<void> = Promise.resolve();

  constructor(@Optional() private readonly cmdAudit?: CmdInvocationAuditService) {}

  run(
    executable: string,
    args: string[],
    options: DevinCliCommandOptions,
    source: DevinCliCommandSource,
  ): Promise<DevinCliCommandResult> {
    const pending = this.queue.then(async () => {
      await this.cmdAudit?.recordInvocation({ command: executable, source, launcher: 'execFile' });
      return execFileAsync(executable, args, { ...options, encoding: 'utf8' }) as Promise<DevinCliCommandResult>;
    });
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
}
