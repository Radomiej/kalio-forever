import { describe, expect, it, vi } from 'vitest';
import type { ToolCallRequest } from '@kalio/types';
import { CodeIntelligenceService } from './code-intelligence.service';

function request(args: Record<string, unknown>): ToolCallRequest {
  return { sessionId: 'session-1', toolName: 'ide_query', args, callId: 'call-1' };
}

describe('CodeIntelligenceService', () => {
  it('normalizes a bridge query into the Kalio result contract', async () => {
    const runtimes = {
      query: vi.fn().mockResolvedValue({ items: [{ path: 'src/main.ts', line: 4 }], truncated: true }),
    };
    const service = new CodeIntelligenceService(runtimes as never);

    await expect(service.executeQuery(request({ operation: 'workspace_symbols', query: 'ChatService' }))).resolves.toEqual({
      operation: 'workspace_symbols',
      items: [{ path: 'src/main.ts', line: 4 }],
      locations: [{ path: 'src/main.ts', line: 4, column: undefined }],
      truncated: true,
      backend: 'vscode_bridge',
    });
    expect(runtimes.query).toHaveBeenCalledWith('session-1', expect.objectContaining({ operation: 'workspace_symbols', query: 'ChatService' }));
  });

  it('rejects malformed diagnostics scope before contacting the runtime', async () => {
    const runtimes = { diagnostics: vi.fn() };
    const service = new CodeIntelligenceService(runtimes as never);

    await expect(service.executeDiagnostics(request({ scope: 'all' }))).rejects.toMatchObject({ code: 'IDE_QUERY_INVALID' });
    expect(runtimes.diagnostics).not.toHaveBeenCalled();
  });

  it('does not expose project root through the agent status tool', async () => {
    const runtimes = {
      resolveSessionScope: vi.fn().mockResolvedValue({ projectId: 'project-1' }),
      statusForProject: vi.fn().mockResolvedValue({ projectId: 'project-1', projectName: 'Kalio', canonicalRoot: 'C:/secret', lifecycle: 'ready', enabled: true, trustAcknowledged: true, workspaceTrusted: true, bridgeCompatible: true, ownership: 'managed', languages: [], capabilities: [] }),
    };
    const service = new CodeIntelligenceService(runtimes as never);

    const result = await service.executeStatus(request({}));
    expect(result).not.toHaveProperty('canonicalRoot');
    expect(result).not.toHaveProperty('projectName');
    expect(result).toMatchObject({ lifecycle: 'ready', ownership: 'managed' });
  });
});
