import type { VFSService } from '../vfs/vfs.service';

export interface ArchitectureVfsHydration {
  fromSessionId: string;
  targetPrefix: string;
  filePaths?: string[];
}

export interface ArchitectureVfsHydrationResult {
  copiedFiles: Array<{ fromPath: string; toPath: string; sizeBytes: number }>;
  fromSessionId: string;
  requestedPaths: string[];
  skippedPaths: string[];
  targetPrefix: string;
}

const DEFAULT_TARGET_PREFIX = 'project';

export function parseArchitectureVfsHydration(
  context: Record<string, unknown> | undefined,
): ArchitectureVfsHydration | null {
  const fromSessionId = context?.['hydrateFromSessionId'];
  if (typeof fromSessionId !== 'string' || fromSessionId.trim().length === 0) {
    return null;
  }
  const targetPrefix = context?.['hydrateTargetPrefix'];
  const filePaths = context?.['hydrateFilePaths'];
  return {
    fromSessionId: fromSessionId.trim(),
    targetPrefix: typeof targetPrefix === 'string' && targetPrefix.trim().length > 0
      ? targetPrefix.trim()
      : DEFAULT_TARGET_PREFIX,
    ...(Array.isArray(filePaths)
      ? { filePaths: filePaths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0).map((path) => path.trim()) }
      : {}),
  };
}

export function hydrateArchitectureRootVfs(
  vfs: VFSService | undefined,
  rootSessionId: string,
  context: Record<string, unknown> | undefined,
): ArchitectureVfsHydrationResult | null {
  const hydration = parseArchitectureVfsHydration(context);
  if (!hydration || !vfs) {
    return null;
  }
  if (hydration.filePaths?.length) {
    return copySelectedHydrationFiles(vfs, hydration, rootSessionId);
  }
  return {
    copiedFiles: vfs.copySessionFiles({
      fromSessionId: hydration.fromSessionId,
      toSessionId: rootSessionId,
      targetPrefix: hydration.targetPrefix,
    }),
    fromSessionId: hydration.fromSessionId,
    requestedPaths: [],
    skippedPaths: [],
    targetPrefix: hydration.targetPrefix,
  };
}

function copySelectedHydrationFiles(
  vfs: VFSService,
  hydration: ArchitectureVfsHydration,
  rootSessionId: string,
): ArchitectureVfsHydrationResult {
  const sourcePaths = new Set(vfs.listFiles(hydration.fromSessionId).files.map((file) => file.path));
  const copiedFiles: ArchitectureVfsHydrationResult['copiedFiles'] = [];
  const skippedPaths: string[] = [];
  for (const requestedPath of hydration.filePaths ?? []) {
    const sourcePath = sourcePaths.has(normalizeVfsPath(requestedPath))
      ? normalizeVfsPath(requestedPath)
      : stripTargetPrefix(requestedPath, hydration.targetPrefix);
    const targetPath = normalizeVfsPath(requestedPath).startsWith(`${normalizeVfsPath(hydration.targetPrefix)}/`)
      ? normalizeVfsPath(requestedPath)
      : `${normalizeVfsPath(hydration.targetPrefix)}/${normalizeVfsPath(requestedPath)}`;
    try {
      const buffer = vfs.readBinary(hydration.fromSessionId, sourcePath);
      vfs.writeBinary(rootSessionId, targetPath, buffer);
      copiedFiles.push({ fromPath: sourcePath, toPath: targetPath, sizeBytes: buffer.length });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'VFS_FILE_NOT_FOUND' || code === 'ENOENT') {
        skippedPaths.push(requestedPath);
        continue;
      }
      throw err;
    }
  }
  return {
    copiedFiles,
    fromSessionId: hydration.fromSessionId,
    requestedPaths: hydration.filePaths ?? [],
    skippedPaths,
    targetPrefix: hydration.targetPrefix,
  };
}

function normalizeVfsPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function stripTargetPrefix(filePath: string, targetPrefix: string): string {
  const normalizedPrefix = targetPrefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/g, '');
  return normalizedPath.startsWith(`${normalizedPrefix}/`)
    ? normalizedPath.slice(normalizedPrefix.length + 1)
    : normalizedPath;
}
