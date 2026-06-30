import { describe, expect, it } from 'vitest';
import type { ToolMeta } from '@kalio/types';
import { toAuditToolResultData } from './audit-tool-data';

const typedTool = (domain: ToolMeta['domain']): Pick<ToolMeta, 'domain'> => ({ domain });

describe('audit tool data normalization', () => {
  it('marks text VFS read results as file tool results', () => {
    const data = toAuditToolResultData('call-1', 'vfs_read', {
      status: 'success',
      data: 'README content',
    });

    expect(data).toMatchObject({
      callId: 'call-1',
      domain: 'vfs',
      kind: 'file_tool_result',
      status: 'success',
      fileTool: {
        toolName: 'vfs_read',
      },
    });
  });

  it('preserves architecture run context on VFS result rows', () => {
    const data = toAuditToolResultData('call-1', 'vfs_read', {
      status: 'success',
      data: { path: 'project/README.md' },
    }, {
      filePath: 'project/README.md',
      architectureRunId: 'run-1',
      nodeId: 'analyst',
      roleSlotId: 'analyst',
    });

    expect(data).toMatchObject({
      callId: 'call-1',
      domain: 'architecture',
      architectureRunId: 'run-1',
      kind: 'file_tool_result',
      fileTool: {
        toolName: 'vfs_read',
        path: 'project/README.md',
      },
    });
  });

  it('keeps tool error messages on audit result rows', () => {
    const data = toAuditToolResultData('call-1', 'fs_write', {
      status: 'error',
      errorMessage: 'INVALID_JSON: malformed metadata.json',
    }, {
      path: 'metadata.json',
    });

    expect(data).toMatchObject({
      callId: 'call-1',
      domain: 'file',
      status: 'error',
      errorMessage: 'INVALID_JSON: malformed metadata.json',
      fileTool: {
        toolName: 'fs_write',
        path: 'metadata.json',
      },
    });
  });

  it('does not infer file domains from tool name prefixes or substrings', () => {
    expect(toAuditToolResultData('call-1', 'vfs_fake', { status: 'success' })).toMatchObject({
      callId: 'call-1',
      domain: 'generic',
      status: 'success',
    });
    expect(toAuditToolResultData('call-2', 'debug_grep_notes', { status: 'success' })).toMatchObject({
      callId: 'call-2',
      domain: 'generic',
      status: 'success',
    });
  });

  it('uses typed tool metadata as the source of file-tool audit classification', () => {
    const data = toAuditToolResultData('call-1', 'custom_reader', {
      status: 'success',
      data: { path: 'project/README.md' },
    }, {
      path: 'project/README.md',
    }, typedTool('vfs'));

    expect(data).toMatchObject({
      callId: 'call-1',
      domain: 'vfs',
      kind: 'file_tool_result',
      fileTool: {
        toolName: 'custom_reader',
        path: 'project/README.md',
      },
    });
  });
});
