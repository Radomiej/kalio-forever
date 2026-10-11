import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectContextPort, ToolCallRequest } from '@kalio/types';
import { TOOL_METADATA } from '../../../common/decorators/tool.decorator';
import { RefreshProjectContextTool, SearchProjectContextTool } from './project-context.tools';

describe('project context tools', () => {
  const request = (args: Record<string, unknown>) => ({ sessionId: 'persisted-session', args } as ToolCallRequest);
  it('requires confirmation for both tools', () => {
    for (const tool of [RefreshProjectContextTool, SearchProjectContextTool]) {
      expect(Reflect.getMetadata(TOOL_METADATA, tool).requiresConfirmation).toBe(true);
    }
  });
  it('passes session scope and per-call remote consent through the shared port', async () => {
    const port = { refreshForSession: vi.fn().mockResolvedValue({ indexedChunks: 1 }), searchForSession: vi.fn().mockResolvedValue([]) };
    await new RefreshProjectContextTool(port as ProjectContextPort).execute(request({ allowRemoteProcessing: true }));
    await new SearchProjectContextTool(port as ProjectContextPort).execute(request({ query: 'build', mode: 'fts' }));
    expect(port.refreshForSession).toHaveBeenCalledWith('persisted-session', { allowRemoteProcessing: true });
    expect(port.searchForSession).toHaveBeenCalledWith('persisted-session', { query: 'build', mode: 'fts' });
  });
  it('rejects caller project scope and malformed consent before dispatch', () => {
    const port = { refreshForSession: vi.fn(), searchForSession: vi.fn() };
    const tool = new RefreshProjectContextTool(port as unknown as ProjectContextPort);
    expect(() => tool.execute(request({ projectId: 'other' }))).toThrow('INVALID_RESOURCE_REQUEST');
    expect(() => tool.execute(request({ allowRemoteProcessing: 'true' }))).toThrow('INVALID_RESOURCE_REQUEST');
    expect(port.refreshForSession).not.toHaveBeenCalled();
  });
});
