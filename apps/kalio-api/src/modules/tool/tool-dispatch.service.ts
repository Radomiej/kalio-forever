import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest, ToolResult } from '@kalio/types';
import { ToolRegistryService } from './tool-registry.service';
import { VFSWriteTool } from './tools/vfs-write.tool';

@Injectable()
export class ToolDispatchService {
  private readonly logger = new Logger(ToolDispatchService.name);

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly vfsWriteTool: VFSWriteTool,
  ) {}

  async dispatch(request: ToolCallRequest): Promise<ToolResult> {
    const meta = this.registry.getMeta(request.toolName);
    if (!meta) {
      return {
        callId: request.callId,
        status: 'error',
        errorCode: 'TOOL_NOT_FOUND',
        errorMessage: `Tool "${request.toolName}" is not registered`,
      };
    }

    try {
      const tool = this.resolveTool(request.toolName);
      if (!tool) {
        return {
          callId: request.callId,
          status: 'error',
          errorCode: 'TOOL_NOT_FOUND',
          errorMessage: `Tool "${request.toolName}" has no executor`,
        };
      }
      const data = await tool.execute(request);
      return { callId: request.callId, status: 'success', data };
    } catch (err) {
      this.logger.error(`[ToolDispatch] Tool "${request.toolName}" failed`, err);
      return {
        callId: request.callId,
        status: 'error',
        errorCode: 'TOOL_EXEC_ERROR',
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  private resolveTool(name: string): { execute(req: ToolCallRequest): Promise<unknown> } | null {
    const map: Record<string, { execute(req: ToolCallRequest): Promise<unknown> }> = {
      vfs_write: this.vfsWriteTool,
    };
    return map[name] ?? null;
  }
}
