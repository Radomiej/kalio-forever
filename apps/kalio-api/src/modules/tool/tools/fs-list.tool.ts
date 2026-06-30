import { Injectable } from '@nestjs/common';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { shouldSkipTraversalDirectory } from '../../../common/utils/traversal-exclusions.util';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';

interface FileEntry {
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
}

const MAX_LIST_ENTRIES = 500;

function getPathArg(args: ToolCallRequest['args']): string {
  const rawPath = args['path'];
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error('INVALID_PATH: path must be a non-empty string');
  }
  return rawPath.trim();
}

function getRecursiveArg(args: ToolCallRequest['args']): boolean {
  const rawRecursive = args['recursive'];
  if (rawRecursive === undefined) {
    return false;
  }
  if (typeof rawRecursive !== 'boolean') {
    throw new Error('INVALID_RECURSIVE: recursive must be a boolean');
  }
  return rawRecursive;
}

function toEntryPath(path: string): string {
  return path.replace(/\\/g, '/');
}

function walkDir(
  dir: string,
  root: string,
  maxDepth: number,
  depth: number,
  state: { listed: number; omitted: number },
): FileEntry[] {
  const entries: FileEntry[] = [];
  if (depth > maxDepth) return entries;
  const items = readdirSync(dir);
  for (let index = 0; index < items.length; index++) {
    const item = items[index]!;
    if (maxDepth > 0 && shouldSkipTraversalDirectory(item)) {
      state.omitted++;
      continue;
    }
    if (state.listed >= MAX_LIST_ENTRIES) {
      state.omitted += items.length - index;
      break;
    }
    const full = join(dir, item);
    const stat = statSync(full);
    const rel = toEntryPath(relative(root, full));
    if (stat.isDirectory()) {
      entries.push({ path: rel, type: 'directory' });
      state.listed++;
      const childEntries = walkDir(full, root, maxDepth, depth + 1, state);
      entries.push(...childEntries);
    } else {
      entries.push({ path: rel, type: 'file', sizeBytes: stat.size });
      state.listed++;
    }
  }
  return entries;
}

@Injectable()
@Tool({
  name: 'fs_list',
  domain: 'file_system',
  description: 'List files and directories at a path inside an allowed directory. Recursive listings skip heavy generated folders like .git, node_modules, dist, output, reports, and cap results.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Absolute or workspace-relative path to list.' },
      recursive: { type: 'boolean', description: 'If true, list recursively (default: false).' },
    },
  },
  requiresConfirmation: false,
})
export class FsListTool {
  constructor(private readonly allowedPaths: AllowedPathsService) {}

  async execute(request: ToolCallRequest): Promise<{ path: string; entries: FileEntry[]; omitted: number }> {
    const rawPath = getPathArg(request.args);
    const recursive = getRecursiveArg(request.args);

    const absPath = resolve(rawPath);
    const allowed = await this.allowedPaths.isAllowed(absPath);
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: path is outside allowed roots`);
    }
    if (!existsSync(absPath)) throw new Error(`NOT_FOUND: ${rawPath}`);
    const stat = statSync(absPath);
    if (!stat.isDirectory()) throw new Error(`NOT_A_DIRECTORY: ${rawPath}`);

    const state = { listed: 0, omitted: 0 };
    const entries = walkDir(absPath, absPath, recursive ? 10 : 0, 0, state);
    return { path: absPath, entries, omitted: state.omitted };
  }
}
