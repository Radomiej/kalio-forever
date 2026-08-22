import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CodeIntelligenceError } from './code-intelligence.errors';

const START_TIMEOUT_MS = 120 * 1000;
const REQUIRED_BRIDGE_TOOLS = ['document_symbols', 'workspace_symbols', 'diagnostics', 'find_definition_for_symbol', 'language_capabilities'];

export interface BridgeConnection {
  client: Client;
  transport: Transport;
  capabilities: Set<string>;
}

@Injectable()
export class VsCodeBridgeBackend {
  private readonly logger = new Logger(VsCodeBridgeBackend.name);

  async connect(port: number, token: string): Promise<BridgeConnection> {
    await waitForBridgeHealth(port, token);
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
    );
    const client = new Client({ name: 'kalio-code-intelligence', version: '1.0.0' });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const capabilities = new Set(listed.tools.map((tool) => tool.name));
      if (REQUIRED_BRIDGE_TOOLS.some((name) => !capabilities.has(name))) {
        throw new CodeIntelligenceError('IDE_BRIDGE_INCOMPATIBLE', 'Bridge does not expose the required read-only tools.');
      }
      return { client, transport, capabilities };
    } catch (error) {
      try { await client.close(); } catch (closeError) { this.logger.debug(`IDE client cleanup failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`); }
      try { await transport.close(); } catch (closeError) { this.logger.debug(`IDE transport cleanup failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`); }
      throw error;
    }
  }

  async close(connection: BridgeConnection): Promise<void> {
    try { await connection.client.close(); } catch (error) { this.logger.debug(`IDE client close failed: ${error instanceof Error ? error.message : String(error)}`); }
    try { await connection.transport.close(); } catch (error) { this.logger.debug(`IDE transport close failed: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

async function waitForBridgeHealth(port: number, token: string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2_000),
      });
      const body = await response.json() as { ok?: boolean; running?: boolean; version?: number };
      if (response.ok && body.ok === true && body.running === true && body.version === 3) return;
    } catch {
      // The extension can publish its connection file before the HTTP handler is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new CodeIntelligenceError('IDE_START_TIMEOUT', 'VS Code Bridge health check did not become ready before the deadline.');
}
