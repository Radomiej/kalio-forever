import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ToolMeta } from '@kalio/types';
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
    contextRegistry.activate({
      sessionId: 'session-dynamic',
      turnId: 'turn-2',
      promptMessageId: 'prompt-2',
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
    });
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
