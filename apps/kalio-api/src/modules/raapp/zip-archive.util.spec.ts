import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { archiveDirectoryToZip } from './zip-archive.util';

class FakeOutput extends EventEmitter {}

class SuccessfulArchiver extends EventEmitter {
  private output: FakeOutput | null = null;

  pipe(output: FakeOutput): void {
    this.output = output;
  }

  directory(_sourceDir: string, _dest: false): void {}

  finalize(): void {
    queueMicrotask(() => {
      this.output?.emit('close');
    });
  }
}

class FailingArchiver extends EventEmitter {
  private output: FakeOutput | null = null;

  pipe(output: FakeOutput): void {
    this.output = output;
  }

  directory(_sourceDir: string, _dest: false): void {}

  finalize(): void {
    queueMicrotask(() => {
      this.output?.emit('error', new Error('disk full'));
    });
  }
}

describe('archiveDirectoryToZip', () => {
  it('resolves when the output stream closes cleanly', async () => {
    await expect(
      archiveDirectoryToZip({
        sourceDir: 'source-dir',
        zipPath: 'out.zip',
        createWriteStream: () => new FakeOutput() as never,
        createArchiver: () => new SuccessfulArchiver() as never,
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects and runs cleanup when the output stream errors after finalize', async () => {
    const cleanupOnError = vi.fn().mockResolvedValue(undefined);

    await expect(
      archiveDirectoryToZip({
        sourceDir: 'source-dir',
        zipPath: 'out.zip',
        createWriteStream: () => new FakeOutput() as never,
        createArchiver: () => new FailingArchiver() as never,
        cleanupOnError,
      }),
    ).rejects.toThrow('disk full');

    expect(cleanupOnError).toHaveBeenCalledTimes(1);
  });

  it('does not leak cleanup rejections as unhandled promise rejections', async () => {
    const cleanupOnError = vi.fn().mockRejectedValue(new Error('cleanup failed'));
    const onUnhandledRejection = vi.fn();
    const listener = (reason: unknown) => onUnhandledRejection(reason);
    process.on('unhandledRejection', listener);

    try {
      await expect(
        archiveDirectoryToZip({
          sourceDir: 'source-dir',
          zipPath: 'out.zip',
          createWriteStream: () => new FakeOutput() as never,
          createArchiver: () => new FailingArchiver() as never,
          cleanupOnError,
        }),
      ).rejects.toThrow('disk full');

      await new Promise<void>((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', listener);
    }

    expect(onUnhandledRejection).not.toHaveBeenCalled();
  });
});