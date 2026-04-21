import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';

@Injectable()
@Tool({
  name: 'vfs_write',
  description: 'Write content to a file in the conversation virtual filesystem.',
  parameters: {
    type: 'object',
    required: ['filePath', 'content'],
    properties: {
      filePath: { type: 'string', description: 'Path relative to the conversation workspace' },
      content:  { type: 'string', description: 'File content to write' },
    },
  },
  requiresConfirmation: true,
})
export class VFSWriteTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<{ path: string; bytesWritten: number }> {
    const { conversationId } = request;
    const filePath = request.args['filePath'] as string;
    const content = request.args['content'] as string;
    await this.vfs.writeFile({ conversationId, filePath, content });
    return { path: filePath, bytesWritten: Buffer.byteLength(content, 'utf8') };
  }
}
