import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';

@Injectable()
@Tool({
  name: 'vfs_list',
  description: 'List all files in the conversation virtual filesystem.',
  parameters: {
    type: 'object',
    properties: {},
  },
})
export class VFSListTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<{ conversationId: string; files: { path: string; sizeBytes: number }[] }> {
    const { conversationId } = request;
    const result = this.vfs.listFiles(conversationId);
    return {
      conversationId: result.conversationId,
      files: result.files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes })),
    };
  }
}
