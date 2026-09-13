import { describe, expect, it, vi } from 'vitest';
import type { IdeDiagnosticsRequest, IdeQueryRequest } from '@kalio/types';
import { ProjectIdeRuntimeManager } from './project-ide-runtime.manager';
import { VsCodeBridgeBackend } from './vscode-bridge.backend';

function makeManager() {
  const manager = new ProjectIdeRuntimeManager({} as never, {} as never, {} as never, new VsCodeBridgeBackend());
  const call = vi.fn().mockResolvedValue({ ok: true });
  (manager as unknown as { call: typeof call }).call = call;
  return { manager, call };
}

describe('ProjectIdeRuntimeManager bridge adapter', () => {
  it('maps a position definition to the read-only VS Code tool', async () => {
    const { manager, call } = makeManager();
    const request: IdeQueryRequest = { operation: 'definition', target: { path: 'src/app.ts', line: 4, column: 9 }, maxResults: 12 };

    await manager.query('session-1', request);

    expect(call).toHaveBeenCalledWith('session-1', 'go_to_definition', {
      file: 'src/app.ts', line: 4, column: 9, maxResults: 12,
    });
  });

  it('maps named symbol context and preserves disambiguation fields', async () => {
    const { manager, call } = makeManager();
    const request: IdeQueryRequest = {
      operation: 'references',
      target: { symbol: 'ChatService', path: 'src/chat.ts', container: 'modules.chat', kind: 'Class' },
      maxResults: 20,
    };

    await manager.query('session-1', request);

    expect(call).toHaveBeenCalledWith('session-1', 'find_references_for_symbol', {
      query: 'ChatService', file: 'src/chat.ts', containerName: 'modules.chat', kind: 'Class', maxResults: 20,
    });
  });

  it('maps public diagnostic limits and severities to the Bridge schema', async () => {
    const { manager, call } = makeManager();
    const request: IdeDiagnosticsRequest = { scope: 'project', severities: ['error', 'warning'], maxResults: 220 };

    await manager.diagnostics('session-1', request);

    expect(call).toHaveBeenCalledWith('session-1', 'diagnostics', {
      severities: ['Error', 'Warning'], maxFiles: 50, maxDiagnostics: 200,
    });
  });

  it('requires a symbol for incoming and outgoing call queries', async () => {
    const { manager, call } = makeManager();

    await expect(manager.query('session-1', { operation: 'incoming_calls', target: { path: 'src/app.ts', line: 1, column: 1 } })).rejects.toMatchObject({ code: 'IDE_QUERY_INVALID' });
    expect(call).not.toHaveBeenCalled();
  });
});
