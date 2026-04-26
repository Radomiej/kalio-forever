import { Injectable, Logger } from '@nestjs/common';
import type { ToolCallRequest, ToolResult } from '@kalio/types';
import { ToolRegistryService } from './tool-registry.service';
import { VFSWriteTool } from './tools/vfs-write.tool';
import { VFSReadTool } from './tools/vfs-read.tool';
import { VFSListTool } from './tools/vfs-list.tool';
import { SubagentTool } from './tools/subagent.tool';
import { FsReadTool } from './tools/fs-read.tool';
import { FsListTool } from './tools/fs-list.tool';
import { FsWriteTool } from './tools/fs-write.tool';
import { KVWriteTool, KVReadTool, KVListTool, KVDeleteTool } from './tools/kv.tools';
import { GrepSearchTool, FileSearchTool } from './tools/file-search.tools';
import { TerminalSpawnTool, TerminalListTool, TerminalOutputTool, TerminalKillTool } from './tools/terminal.tools';
import { RaAppCreateTool, RaAppCompileTool, RunRaAppTool, ListRaAppsTool } from './tools/raapp.tools';
import { MemoryIngestTool, MemorySearchTool, MemoryIngestConversationTool } from './tools/memory.tools';
import { MCPService } from '../mcp/mcp.service';

type ToolExecutor = { execute(req: ToolCallRequest): Promise<unknown> };

@Injectable()
export class ToolDispatchService {
  private readonly logger = new Logger(ToolDispatchService.name);
  private readonly executors: Map<string, ToolExecutor>;

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly mcpService: MCPService,
    vfsWriteTool: VFSWriteTool,
    vfsReadTool: VFSReadTool,
    vfsListTool: VFSListTool,
    subagentTool: SubagentTool,
    fsReadTool: FsReadTool,
    fsListTool: FsListTool,
    fsWriteTool: FsWriteTool,
    kvWriteTool: KVWriteTool,
    kvReadTool: KVReadTool,
    kvListTool: KVListTool,
    kvDeleteTool: KVDeleteTool,
    grepSearchTool: GrepSearchTool,
    fileSearchTool: FileSearchTool,
    terminalSpawnTool: TerminalSpawnTool,
    terminalListTool: TerminalListTool,
    terminalOutputTool: TerminalOutputTool,
    terminalKillTool: TerminalKillTool,
    raAppCreateTool: RaAppCreateTool,
    raAppCompileTool: RaAppCompileTool,
    runRaAppTool: RunRaAppTool,
    listRaAppsTool: ListRaAppsTool,
    memoryIngestTool: MemoryIngestTool,
    memorySearchTool: MemorySearchTool,
    memoryIngestConversationTool: MemoryIngestConversationTool,
  ) {
    this.executors = new Map<string, ToolExecutor>([
      ['vfs_write', vfsWriteTool],
      ['vfs_read', vfsReadTool],
      ['vfs_list', vfsListTool],
      ['run_subagent', subagentTool],
      ['fs_read', fsReadTool],
      ['fs_list', fsListTool],
      ['fs_write', fsWriteTool],
      ['kv_write', kvWriteTool],
      ['kv_read', kvReadTool],
      ['kv_list', kvListTool],
      ['kv_delete', kvDeleteTool],
      ['grep_search', grepSearchTool],
      ['file_search', fileSearchTool],
      ['terminal_spawn', terminalSpawnTool],
      ['terminal_list', terminalListTool],
      ['terminal_output', terminalOutputTool],
      ['terminal_kill', terminalKillTool],
      ['raapp_create', raAppCreateTool],
      ['raapp_compile', raAppCompileTool],
      ['run_raapp', runRaAppTool],
      ['list_raapps', listRaAppsTool],
      ['memory_ingest', memoryIngestTool],
      ['memory_search', memorySearchTool],
      ['memory_ingest_conversation', memoryIngestConversationTool],
    ]);
  }

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

    // Handle MCP tools (prefix: mcp_{serverId}_{toolName})
    if (request.toolName.startsWith('mcp_')) {
      const resolved = this.mcpService.resolveToolName(request.toolName);
      if (!resolved) {
        return {
          callId: request.callId,
          status: 'error',
          errorCode: 'TOOL_NOT_FOUND',
          errorMessage: `MCP tool "${request.toolName}" not found`,
        };
      }

      try {
        const data = await this.mcpService.callTool(resolved.serverId, resolved.originalName, request.args);
        return { callId: request.callId, status: 'success', data };
      } catch (err) {
        this.logger.error(`[ToolDispatch] MCP tool "${request.toolName}" failed`, err);
        return {
          callId: request.callId,
          status: 'error',
          errorCode: 'TOOL_EXEC_ERROR',
          errorMessage: err instanceof Error ? err.message : 'Unknown MCP error',
        };
      }
    }

    // Handle native tools
    const tool = this.executors.get(request.toolName);
    if (!tool) {
      return {
        callId: request.callId,
        status: 'error',
        errorCode: 'TOOL_NOT_FOUND',
        errorMessage: `Tool "${request.toolName}" has no executor`,
      };
    }

    try {
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
}
