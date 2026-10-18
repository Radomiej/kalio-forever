import childProcess from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

const requireAPI = createRequire(new URL('../apps/kalio-api/package.json', import.meta.url));
const OMITTED_DATA = /Can't add archive to itself|file changed as we read it|file shrank by|file removed before we read it/i;
const DIAGNOSTIC_LIMIT = 64 * 1024;

async function writeZip(output, stagingParent, packageName) {
  const source = resolve(stagingParent, packageName);
  if (!(await stat(source)).isDirectory()) throw new Error('Archive source must be a directory');
  const archive = requireAPI('archiver')('zip', { zlib: { level: 6 } });
  const archiveClosed = new Promise(resolveClose => { archive.once('close', resolveClose); });
  let rejectFailure;
  const failure = new Promise((_resolve, reject) => { rejectFailure = reject; });
  // Observe even a synchronous setup throw followed by a late producer error.
  // The original promise still rejects the operation through the race below.
  void failure.then(() => undefined, () => undefined);
  archive.on('error', rejectFailure);
  archive.on('warning', rejectFailure); // Missing/skipped entries, including ENOENT, are fatal.
  let outputStream;
  let outputClosed;
  try {
    outputStream = fs.createWriteStream(output, { flags: 'wx' });
    outputStream.on('error', rejectFailure);
    const finish = new Promise(resolveFinish => { outputStream.once('finish', resolveFinish); });
    outputClosed = new Promise(resolveClose => {
      outputStream.once('close', () => {
        if (!outputStream.writableFinished) rejectFailure(new Error('Archive output closed before finish'));
        resolveClose();
      });
    });
    archive.pipe(outputStream);
    const finalized = Promise.resolve().then(() => {
      archive.directory(source, packageName);
      return archive.finalize();
    });
    await Promise.race([failure, Promise.all([finalized, finish, outputClosed])]);
  } catch (error) {
    archive.abort();
    archive.destroy();
    outputStream?.destroy();
    await Promise.allSettled([archiveClosed, outputClosed]);
    throw error;
  }
}

async function writeTar(output, stagingParent, packageName) {
  const child = childProcess.spawn('tar', ['-czf', output, '-C', stagingParent, packageName],
    { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true, shell: false });
  const closed = new Promise(resolveClose => { child.once('close', resolveClose); });
  let diagnostic = ''; let tail = ''; let omittedData;
  const done = new Promise((resolveChild, rejectChild) => {
    child.once('error', rejectChild);
    child.stderr.once('error', rejectChild);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      const match = OMITTED_DATA.exec(tail + chunk);
      if (match) omittedData ??= match[0];
      tail = (tail + chunk).slice(-1024);
      diagnostic = (diagnostic + chunk).slice(-DIAGNOSTIC_LIMIT);
      process.stderr.write(chunk);
    });
    child.once('close', (code, signal) => {
      if (code !== 0 || signal || omittedData) rejectChild(new Error(`tar failed (exit=${code}, signal=${signal ?? 'none'})`
        + (omittedData ? `: ${omittedData}` : '') + (diagnostic ? `\n${diagnostic}` : '')));
      else resolveChild();
    });
  });
  try { await done; await closed; }
  catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await Promise.allSettled([done, closed]);
    throw error;
  }
}

/** Publish only complete output; never replace the existing artifact on producer/output failure. */
export async function createRuntimeArchive({ platform, archive, stagingParent, packageName }) {
  if (!['windows', 'linux'].includes(platform)) throw new Error('Runtime archives support only windows and linux');
  const destination = resolve(archive);
  const temporaryDirectory = await mkdtemp(join(dirname(destination), '.runtime-archive-'));
  try {
    const output = join(temporaryDirectory, basename(destination));
    if (platform === 'windows') await writeZip(output, stagingParent, packageName);
    else await writeTar(output, stagingParent, packageName);
    await rename(output, destination);
  } catch (error) {
    throw new Error(`Runtime archive failed: ${String(error)}`, { cause: error });
  } finally { await rm(temporaryDirectory, { recursive: true, force: true }); }
}
