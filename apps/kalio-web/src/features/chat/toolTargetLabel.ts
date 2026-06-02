const PATH_ARG_KEYS = ['filePath', 'path', 'vfsPath', 'targetPath', 'outputPath'] as const;

function readStringArg(args: Record<string, unknown> | undefined, key: string): string | null {
  const value = args?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function getToolTargetLabel(toolName: string, args: Record<string, unknown> | undefined): string | null {
  if (toolName === 'vfs_list') {
    return 'session VFS root';
  }

  if (toolName.startsWith('fs_')) {
    return readStringArg(args, 'path');
  }

  if (toolName === 'vfs_read' || toolName === 'vfs_write') {
    return readStringArg(args, 'filePath') ?? readStringArg(args, 'path');
  }

  for (const key of PATH_ARG_KEYS) {
    const value = readStringArg(args, key);
    if (value) {
      return value;
    }
  }

  return null;
}
