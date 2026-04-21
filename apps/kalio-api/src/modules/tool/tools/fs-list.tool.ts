import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, normalize, relative, join } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';

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
  description: 'List files and directories at a path inside the allowed workspace root.',
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
  private readonly allowedRoot: string;

  constructor(private readonly config: ConfigService) {
    this.allowedRoot = resolve(this.config.get<string>('WORKSPACE_ROOT', './data/workspaces'));
  }

  async execute(request: ToolCallRequest): Promise<{ path: string; entries: FileEntry[] }> {
    const rawPath = request.args['path'] as string;
    const recursive = (request.args['recursive'] as boolean | undefined) ?? false;

    const absPath = resolve(rawPath);
    if (!normalize(absPath).startsWith(this.allowedRoot)) {
      throw new Error(`ACCESS_DENIED: path is outside allowed workspace root`);
    }
    if (!existsSync(absPath)) throw new Error(`NOT_FOUND: ${rawPath}`);
    const stat = statSync(absPath);
    if (!stat.isDirectory()) throw new Error(`NOT_A_DIRECTORY: ${rawPath}`);

    const entries = walkDir(absPath, absPath, recursive ? 10 : 0, 0);
    return { path: absPath, entries };
  }
}
