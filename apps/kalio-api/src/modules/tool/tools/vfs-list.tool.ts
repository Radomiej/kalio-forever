import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';

@Injectable()
@Tool({
  name: 'vfs_list',
  domain: 'vfs',
  description: 'List all files in the conversation virtual filesystem, skipping generated directories like node_modules, dist, coverage, and reports.',
  parameters: {
    type: 'object',
    properties: {},
  },
})
export class VFSListTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<{ sessionId: string; files: { path: string; sizeBytes: number }[] }> {
    const sessionId = request.vfsSessionId ?? request.sessionId;
    const result = this.vfs.listFiles(sessionId);
    return {
      sessionId: result.sessionId,
      files: result.files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes })),
    };
  }
}
