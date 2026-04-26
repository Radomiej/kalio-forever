import { Injectable } from '@nestjs/common';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { AllowedPathsService } from '../../allowed-paths/allowed-paths.service';

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
    const rawPath = request.args['path'] as string;
    const content = request.args['content'] as string;

    const absPath = resolve(rawPath);
    const allowed = await this.allowedPaths.isAllowed(absPath);
    if (!allowed) {
      throw new Error(`ACCESS_DENIED: path is outside allowed roots`);
    }
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
    return { path: absPath, bytesWritten: Buffer.byteLength(content, 'utf8') };
  }
}
