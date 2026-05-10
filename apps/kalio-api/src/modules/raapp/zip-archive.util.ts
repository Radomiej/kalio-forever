import fsSync from 'node:fs';
import archiver from 'archiver';

type ZipOutput = {
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
};

type ZipArchiver = {
  on(event: 'error', listener: (err: Error) => void): unknown;
  pipe(output: unknown): unknown;
  directory(sourceDir: string, dest: false): unknown;
  finalize(): Promise<unknown> | void;
  abort?: () => void;
};

interface ArchiveDirectoryToZipOptions {
  sourceDir: string;
  zipPath: string;
  createWriteStream?: (zipPath: string) => ZipOutput;
  createArchiver?: () => ZipArchiver;
  cleanupOnError?: () => Promise<void> | void;
}

export async function archiveDirectoryToZip(options: ArchiveDirectoryToZipOptions): Promise<void> {
  const createWriteStream: (zipPath: string) => ZipOutput =
    options.createWriteStream ?? ((zipPath: string) => fsSync.createWriteStream(zipPath));
  const createArchiver: () => ZipArchiver =
    options.createArchiver ?? (() => archiver('zip', { zlib: { level: 6 } }) as unknown as ZipArchiver);

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(options.zipPath);
    const arc = createArchiver();
    let settled = false;

    const rejectOnce = (err: unknown): void => {
      if (settled) return;
      settled = true;
      try {
        arc.abort?.();
      } catch {
        // Best effort only.
      }

      const error = err instanceof Error ? err : new Error(String(err));
      void Promise.resolve(options.cleanupOnError?.()).then(
        () => reject(error),
        () => reject(error),
      );
    };

    output.on('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    output.on('error', rejectOnce);
    arc.on('error', rejectOnce);

    arc.pipe(output);
    arc.directory(options.sourceDir, false);

    const finalizeResult = arc.finalize();
    if (finalizeResult && typeof (finalizeResult as Promise<unknown>).catch === 'function') {
      void (finalizeResult as Promise<unknown>).catch(rejectOnce);
    }
  });
}