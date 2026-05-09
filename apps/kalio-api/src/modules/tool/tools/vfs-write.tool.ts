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

function getContentArg(args: ToolCallRequest['args']): string {
  const rawContent = args['content'];
  if (typeof rawContent !== 'string') {
    throw new Error('INVALID_CONTENT: content must be a string');
  }
  return rawContent;
}

@Injectable()
@Tool({
  name: 'vfs_write',
  description: 'Write content to a file in the conversation virtual filesystem.',
  parameters: {
    type: 'object',
    required: ['filePath', 'content'],
    properties: {
      filePath: { type: 'string', description: 'Path relative to the workspace' },
      content:  { type: 'string', description: 'File content to write' },
    },
  },
  requiresConfirmation: true,
})
export class VFSWriteTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<{ path: string; bytesWritten: number }> {
    const sessionId = request.vfsSessionId ?? request.sessionId;
    const filePath = getFilePathArg(request.args);
    const content = getContentArg(request.args);
    await this.vfs.writeFile({ sessionId, filePath, content });
    return { path: filePath, bytesWritten: Buffer.byteLength(content, 'utf8') };
  }
}
