import { Injectable } from '@nestjs/common';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';

interface FileEntry {
  path: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
}

function walkDir(dir: string, root: string, maxDepth: number, depth: number): FileEntry[] {
  const entries: FileEntry[] = [];
  if (depth > maxDepth) return entries;
  const items = readdirSync(dir);
  for (const item of items) {
    const full = join(dir, item);
    const stat = statSync(full);
    const rel = relative(root, full);
    if (stat.isDirectory()) {
      entries.push({ path: rel, type: 'directory' });
      entries.push(...walkDir(full, root, maxDepth, depth + 1));
    } else {
      entries.push({ path: rel, type: 'file', sizeBytes: stat.size });
    }
  }
  return entries;
}

@Injectable()
@Tool({
  name: 'fs_list',
  description: 'List files and directories at a path inside an allowed directory.',
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

  async execute(request: ToolCallRequest): Promise<{ path: string; entries: FileEntry[] }> {
    const rawPath = request.args['path'] as string;
    const recursive = (request.args['recursive'] as boolean | undefined) ?? false;

    const absPath = resolve(rawPath);
    const allowed = await this.allowedPaths.isAllowed(absPath);
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: path is outside allowed roots`);
    }
    if (!existsSync(absPath)) throw new Error(`NOT_FOUND: ${rawPath}`);
    const stat = statSync(absPath);
    if (!stat.isDirectory()) throw new Error(`NOT_A_DIRECTORY: ${rawPath}`);

    const entries = walkDir(absPath, absPath, recursive ? 10 : 0, 0);
    return { path: absPath, entries };
  }
}
