import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Transform } from 'node:stream';
import type { ClientConnection } from '@agentclientprotocol/sdk';
import type { DevinCliConfigHandle } from './devin-cli-config';
import { stopDevinChild } from './devin-cli-process-shutdown';

/** One attempt retains its resources until each teardown step succeeds. */
export class DevinCliAcpLifecycle {
  config?: DevinCliConfigHandle;
  child?: ChildProcessWithoutNullStreams;
  connection?: ClientConnection;
  private childClosed = false;
  private spawnFailed = false;
  private childClose?: Promise<void>;
  private failure?: Error;
  private resolveFailure!: () => void;
  private readonly failed = new Promise<void>(resolve => { this.resolveFailure = resolve; });
  private disposing?: Promise<void>;

  get disposal(): Promise<void> | undefined { return this.disposing; }
  get hasResources(): boolean { return Boolean(this.config || this.child || this.connection); }
  get usable(): boolean { return Boolean(this.connection && !this.connection.signal.aborted && !this.failure && !this.disposing); }

  adoptChild(child: ChildProcessWithoutNullStreams, onFailure: (reason: 'exit' | 'error' | 'closed', error: Error) => void): void {
    this.child = child;
    this.childClose = new Promise<void>(resolve => {
      child.once('close', () => {
        this.childClosed = true;
        resolve();
        onFailure('closed', new Error('Devin ACP process closed.'));
      });
    });
    child.once('error', error => {
      this.spawnFailed = child.pid === undefined;
      onFailure('error', error);
    });
    child.once('exit', (code, signal) => onFailure('exit', new Error(`Devin ACP exited (${code ?? 'null'}/${signal ?? 'none'}).`)));
  }

  fail(error: Error): void {
    this.failure ??= error;
    this.resolveFailure();
  }

  async initialize<T>(request: Promise<T>): Promise<T> {
    return Promise.race([request, this.failed.then(() => { throw this.failure; })]);
  }

  dispose(): Promise<void> {
    if (!this.disposing) {
      this.fail(new Error('Devin ACP connection closed.'));
      this.disposing = this.disposeNow().finally(() => { this.disposing = undefined; });
    }
    return this.disposing;
  }

  private async disposeNow(): Promise<void> {
    if (this.child) {
      if (!this.childClosed) {
        if (!this.spawnFailed) await stopDevinChild(this.child);
        // exitCode is not a stdio-close barrier; stopDevinChild may return on exit.
        await boundedClose(this.childClose!);
      }
      this.child = undefined;
    }
    if (this.connection) {
      this.connection.close();
      await boundedClose(this.connection.closed);
      this.connection = undefined;
    }
    await this.config?.cleanup();
    this.config = undefined;
  }
}

async function boundedClose(closed: Promise<void>): Promise<void> {
  let timeout!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([closed, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Devin ACP resource did not close within 10 seconds.')), 10_000);
    })]);
  } finally {
    clearTimeout(timeout);
  }
}

export function createNdjsonFrameGuard(): Transform {
  let lineBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      for (const byte of chunk) {
        lineBytes = byte === 10 ? 0 : lineBytes + 1;
        if (lineBytes > 1024 * 1024) {
          callback(new Error('Devin ACP frame exceeded the maximum size.'));
          return;
        }
      }
      callback(null, chunk);
    },
  });
}
