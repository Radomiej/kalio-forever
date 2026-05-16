import { Injectable } from '@nestjs/common';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';

function getPathArg(args: ToolCallRequest['args']): string {
  const rawPath = args['path'];
  if (typeof rawPath !== 'string' || rawPath.trim().length === 0) {
    throw new Error('INVALID_PATH: path must be a non-empty string');
  }
  return rawPath.trim();
}

function getContentArg(args: ToolCallRequest['args']): string {
  const rawContent = args['content'];
  if (typeof rawContent !== 'string') {
    throw new Error('INVALID_CONTENT: content must be a string');
  }
  return rawContent;
}

@Injectable()
@Tool({
  name: 'fs_write',
  description: 'Write content to a file on the local filesystem. Path must be inside an allowed directory.',
  parameters: {
    type: 'object',
    required: ['path', 'content'],
    properties: {
      path: { type: 'string', description: 'Absolute or workspace-relative file path to write.' },
      content: { type: 'string', description: 'Text content to write.' },
    },
  },
  requiresConfirmation: true,
})
export class FsWriteTool {
  constructor(private readonly allowedPaths: AllowedPathsService) {}

  async execute(request: ToolCallRequest): Promise<{ path: string; bytesWritten: number }> {
    const rawPath = getPathArg(request.args);
    const content = getContentArg(request.args);

    const absPath = resolve(rawPath);
    const allowed = await this.allowedPaths.isAllowed(absPath, { allowMissingPath: true });
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: path is outside allowed roots`);
    }
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
    return { path: absPath, bytesWritten: Buffer.byteLength(content, 'utf8') };
  }
}
