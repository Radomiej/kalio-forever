import { Injectable, Logger } from '@nestjs/common';
import type { CLIAgentResult } from '@kalio/types';
import { terminateCliAgentProcess, type KillableProcess } from './cli-agent-process-kill';
import { compressOutput } from './output-compressor';
import type { ProgressEmitFn } from './cli-agent.types';
import { stripTerminalControlCodes } from './terminal-output';

interface PtyProcess extends KillableProcess {
  onData(callback: (data: string) => void): { dispose(): void } | void;
  onExit(callback: (event: { exitCode: number }) => void): { dispose(): void } | void;
}

interface PtyModule {
  spawn(
    executable: string,
    args: string[],
    options: {
      name: string;
      cols: number;
      rows: number;
      cwd: string;
      env: NodeJS.ProcessEnv;
    },
  ): PtyProcess;
}

export interface CLIAgentPtyRunRequest {
  agentId: string;
  executable: string;
  args: string[];
  workdir: string;
  callId: string;
  sessionId: string;
  timeoutMs: number;
  maxOutputChars: number;
  emitFn?: ProgressEmitFn;
  onStart?: (process: PtyProcess) => void;
}

@Injectable()
export class CLIAgentPtyService {
  private readonly logger = new Logger(CLIAgentPtyService.name);

  async run(request: CLIAgentPtyRunRequest): Promise<CLIAgentResult> {
    const pty = await this.loadPty();
    const startedAt = Date.now();

    return new Promise<CLIAgentResult>((resolve, reject) => {
      const proc = pty.spawn(request.executable, request.args, {
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
        cwd: request.workdir,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      request.onStart?.(proc);

      let rawOutput = '';
      let settled = false;
      const maxBuffer = 4 * 1024 * 1024;
      const dataSubscription = proc.onData((chunk) => {
        const cleanedChunk = stripTerminalControlCodes(chunk);
        if (rawOutput.length < maxBuffer) {
          rawOutput += cleanedChunk;
        }
        request.emitFn?.('cli_agent:progress', {
          callId: request.callId,
          sessionId: request.sessionId,
          agentId: request.agentId,
          chunk: cleanedChunk,
        });
      });

      const cleanup = (): void => {
        clearTimeout(timer);
        dataSubscription?.dispose();
        exitSubscription?.dispose();
      };

      const finalize = (exitCode: number): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();

        const durationMs = Date.now() - startedAt;
        const output = compressOutput(rawOutput.trim(), request.maxOutputChars);
        this.logger.log(`[${request.agentId}] PTY done in ${durationMs}ms, exitCode=${exitCode}, outputLen=${output.length}`);
        resolve({ output, exitCode, durationMs, agentId: request.agentId });
      };

      const exitSubscription = proc.onExit((event) => {
        finalize(event.exitCode);
      });

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        void terminateCliAgentProcess({
          proc,
          platform: this.getPlatform(),
          agentId: request.agentId,
          onWarn: (message) => this.logger.warn(`[PTY] ${message}`),
        });
        reject(new Error(`CLI agent "${request.agentId}" timed out after ${request.timeoutMs}ms`));
      }, request.timeoutMs);
    });
  }

  protected async loadPty(): Promise<PtyModule> {
    try {
      return (await import('@lydell/node-pty')) as unknown as PtyModule;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `PTY_UNAVAILABLE: install or repair @lydell/node-pty to run interactive CLI agents. ${message}`,
        { cause: err },
      );
    }
  }

  private getPlatform(): NodeJS.Platform {
    return process.platform;
  }
}
