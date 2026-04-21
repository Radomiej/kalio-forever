import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, normalize } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';

const MAX_BYTES = 512 * 1024; // 512 KB safety cap

@Injectable()
@Tool({
  name: 'fs_read',
  description: 'Read the contents of a file from the local filesystem. Path must be inside the allowed workspace root.',
  parameters: {
    type: 'object',
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Absolute or workspace-relative file path to read.' },
      startLine: { type: 'integer', description: 'Optional: 1-based start line (inclusive).' },
      endLine: { type: 'integer', description: 'Optional: 1-based end line (inclusive).' },
    },
  },
  requiresConfirmation: false,
})
export class FsReadTool {
  private readonly allowedRoot: string;

  constructor(private readonly config: ConfigService) {
    this.allowedRoot = resolve(this.config.get<string>('WORKSPACE_ROOT', './data/workspaces'));
  }

  async execute(request: ToolCallRequest): Promise<{ path: string; content: string; lines: number }> {
    const rawPath = request.args['path'] as string;
    const startLine = request.args['startLine'] as number | undefined;
    const endLine = request.args['endLine'] as number | undefined;

    const absPath = resolve(rawPath);
    if (!normalize(absPath).startsWith(this.allowedRoot)) {
      throw new Error(`ACCESS_DENIED: path is outside allowed workspace root`);
    }
    if (!existsSync(absPath)) throw new Error(`NOT_FOUND: ${rawPath}`);

    const stat = statSync(absPath);
    if (!stat.isFile()) throw new Error(`NOT_A_FILE: ${rawPath}`);
    if (stat.size > MAX_BYTES) throw new Error(`FILE_TOO_LARGE: ${stat.size} bytes exceeds 512KB limit`);

    const raw = readFileSync(absPath, 'utf8');
    const allLines = raw.split('\n');
    const total = allLines.length;

    if (startLine !== undefined || endLine !== undefined) {
      const s = (startLine ?? 1) - 1;
      const e = endLine ?? total;
      const slice = allLines.slice(s, e).join('\n');
      return { path: absPath, content: slice, lines: total };
    }
    return { path: absPath, content: raw, lines: total };
  }
}
