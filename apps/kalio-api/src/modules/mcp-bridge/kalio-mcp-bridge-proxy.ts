import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';

export function registerKalioBridgeProxy(remote: Client, server: Server): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const result = await remote.listTools();
    return { tools: result.tools as Tool[] };
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const progressToken = request.params._meta?.progressToken;
    const forwardingAbort = new AbortController();
    let forwarded = Promise.resolve();
    const result = await remote.callTool(request.params, undefined, {
      signal: AbortSignal.any([extra.signal, forwardingAbort.signal]),
      resetTimeoutOnProgress: true,
      onprogress: (progress) => {
        if (progressToken === undefined || extra.signal.aborted) return;
        forwarded = forwarded.then(() => extra.sendNotification({
          method: 'notifications/progress',
          params: { ...progress, progressToken },
        })).catch((error: unknown) => {
          forwardingAbort.abort(error);
        });
      },
    });
    await forwarded;
    if (forwardingAbort.signal.aborted) throw forwardingAbort.signal.reason;
    return result as CallToolResult;
  });
}
