import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { registerKalioBridgeProxy } from './kalio-mcp-bridge-proxy';

const clients: Client[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all([...clients.splice(0), ...servers.splice(0)].map((connection) => connection.close()));
});

async function connect(client: Client, server: Server): Promise<void> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  clients.push(client);
  servers.push(server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
}

async function setup() {
  const upstream = new Server({ name: 'kalio', version: '1' }, { capabilities: { tools: {} } });
  upstream.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  const remote = new Client({ name: 'proxy-remote', version: '1' });
  await connect(remote, upstream);
  const proxy = new Server({ name: 'proxy', version: '1' }, { capabilities: { tools: {} } });
  registerKalioBridgeProxy(remote, proxy);
  const downstream = new Client({ name: 'devin-test', version: '1' });
  await connect(downstream, proxy);
  return { upstream, downstream };
}

describe('Kalio stdio proxy lifecycle', () => {
  it('does not keep a silent hanging read alive indefinitely', async () => {
    const { upstream, downstream } = await setup();
    let started: (() => void) | undefined;
    const received = new Promise<void>((resolve) => { started = resolve; });
    upstream.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
      started?.();
      await new Promise<void>((resolve) => extra.signal.addEventListener('abort', () => resolve(), { once: true }));
      return { isError: true, content: [{ type: 'text', text: 'cancelled' }] };
    });
    vi.useFakeTimers();
    const result = downstream.callTool({ name: 'fs_read' }, undefined, { timeout: 120_000 })
      .then(() => false, () => true);
    await received;
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await result).toBe(true);
  });

  it('forwards approval progress with the downstream token and preserves the tool result', async () => {
    const { upstream, downstream } = await setup();
    upstream.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const token = request.params._meta?.progressToken;
      if (token !== undefined) await extra.sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress: 1, message: 'Awaiting human approval' },
      });
      return { content: [{ type: 'text', text: 'approved once' }] };
    });
    const progress: string[] = [];
    const result = await downstream.callTool({ name: 'fs_write' }, undefined, {
      onprogress: (event) => { if (event.message) progress.push(event.message); },
      resetTimeoutOnProgress: true,
    });
    expect(progress).toEqual(['Awaiting human approval']);
    expect(result).toMatchObject({ content: [{ type: 'text', text: 'approved once' }] });
  });

  it('propagates downstream cancellation to the pending upstream request', async () => {
    const { upstream, downstream } = await setup();
    let started: (() => void) | undefined;
    const received = new Promise<void>((resolve) => { started = resolve; });
    let aborted: (() => void) | undefined;
    const cancellation = new Promise<void>((resolve) => { aborted = resolve; });
    upstream.setRequestHandler(CallToolRequestSchema, async (_request, extra) => {
      started?.();
      await new Promise<void>((resolve) => {
        extra.signal.addEventListener('abort', () => { aborted?.(); resolve(); }, { once: true });
      });
      return { isError: true, content: [{ type: 'text', text: 'cancelled' }] };
    });
    const controller = new AbortController();
    const result = downstream.callTool({ name: 'fs_write' }, undefined, { signal: controller.signal })
      .then(() => false, () => true);
    await received;
    controller.abort();
    expect(await result).toBe(true);
    await Promise.race([
      cancellation,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Upstream approval was not cancelled')), 300)),
    ]);
  });
});
