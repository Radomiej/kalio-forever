import { Injectable } from '@nestjs/common';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';

const MAX_BYTES = 512 * 1024; // 512 KB safety cap

function getPathArg(args: ToolCallRequest['args']): string {
  const rawPath = args['path'];
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error('INVALID_PATH: path must be a non-empty string');
  }
  return rawPath.trim();
}

function getLineArg(args: ToolCallRequest['args'], key: 'startLine' | 'endLine'): number | undefined {
  const rawValue = args[key];
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== 'number' || !Number.isInteger(rawValue) || rawValue < 1) {
    throw new Error(`LINE_OUT_OF_RANGE: ${key} must be a positive integer`);
  }
  return rawValue;
}

@Injectable()
@Tool({
  name: 'fs_read',
  description: 'Read the contents of a file from the local filesystem. Path must be inside an allowed directory.',
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
  constructor(private readonly allowedPaths: AllowedPathsService) {}

  async execute(request: ToolCallRequest): Promise<{ path: string; content: string; lines: number }> {
    const rawPath = getPathArg(request.args);
    const startLine = getLineArg(request.args, 'startLine');
    const endLine = getLineArg(request.args, 'endLine');

    const absPath = resolve(rawPath);
    const allowed = await this.allowedPaths.isAllowed(absPath);
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: path is outside allowed roots`);
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
      if (e < s + 1) {
        throw new Error(`LINE_OUT_OF_RANGE: endLine ${endLine} is before startLine ${startLine ?? 1}`);
      }
      if (s >= total) {
        throw new Error(`LINE_OUT_OF_RANGE: startLine ${startLine ?? 1} exceeds file length (${total} lines)`);
      }
      if (e > total) {
        throw new Error(`LINE_OUT_OF_RANGE: endLine ${endLine} exceeds file length (${total} lines)`);
      }
      const slice = allLines.slice(s, e).join('\n');
      return { path: absPath, content: slice, lines: total };
    }
    return { path: absPath, content: raw, lines: total };
  }
}
