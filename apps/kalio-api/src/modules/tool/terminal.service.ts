import { Injectable, Logger, OnModuleDestroy, ForbiddenException } from '@nestjs/common';
import { spawn, ChildProcess } from 'node:child_process';
import { nanoid } from 'nanoid';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';

export interface TerminalSession {
  id: string;
  command: string;
  pid: number | undefined;
  status: 'running' | 'exited' | 'killed';
  output: string;
  exitCode: number | null;
  createdAt: number;
}

@Injectable()
export class TerminalService implements OnModuleDestroy {
  private readonly logger = new Logger(TerminalService.name);
  private readonly sessions = new Map<string, { meta: TerminalSession; proc: ChildProcess }>();
  private readonly MAX_OUTPUT = 64 * 1024; // 64 KB per session

  constructor(private readonly allowedPaths: AllowedPathsService) {}

  async spawn(
    command: string,
    args: string[],
    cwd?: string,
    closeStdin = false,
  ): Promise<TerminalSession> {
    const id = nanoid();
    const safeCwd = cwd ?? process.cwd();

    const allowed = await this.allowedPaths.isAllowed(safeCwd);
    if (!allowed) {
      throw new ForbiddenException(`ACCESS_DENIED: cwd is outside allowed roots: ${safeCwd}`);
    }

    const proc = spawn(command, args, {
      cwd: safeCwd,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (closeStdin && proc.stdin) {
      proc.stdin.end();
    }

    const meta: TerminalSession = {
      id,
      command: [command, ...args].join(' '),
      pid: proc.pid,
      status: 'running',
      output: '',
      exitCode: null,
      createdAt: Date.now(),
    };

    const append = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      meta.output = (meta.output + text).slice(-this.MAX_OUTPUT);
    };

    proc.stdout?.on('data', append);
    proc.stderr?.on('data', append);

    proc.on('close', (code) => {
      meta.status = meta.status === 'killed' ? 'killed' : 'exited';
      meta.exitCode = code;
      this.logger.log(`Terminal ${id} exited with code ${code}`);
    });

    proc.on('error', (err) => {
      meta.output += `\n[error] ${err.message}`;
      meta.status = 'exited';
      meta.exitCode = -1;
    });

    this.sessions.set(id, { meta, proc });
    this.logger.log(`Spawned terminal ${id}: ${meta.command} (pid=${proc.pid})`);
    return meta;
  }

  list(): TerminalSession[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s.meta }));
  }

  get(id: string): TerminalSession | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    return { ...s.meta };
  }

  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (s.meta.status !== 'running') return false;
    s.meta.status = 'killed';
    s.proc.kill('SIGTERM');
    return true;
  }

  /**
   * Wait for a terminal session to exit (or timeout).
   * Returns the final output and exit code.
   * On timeout, kills the process and rejects.
   */
  waitForExit(id: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
    const s = this.sessions.get(id);
    if (!s) return Promise.reject(new Error(`Terminal session not found: ${id}`));
    if (s.meta.status !== 'running') {
      return Promise.resolve({ output: s.meta.output, exitCode: s.meta.exitCode ?? 0 });
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        s.proc.kill('SIGTERM');
        reject(new Error(`CLI agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      s.proc.on('close', () => {
        clearTimeout(timer);
        resolve({ output: s.meta.output, exitCode: s.meta.exitCode ?? 0 });
      });
    });
  }

  onModuleDestroy(): void {
    for (const [id, s] of this.sessions) {
      if (s.meta.status === 'running') {
        s.proc.kill('SIGTERM');
        this.logger.log(`Killed terminal ${id} on shutdown`);
      }
    }
    this.sessions.clear();
  }
}
