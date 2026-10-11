import { Injectable, Logger, OnModuleDestroy, ForbiddenException, Optional } from '@nestjs/common';
import { spawn, ChildProcess } from 'node:child_process';
import { nanoid } from 'nanoid';
import { AllowedPathsService } from '../allowed-paths/allowed-paths.service';
import { CmdInvocationAuditService } from '../chat/cmd-invocation-audit.service';

export interface TerminalExecutionDescriptor {
  readonly terminalId: string;
  readonly executable: string;
  readonly argv: readonly string[];
  /** Lexical cwd passed to spawn, not a canonical/realpath workspace assertion. */
  readonly actualCwd: string;
  readonly shell: boolean;
  readonly ownerIdentity: Readonly<{ sessionId: string; turnId?: string; callId?: string }> | null;
}

export interface TerminalSession {
  id: string;
  command: string;
  pid: number | undefined;
  status: 'running' | 'exited' | 'killed';
  output: string;
  exitCode: number | null;
  createdAt: number;
  executionDescriptor?: TerminalExecutionDescriptor;
}

@Injectable()
export class TerminalService implements OnModuleDestroy {
  private readonly logger = new Logger(TerminalService.name);
  private readonly sessions = new Map<string, { meta: TerminalSession; proc: ChildProcess }>();
  private readonly MAX_OUTPUT = 64 * 1024; // 64 KB per session

  constructor(
    private readonly allowedPaths: AllowedPathsService,
    @Optional() private readonly cmdAudit?: CmdInvocationAuditService,
  ) {}

  async spawn(
    command: string,
    args: string[],
    cwd?: string,
    closeStdin = false,
    auditContext?: { sessionId: string; turnId?: string; callId?: string },
  ): Promise<TerminalSession> {
    const id = nanoid();
    const safeCwd = cwd ?? process.cwd();
    const capturedArgs = [...args];
    const useShell = process.platform === 'win32';
    const ownerIdentity = auditContext ? Object.freeze({
      sessionId: auditContext.sessionId, turnId: auditContext.turnId, callId: auditContext.callId,
    }) : null;
    const executionDescriptor: TerminalExecutionDescriptor = Object.freeze({
      terminalId: id, executable: command, argv: Object.freeze([...capturedArgs]),
      actualCwd: safeCwd, shell: useShell, ownerIdentity,
    });

    const allowed = await this.allowedPaths.isAllowed(safeCwd);
    if (!allowed) {
      throw new ForbiddenException(`ACCESS_DENIED: cwd is outside allowed roots: ${safeCwd}`);
    }

    await this.cmdAudit?.recordInvocation({
      command,
      shell: useShell,
      source: 'terminal.spawn',
      launcher: 'spawn',
      ...ownerIdentity,
    });

    // On Windows most CLI tools are .cmd shims and won't resolve without a shell.
    // shell:true is acceptable here — terminal_spawn already requires user confirmation.
    const proc = spawn(command, capturedArgs, {
      cwd: safeCwd,
      shell: useShell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (closeStdin && proc.stdin) {
      proc.stdin.end();
    }

    const meta: TerminalSession = {
      id,
      command: [command, ...capturedArgs].join(' '),
      pid: proc.pid,
      status: 'running',
      output: '',
      exitCode: null,
      createdAt: Date.now(),
      executionDescriptor,
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
    return structuredClone(meta);
  }

  list(): TerminalSession[] {
    return Array.from(this.sessions.values()).map((s) => structuredClone(s.meta));
  }

  get(id: string): TerminalSession | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    return structuredClone(s.meta);
  }

  kill(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    if (s.meta.status !== 'running') return false;
    s.meta.status = 'killed';
    s.proc.kill('SIGTERM');
    return true;
  }

  /** Observe completion without starting, terminating or otherwise changing the process. */
  observeUntilExit(id: string, waitMs: number, abortSignal?: AbortSignal): Promise<TerminalSession | null> {
    if (abortSignal?.aborted) return Promise.reject(new DOMException('Terminal observation aborted', 'AbortError'));
    const session = this.sessions.get(id);
    if (!session || session.meta.status !== 'running' || waitMs === 0) {
      return Promise.resolve(this.get(id));
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        session.proc.off('close', finish);
        session.proc.off('error', finish);
        abortSignal?.removeEventListener('abort', abort);
      };
      const finish = () => {
        cleanup();
        resolve(this.get(id));
      };
      const abort = () => {
        cleanup();
        reject(new DOMException('Terminal observation aborted', 'AbortError'));
      };
      const timer = setTimeout(finish, waitMs);
      session.proc.on('close', finish);
      session.proc.on('error', finish);
      abortSignal?.addEventListener('abort', abort, { once: true });
      if (abortSignal?.aborted) { abort(); return; }
      if (session.meta.status !== 'running') {
        finish();
        return;
      }
    });
  }

  /**
   * Wait for a terminal session to exit (or timeout).
   * Returns the final output and exit code.
   * On timeout, kills the process and rejects.
   */
  waitForExit(id: string, timeoutMs: number): Promise<{ output: string; exitCode: number }> {
    const s = this.sessions.get(id);
    if (!s) return Promise.reject(new Error(`Terminal session not found: ${id}`));
    const finalResult = () => ({
      output: s.meta.output,
      exitCode: s.meta.status === 'killed' ? -1 : s.meta.exitCode ?? -1,
    });
    if (s.meta.status !== 'running') {
      return Promise.resolve(finalResult());
    }

    return new Promise((resolve, reject) => {
      // Attach listener FIRST, then check status — avoids a race where the process
      // exits between the status check above and the listener registration.
      const closeHandler = () => {
        clearTimeout(timer);
        s.proc.off('close', closeHandler);
        resolve(finalResult());
      };

      s.proc.on('close', closeHandler);

      // Re-check after attaching; if it already exited we'd miss the event
      if (s.meta.status !== 'running') {
        s.proc.off('close', closeHandler);
        resolve(finalResult());
        return;
      }

      const timer = setTimeout(() => {
        s.proc.off('close', closeHandler);
        s.proc.kill('SIGTERM');
        reject(new Error(`CLI agent timed out after ${timeoutMs}ms`));
      }, timeoutMs);
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
