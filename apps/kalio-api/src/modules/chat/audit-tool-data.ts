import type { ToolDomain, ToolMeta } from '@kalio/types';

type ToolAuditDomain = 'subagent' | 'architecture' | 'code_intelligence' | 'vfs' | 'file' | 'generic';
type ToolAuditMeta = Pick<ToolMeta, 'domain'>;

const SUBAGENT_TOOL_NAMES = new Set(['run_subagent', 'spawn_subagent', 'message_subagent']);
const VFS_TOOL_NAMES = new Set([
  'vfs_delete',
  'vfs_list',
  'vfs_read',
  'vfs_search',
  'vfs_write',
]);
const FILE_TOOL_NAMES = new Set([
  'file_search',
  'fs_list',
  'fs_read',
  'fs_search',
  'fs_write',
  'grep_search',
]);

export function toAuditToolCallData(
  callId: string,
  toolName: string,
  args: Record<string, unknown>,
  toolMeta?: ToolAuditMeta,
): Record<string, unknown> {
  const data = toolAuditBase(callId, toolName, args, toolMeta);
  if (data['domain'] === 'subagent') {
    data['kind'] = 'subagent_tool_call';
    data['subagent'] = {
      childSessionId: args['childSessionId'],
      parentSessionId: args['parentSessionId'],
      vfsMode: args['vfsMode'],
      architectureRunId: args['architectureRunId'],
      nodeId: args['nodeId'],
      roleSlotId: args['roleSlotId'],
    };
  } else if (isVfsOrFileTool(toolName, toolMeta)) {
    data['kind'] = 'file_tool_call';
    data['fileTool'] = summarizeFileToolArgs(toolName, args);
  }
  return data;
}

export function toAuditToolResultData(
  callId: string,
  toolName: string,
  result: { status: string; data?: unknown; errorMessage?: string },
  args?: Record<string, unknown>,
  toolMeta?: ToolAuditMeta,
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...toolAuditBase(callId, toolName, args, toolMeta), status: result.status };
  if (typeof result.errorMessage === 'string' && result.errorMessage.trim().length > 0) {
    data['errorMessage'] = result.errorMessage;
  }
  if (
    isSubagentTool(toolName, toolMeta)
    && result.data
    && typeof result.data === 'object'
  ) {
    const subagent = result.data as Record<string, unknown>;
    data['kind'] = 'subagent_tool_result';
    data['subagent'] = {
      taskId: subagent['taskId'],
      childSessionId: subagent['childSessionId'],
      parentSessionId: subagent['parentSessionId'],
      vfsSessionId: subagent['vfsSessionId'],
      vfsMode: subagent['vfsMode'],
      copiedFiles: subagent['copiedFiles'],
    };
  }
  if (isVfsOrFileTool(toolName, toolMeta)) {
    const fileData = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    data['kind'] = 'file_tool_result';
    data['fileTool'] = summarizeFileToolResult(toolName, fileData, args);
    if (typeof fileData['omitted'] === 'number' && fileData['omitted'] > 0) {
      data['omitted'] = fileData['omitted'];
    }
  }
  return data;
}

function toolAuditBase(
  callId: string,
  toolName: string,
  args: Record<string, unknown> | undefined,
  toolMeta: ToolAuditMeta | undefined,
): Record<string, unknown> {
  const domain = toolAuditDomain(toolName, args, toolMeta?.domain);
  return {
    callId,
    domain,
    args,
    architectureRunId: typeof args?.['architectureRunId'] === 'string' ? args['architectureRunId'] : undefined,
  };
}

function toolAuditDomain(
  toolName: string,
  args: Record<string, unknown> | undefined,
  toolDomain: ToolDomain | undefined,
): ToolAuditDomain {
  const metaDomain = toolAuditDomainFromToolDomain(toolDomain);
  if (metaDomain === 'subagent' || SUBAGENT_TOOL_NAMES.has(toolName)) return 'subagent';
  if (typeof args?.['architectureRunId'] === 'string') return 'architecture';
  if (metaDomain) return metaDomain;
  if (VFS_TOOL_NAMES.has(toolName)) return 'vfs';
  if (FILE_TOOL_NAMES.has(toolName)) return 'file';
  return 'generic';
}

function toolAuditDomainFromToolDomain(toolDomain: ToolDomain | undefined): ToolAuditDomain | undefined {
  if (toolDomain === 'subagent') return 'subagent';
  if (toolDomain === 'architecture') return 'architecture';
  if (toolDomain === 'code_intelligence') return 'code_intelligence';
  if (toolDomain === 'vfs') return 'vfs';
  if (toolDomain === 'file_system' || toolDomain === 'file_search') return 'file';
  return undefined;
}

function isSubagentTool(toolName: string, toolMeta: ToolAuditMeta | undefined): boolean {
  return toolMeta?.domain === 'subagent' || SUBAGENT_TOOL_NAMES.has(toolName);
}

function isVfsOrFileTool(toolName: string, toolMeta: ToolAuditMeta | undefined): boolean {
  const domain = toolAuditDomain(toolName, undefined, toolMeta?.domain);
  return domain === 'vfs' || domain === 'file';
}

function summarizeFileToolArgs(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    toolName,
    path: args['path'] ?? args['filePath'] ?? args['vfsPath'] ?? args['targetPath'],
    query: args['query'] ?? args['pattern'],
  };
}

function summarizeFileToolResult(
  toolName: string,
  result: Record<string, unknown>,
  args: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const files = Array.isArray(result['files']) ? result['files'] : undefined;
  return {
    toolName,
    sessionId: result['sessionId'],
    path: result['path'] ?? result['filePath'] ?? result['vfsPath'] ?? args?.['path'] ?? args?.['filePath'] ?? args?.['vfsPath'] ?? args?.['targetPath'],
    fileCount: files?.length,
    omitted: result['omitted'],
  };
}
