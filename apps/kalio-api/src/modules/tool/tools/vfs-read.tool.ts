import { Injectable } from '@nestjs/common';
import type { ToolCallRequest } from '@kalio/types';
import { Tool } from '../../../common/decorators/tool.decorator';
import { VFSService } from '../../vfs/vfs.service';

function getFilePathArg(args: ToolCallRequest['args']): string {
  const rawFilePath = args['filePath'];
  if (typeof rawFilePath !== 'string' || rawFilePath.trim().length === 0) {
    throw new Error('INVALID_FILE_PATH: filePath must be a non-empty string');
  }
  return rawFilePath.trim();
}

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
    const sessionId = request.vfsSessionId ?? request.sessionId;
    const filePath = getFilePathArg(request.args);
    const result = this.vfs.readFile(sessionId, filePath);
    return { filePath: result.filePath, content: result.content };
  }
}
