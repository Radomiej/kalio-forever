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

function getModeArg(args: ToolCallRequest['args']): 'display' | 'interactive' {
  const rawMode = args['mode'];
  if (rawMode === undefined) return 'display';
  if (rawMode === 'display' || rawMode === 'interactive') {
    return rawMode;
  }
  throw new Error('INVALID_MODE: mode must be "display" or "interactive"');
}

@Injectable()
@Tool({
  name: 'design_preview',
  description: 'Preview an HTML file from the conversation virtual filesystem as an inline RA-App.',
  parameters: {
    type: 'object',
    required: ['filePath'],
    properties: {
      filePath: { type: 'string', description: 'Path to an .html file inside the session VFS' },
      mode: {
        type: 'string',
        enum: ['display', 'interactive'],
        description: 'Preview mode for the inline RA-App',
      },
    },
  },
})
export class DesignPreviewTool {
  constructor(private readonly vfs: VFSService) {}

  async execute(request: ToolCallRequest): Promise<{
    status: 'ready';
    type: 'html';
    mode: 'display' | 'interactive';
    content: string;
    vfsPath: string;
  } | {
    status: 'error';
    message: string;
  }> {
    const sessionId = request.vfsSessionId ?? request.sessionId;
    const filePath = getFilePathArg(request.args);
    const mode = getModeArg(request.args);

    if (!/\.html?$/i.test(filePath)) {
      throw new Error('INVALID_PREVIEW_FILE: filePath must point to an .html or .htm file');
    }

    try {
      this.vfs.readFile(sessionId, filePath);
    } catch (err) {
      return {
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    return {
      status: 'ready',
      type: 'html',
      mode,
      content: '',
      vfsPath: filePath,
    };
  }
}