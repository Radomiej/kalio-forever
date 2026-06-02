type ToolAuditDomain = 'subagent' | 'architecture' | 'vfs' | 'file' | 'generic';

export function toAuditToolCallData(callId: string, toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const data = toolAuditBase(callId, toolName, args);
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
  } else if (isVfsOrFileTool(toolName)) {
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
): Record<string, unknown> {
  const data: Record<string, unknown> = { ...toolAuditBase(callId, toolName, args), status: result.status };
  if (typeof result.errorMessage === 'string' && result.errorMessage.trim().length > 0) {
    data['errorMessage'] = result.errorMessage;
  }
  if (
    (toolName === 'run_subagent' || toolName === 'spawn_subagent' || toolName === 'message_subagent')
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
  if (isVfsOrFileTool(toolName)) {
    const fileData = result.data && typeof result.data === 'object' ? result.data as Record<string, unknown> : {};
    data['kind'] = 'file_tool_result';
    data['fileTool'] = summarizeFileToolResult(toolName, fileData, args);
    if (typeof fileData['omitted'] === 'number' && fileData['omitted'] > 0) {
      data['omitted'] = fileData['omitted'];
    }
  }
  return data;
}

function toolAuditBase(callId: string, toolName: string, args: Record<string, unknown> | undefined): Record<string, unknown> {
  const domain = toolAuditDomain(toolName, args);
  return {
    callId,
    domain,
    args,
    architectureRunId: typeof args?.['architectureRunId'] === 'string' ? args['architectureRunId'] : undefined,
  };
}

function toolAuditDomain(toolName: string, args: Record<string, unknown> | undefined): ToolAuditDomain {
  if (toolName === 'run_subagent' || toolName === 'spawn_subagent' || toolName === 'message_subagent') return 'subagent';
  if (typeof args?.['architectureRunId'] === 'string') return 'architecture';
  if (toolName.startsWith('vfs_')) return 'vfs';
  if (toolName.startsWith('fs_') || toolName.includes('file_search') || toolName.includes('grep')) return 'file';
  return 'generic';
}

function isVfsOrFileTool(toolName: string): boolean {
  const domain = toolAuditDomain(toolName, undefined);
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
