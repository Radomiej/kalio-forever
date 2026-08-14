import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function isInsideDirectory(directory, target) {
  const relativePath = relative(directory, target);
  return relativePath.length > 0 && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function backupTimestamp(now) {
  return now.toISOString().replace(/[.:]/g, '-');
}

export function resetDatabase({
  databasePath,
  repositoryRoot,
  confirmed,
  managedDataDirectories,
  now = new Date(),
}) {
  if (!confirmed) {
    throw new Error('Database reset requires the --confirm-reset flag.');
  }

  const resolvedRepositoryRoot = resolve(repositoryRoot);
  const allowedDataDirectories = (managedDataDirectories ?? [join(resolvedRepositoryRoot, 'data')])
    .map((directory) => resolve(directory));
  const resolvedDatabasePath = resolve(resolvedRepositoryRoot, databasePath);
  const dataDirectory = allowedDataDirectories.find((directory) => isInsideDirectory(directory, resolvedDatabasePath));

  if (!dataDirectory) {
    throw new Error(`Database path must be inside a managed data directory: ${allowedDataDirectories.join(', ')}.`);
  }
  if (extname(resolvedDatabasePath) !== '.db') {
    throw new Error('Database path must end with .db.');
  }
  if (!existsSync(resolvedDatabasePath)) {
    throw new Error(`Database does not exist: ${resolvedDatabasePath}`);
  }

  const sourceFiles = [
    resolvedDatabasePath,
    `${resolvedDatabasePath}-wal`,
    `${resolvedDatabasePath}-shm`,
  ].filter((filePath) => existsSync(filePath));
  const databaseName = basename(resolvedDatabasePath, extname(resolvedDatabasePath));
  const backupDirectory = join(dataDirectory, 'backups', databaseName, backupTimestamp(now));

  mkdirSync(backupDirectory, { recursive: true });
  try {
    for (const sourceFile of sourceFiles) {
      copyFileSync(sourceFile, join(backupDirectory, basename(sourceFile)));
    }
  } catch (error) {
    rmSync(backupDirectory, { recursive: true, force: true });
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Database backup failed; reset was not performed: ${message}`, { cause: error });
  }

  for (const sourceFile of sourceFiles) {
    rmSync(sourceFile);
  }

  return { backupDirectory, sourceFiles };
}

export function parseArguments(args) {
  let databasePath;
  let confirmed = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      continue;
    }
    if (argument === '--database') {
      databasePath = args[index + 1];
      index += 1;
    } else if (argument === '--confirm-reset') {
      confirmed = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!databasePath) {
    throw new Error('Usage: pnpm db:reset -- --database data/kalio.db --confirm-reset');
  }

  return { databasePath, confirmed };
}

function getManagedDataDirectories(repositoryRoot) {
  const localAppData = process.env.LOCALAPPDATA
    ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local');
  return [
    join(repositoryRoot, 'data'),
    join(localAppData, 'kalio-forever-dev'),
  ];
}

function main() {
  const { databasePath, confirmed } = parseArguments(process.argv.slice(2));
  const result = resetDatabase({
    databasePath,
    repositoryRoot: process.cwd(),
    confirmed,
    managedDataDirectories: getManagedDataDirectories(process.cwd()),
  });
  console.log(`Backed up ${result.sourceFiles.length} SQLite file(s) to ${result.backupDirectory}`);
  console.log(`Removed ${databasePath}. Start Kalio to create a fresh database through migrations.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
