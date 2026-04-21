import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, normalize, dirname } from 'node:path';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';

@Injectable()
@Tool({
  name: 'fs_write',
  description: 'Write content to a file on the local filesystem. Path must be inside the allowed workspace root.',
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
  private readonly allowedRoot: string;

  constructor(private readonly config: ConfigService) {
    this.allowedRoot = resolve(this.config.get<string>('WORKSPACE_ROOT', './data/workspaces'));
  }

  async execute(request: ToolCallRequest): Promise<{ path: string; bytesWritten: number }> {
    const rawPath = request.args['path'] as string;
    const content = request.args['content'] as string;

    const absPath = resolve(rawPath);
    if (!normalize(absPath).startsWith(this.allowedRoot)) {
      throw new Error(`ACCESS_DENIED: path is outside allowed workspace root`);
    }
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, 'utf8');
    return { path: absPath, bytesWritten: Buffer.byteLength(content, 'utf8') };
  }
}
