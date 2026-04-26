import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';

@Injectable()
@Tool({
  name: 'vfs_read',
  description: 'Read the contents of a file from the conversation virtual filesystem.',
  parameters: {
    type: 'object',
    required: ['filePath'],
    properties: {
      filePath: { type: 'string', description: 'Path relative to the workspace' },
    },
  },
})
export class VFSReadTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<{ filePath: string; content: string }> {
    const { sessionId } = request;
    const filePath = request.args['filePath'] as string;
    const result = this.vfs.readFile(sessionId, filePath);
    return { filePath: result.filePath, content: result.content };
  }
}
