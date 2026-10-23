import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolMeta, ToolResult } from '@kalio/types';
import type { ToolDispatchService } from '../chat/tool-dispatch.service';
import { KalioMcpBridgeContextRegistry } from '../../common/kalio-mcp-bridge-context';
import { KalioMcpBridgeHttpError, KalioMcpBridgeService } from './kalio-mcp-bridge.service';

const tools: ToolMeta[] = [
  {
    name: 'vfs_read',
    description: 'Read a session file.',
    parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
    requiresConfirmation: false,
  },
  {
    name: 'run_cli_agent',
    description: 'Child CLI execution must stay outside native runtime bridges.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: true,
  },
  {
    name: 'vfs_write',
    description: 'Write a session file after Kalio confirmation.',
    parameters: { type: 'object', properties: { filePath: { type: 'string' } } },
    requiresConfirmation: true,
  },
  {
    name: 'mcp_playwright_browser_click',
    description: 'External MCP tools must not be exposed through the Devin native bridge.',
    domain: 'mcp',
    parameters: { type: 'object', properties: { selector: { type: 'string' } } },
    requiresConfirmation: true,
  },
];

describe('KalioMcpBridgeService', () => {
  let bridge: KalioMcpBridgeService;
  let httpServer: ReturnType<typeof createServer>;
  let baseUrl: string;
  let contextRegistry: KalioMcpBridgeContextRegistry;
  let emitSessionEvent: ReturnType<typeof vi.fn>;
  let dispatchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    process.env['KALIO_MCP_BRIDGE_TOKEN'] = 'test-bridge-token';
    emitSessionEvent = vi.fn();
    dispatchSpy = vi.fn(async (
      callId: string,
      toolName: string,
      args: Record<string, unknown>,
      ctx: {
        sessionId: string;
        turnId?: string;
        promptMessageId?: string;
        emit: (event: string, data: unknown) => void;
      },
    ) => {
      if (toolName === 'vfs_write') {
        ctx.emit('tool:confirmation_required', {
          requestId: 'approval-1',
          toolCallId: callId,
          sessionId: ctx.sessionId,
          toolName,
          args,
          timeoutMs: 0,
        });
      }
      return {
        callId,
        status: 'success' as const,
        data: { args, sessionId: ctx.sessionId, turnId: ctx.turnId, promptMessageId: ctx.promptMessageId },
      };
    });
    const dispatch = {
      getToolMetas: vi.fn(() => tools),
      dispatch: dispatchSpy,
    } as unknown as ToolDispatchService;
    contextRegistry = new KalioMcpBridgeContextRegistry();
    bridge = new KalioMcpBridgeService(dispatch, {
      getToken: vi.fn(async () => process.env['KALIO_MCP_BRIDGE_TOKEN'] ?? null),
    } as never, contextRegistry, { emitSessionEvent } as never);
    httpServer = createServer((request, response) => {
      void bridge.handleRequest(request, response).catch((error) => {
        const status = error instanceof KalioMcpBridgeHttpError ? error.statusCode : 500;
        response.statusCode = status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      });
    });
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
    baseUrl = `http://127.0.0.1:${address.port}/api/mcp/bridge`;
  });

  afterEach(async () => {
    await bridge.close();
    await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
  });

  it('authorizes the bridge and keeps child CLI execution out of the native tool surface', async () => {
    const client = new Client({ name: 'kalio-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: 'Bearer test-bridge-token', 'x-kalio-session-id': 'session-1' } },
    });
    await client.connect(transport);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['vfs_read']);
    const result = await client.callTool({ name: 'vfs_read', arguments: { filePath: 'notes.txt' } });
    expect(result).toMatchObject({ content: [{ type: 'text' }] });
    const textContent = findTextContent(result.content);
    expect(textContent).toBeDefined();
    expect(JSON.parse(textContent?.text ?? '')).toEqual({
      args: { filePath: 'notes.txt' },
      sessionId: 'session-1',
    });
    await client.close();
  });

  it('preserves a long file result including its tail over the real HTTP MCP transport', async () => {
    const content = Array.from({ length: 461 }, (_, index) => `${index + 1}: zażółć gęślą jaźń`).join('\n');
    dispatchSpy.mockImplementationOnce(async (callId: string) => ({
      callId, status: 'success' as const, data: { path: 'fixture.jsx', lines: 461, content },
    }));
    const client = new Client({ name: 'full-file-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: { Authorization: 'Bearer test-bridge-token', 'x-kalio-session-id': 'session-1' } },
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'vfs_read', arguments: { filePath: 'fixture.jsx' } });
      const text = findTextContent(result.content);
      expect(JSON.parse(text?.text ?? '')).toEqual({ path: 'fixture.jsx', lines: 461, content });
      expect(text?.text).toContain('461: zażółć gęślą jaźń');
    } finally {
      await client.close();
    }
  });

  describe.each(['standalone', 'managed'] as const)('tool result serialization (%s)', (mode) => {
    it.each([
      { callId: 'cancelled-no-reason', status: 'cancelled' },
      { callId: 'cancelled-with-reason', status: 'cancelled', errorMessage: 'Approval expired.', errorCode: 'APPROVAL_EXPIRED', data: { executed: false } },
      { callId: 'cancelled-code-only', status: 'cancelled', errorCode: 'CLI_AGENT_STOPPED' },
      { callId: 'cancelled-with-failure', status: 'cancelled', failure: { code: 'TIMEOUT', source: 'approval', retryable: false, message: 'Approval expired.' } },
    ] satisfies ToolResult[])('preserves cancelled results: $callId', async (toolResult) => {
      const dispatch = vi.fn(async () => toolResult);
      if (mode === 'managed') {
        contextRegistry.activate({ sessionId: 'session-result', dispatchNativeTool: dispatch });
      } else {
        dispatchSpy.mockImplementationOnce(dispatch);
      }
      const client = new Client({ name: 'cancelled-result-test', version: '1.0.0' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl), {
          requestInit: { headers: {
            Authorization: 'Bearer test-bridge-token', 'x-kalio-session-id': 'session-result',
            ...(mode === 'managed' ? { 'x-kalio-bridge-client': 'devin-acp' } : {}),
          } },
        }));
        const result = await client.callTool({ name: 'vfs_read', arguments: { filePath: 'notes.txt' } });
        expect(result.isError).toBeUndefined();
        expect(JSON.parse(findTextContent(result.content)?.text ?? '')).toEqual(toolResult);
        expect(dispatch).toHaveBeenCalledTimes(1);
      } finally {
        await client.close();
      }
    });
  });

  it.each([
    [{ errorMessage: 'Read failed.', errorCode: 'READ_FAILED' }, 'Read failed.'],
    [{ errorCode: 'READ_FAILED' }, 'READ_FAILED'],
    [{}, 'Kalio tool failed.'],
  ] as const)('keeps error result compatibility (%j)', async (details, expectedText) => {
    dispatchSpy.mockImplementationOnce(async (callId: string): Promise<ToolResult> => ({ callId, status: 'error', ...details }));
    const client = new Client({ name: 'error-result-test', version: '1.0.0' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl), {
        requestInit: { headers: { Authorization: 'Bearer test-bridge-token' } },
      }));
      const result = await client.callTool({ name: 'vfs_read', arguments: {} });
      expect(result).toEqual({ isError: true, content: [{ type: 'text', text: expectedText }] });
    } finally {
      await client.close();
    }
  });

  it('supports a caller tool allow-list without widening the default boundary', async () => {
    const client = new Client({ name: 'kalio-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: {
        headers: {
          Authorization: 'Bearer test-bridge-token',
          'x-kalio-session-id': 'session-2',
          'x-kalio-tool-names': 'vfs_read,run_cli_agent,mcp_playwright_browser_click',
        },
      },
    });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['vfs_read']);
    const result = await client.callTool({ name: 'mcp_playwright_browser_click', arguments: { selector: 'button' } });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text' }] });
    expect(dispatchSpy).not.toHaveBeenCalled();
    await client.close();
  });

  it('requires an explicit allow-list before exposing confirmation-gated native tools', async () => {
    const client = new Client({ name: 'kalio-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: {
        headers: {
          Authorization: 'Bearer test-bridge-token',
          'x-kalio-session-id': 'session-3',
          'x-kalio-tool-names': 'vfs_read,vfs_write',
        },
      },
    });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(['vfs_read', 'vfs_write']);
    await client.close();
  });

  it('routes a confirmation request from an MCP tool call to the active Kalio session', async () => {
    const client = new Client({ name: 'kalio-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: {
        headers: {
          Authorization: 'Bearer test-bridge-token',
          'x-kalio-session-id': 'session-hitl',
          'x-kalio-tool-names': 'vfs_write',
        },
      },
    });
    await client.connect(transport);

    await client.callTool({ name: 'vfs_write', arguments: { filePath: 'qa.txt', content: 'safe test' } });

    expect(emitSessionEvent).toHaveBeenCalledWith(
      'session-hitl',
      'tool:start',
      expect.objectContaining({ sessionId: 'session-hitl', toolName: 'vfs_write', args: { filePath: 'qa.txt', content: 'safe test' } }),
    );
    const startIndex = emitSessionEvent.mock.calls.findIndex((call) => call[1] === 'tool:start');
    const approvalIndex = emitSessionEvent.mock.calls.findIndex((call) => call[1] === 'tool:confirmation_required');
    expect(startIndex).toBeLessThan(approvalIndex);
    expect(emitSessionEvent).toHaveBeenCalledWith(
      'session-hitl',
      'tool:confirmation_required',
      expect.objectContaining({ requestId: 'approval-1', toolName: 'vfs_write' }),
    );
    expect(emitSessionEvent).toHaveBeenCalledWith(
      'session-hitl',
      'tool:result',
      expect.objectContaining({ callId: expect.any(String), status: 'success' }),
    );
    await client.close();
  });

  it('keeps a human approval alive beyond the default MCP deadline without executing early', async () => {
    let approve: (() => void) | undefined;
    let executed = false;
    dispatchSpy.mockImplementationOnce(async (callId, toolName, args, ctx) => {
      ctx.emit('tool:confirmation_required', {
        requestId: 'long-approval', toolCallId: callId, sessionId: ctx.sessionId,
        toolName, args, timeoutMs: 0,
      });
      await new Promise<void>((resolve) => { approve = resolve; });
      executed = true;
      return { callId, status: 'success', data: { approved: true } };
    });
    const client = new Client({ name: 'long-approval-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: {
        Authorization: 'Bearer test-bridge-token', 'x-kalio-session-id': 'session-long-approval',
        'x-kalio-tool-names': 'vfs_write',
      } },
    });
    await client.connect(transport);
    const progress: string[] = [];
    const result = client.callTool({ name: 'vfs_write', arguments: { filePath: 'qa.txt' } }, undefined, {
      resetTimeoutOnProgress: true,
      onprogress: (event) => { if (event.message) progress.push(event.message); },
    }).then((value) => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 65_000));
      expect(executed).toBe(false);
      approve?.();
      const settled = await result;
      expect(settled.error).toBeUndefined();
      expect(settled.value).toMatchObject({ content: [{ type: 'text' }] });
      expect(progress.length).toBeGreaterThan(1);
      expect(executed).toBe(true);
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
    } finally {
      approve?.();
      await client.close();
    }
  }, 90_000);

  it('keeps an explicit empty allow-list closed instead of falling back to defaults', async () => {
    const client = new Client({ name: 'kalio-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: {
        headers: {
          Authorization: 'Bearer test-bridge-token',
          'x-kalio-session-id': 'session-4',
          'x-kalio-tool-names': '',
        },
      },
    });
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools).toEqual([]);
    await client.close();
  });

  it('uses the current Kalio turn context while reusing an ACP MCP session', async () => {
    const nativeDispatch = vi.fn(async (call: { id: string }) => ({
      callId: call.id, status: 'success' as const,
      data: { sessionId: 'session-dynamic', turnId: 'turn-2', promptMessageId: 'prompt-2', durable: true },
    }));
    contextRegistry.activate({
      sessionId: 'session-dynamic',
      turnId: 'turn-2',
      promptMessageId: 'prompt-2',
      dispatchNativeTool: nativeDispatch,
    });
    const client = new Client({ name: 'kalio-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: {
        headers: {
          Authorization: 'Bearer test-bridge-token',
          'x-kalio-session-id': 'session-dynamic',
          'x-kalio-tool-names': 'vfs_read',
          'x-kalio-bridge-client': 'devin-acp',
        },
      },
    });
    await client.connect(transport);
    const result = await client.callTool({ name: 'vfs_read', arguments: { filePath: 'notes.txt' } });
    const textContent = findTextContent(result.content);
    expect(JSON.parse(textContent?.text ?? '')).toMatchObject({
      sessionId: 'session-dynamic',
      turnId: 'turn-2',
      promptMessageId: 'prompt-2',
      durable: true,
    });
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(nativeDispatch).toHaveBeenCalledTimes(1);
    expect(emitSessionEvent).not.toHaveBeenCalled();
    await client.close();
  });

  it('does not bypass durable execution when a managed context has no runtime port', async () => {
    contextRegistry.activate({ sessionId: 'session-missing-port', turnId: 'real-turn', promptMessageId: 'real-prompt' });
    const client = new Client({ name: 'missing-port-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: { headers: {
        Authorization: 'Bearer test-bridge-token', 'x-kalio-session-id': 'session-missing-port',
        'x-kalio-tool-names': 'vfs_read', 'x-kalio-bridge-client': 'devin-acp',
      } },
    }));
    const result = await client.callTool({ name: 'vfs_read', arguments: { filePath: 'notes.txt' } });
    expect(result).toMatchObject({ isError: true });
    expect(findTextContent(result.content)?.text).toContain('durable');
    expect(dispatchSpy).not.toHaveBeenCalled();
    await client.close();
  });

  it('fails closed for managed runtimes without an active Kalio turn', async () => {
    const client = new Client({ name: 'kalio-bridge-test', version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(baseUrl), {
      requestInit: {
        headers: {
          Authorization: 'Bearer test-bridge-token',
          'x-kalio-session-id': 'session-no-active-turn',
          'x-kalio-tool-names': 'vfs_read',
          'x-kalio-bridge-client': 'devin-acp',
        },
      },
    });
    await client.connect(transport);
    const result = await client.callTool({ name: 'vfs_read', arguments: { filePath: 'notes.txt' } });
    expect(result).toMatchObject({ isError: true, content: [{ type: 'text' }] });
    expect(findTextContent(result.content)?.text).toContain('No active Kalio turn context');
    await client.close();
  });

  it('fails closed when no bridge token is configured', async () => {
    delete process.env['KALIO_MCP_BRIDGE_TOKEN'];
    const dispatch = { getToolMetas: vi.fn() } as unknown as ToolDispatchService;
    const unconfigured = new KalioMcpBridgeService(dispatch, {
      getToken: vi.fn(async () => null),
    } as never, new KalioMcpBridgeContextRegistry(), { emitSessionEvent: vi.fn() } as never);
    await expect(unconfigured.authorize({})).rejects.toThrowError(
      expect.objectContaining({ statusCode: 503 }),
    );
  });
});

function findTextContent(value: unknown): { type: 'text'; text: string } | undefined {
  if (!Array.isArray(value)) return undefined;
  const item = value.find((candidate) => isRecord(candidate) && candidate.type === 'text' && typeof candidate.text === 'string');
  return isRecord(item) && item.type === 'text' && typeof item.text === 'string'
    ? { type: 'text', text: item.text }
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
