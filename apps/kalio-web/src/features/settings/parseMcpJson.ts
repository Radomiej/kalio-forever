import type { CreateMCPServerDto } from '@kalio/types';

export interface ParsedMCPEntry {
  key: string;
  dto: CreateMCPServerDto;
}

function getNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse VS Code–style or Claude Desktop–style MCP JSON into CreateMCPServerDto entries.
 *
 * Accepted formats:
 * ```json
 * { "servers": { "<id>": { "type": "http", "url": "...", "headers": { ... } } } }
 * { "mcpServers": { "<id>": { "command": "npx", "args": [...], "env": { ... } } } }
 * ```
 *
 * Throws `Error` on invalid JSON or missing `servers`/`mcpServers` key.
 * Silently skips entries where transport cannot be determined.
 */
export function parseMcpJson(raw: string): ParsedMCPEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON — check for syntax errors (missing commas, trailing commas, etc.).');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object with "servers" or "mcpServers" key.');
  }

  const obj = parsed as Record<string, unknown>;
  const serversObj = (obj['servers'] ?? obj['mcpServers']) as Record<string, unknown> | undefined;

  if (!serversObj || typeof serversObj !== 'object' || Array.isArray(serversObj)) {
    throw new Error('JSON must contain a "servers" or "mcpServers" object with server definitions.');
  }

  const results: ParsedMCPEntry[] = [];

  for (const [serverId, rawEntry] of Object.entries(serversObj)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) continue;

    const entry = rawEntry as Record<string, unknown>;

    // Determine transport
    const typeField = entry['type'] as string | undefined;
    const url = getNonEmptyString(entry['url']);
    const command = getNonEmptyString(entry['command']);
    let transport: 'stdio' | 'http';
    if ((typeField === 'http' || typeField === 'sse') && url) {
      transport = 'http';
    } else if (typeField === 'stdio' && command) {
      transport = 'stdio';
    } else if (url) {
      transport = 'http';
    } else if (command) {
      transport = 'stdio';
    } else {
      // Cannot determine transport — skip
      continue;
    }

    const name = getNonEmptyString(entry['name']) ?? serverId;

    const dto: CreateMCPServerDto = { name, transport };

    if (transport === 'http') {
      dto.url = url;

      if (entry['headers'] && typeof entry['headers'] === 'object' && !Array.isArray(entry['headers'])) {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(entry['headers'] as Record<string, unknown>)) {
          headers[k] = String(v ?? '');
        }
        if (Object.keys(headers).length > 0) dto.headers = headers;
      }
    }

    if (transport === 'stdio') {
      dto.command = command;

      if (Array.isArray(entry['args'])) {
        dto.args = (entry['args'] as unknown[]).map(String);
      }

      if (entry['env'] && typeof entry['env'] === 'object' && !Array.isArray(entry['env'])) {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(entry['env'] as Record<string, unknown>)) {
          env[k] = String(v ?? '');
        }
        if (Object.keys(env).length > 0) dto.env = env;
      }
    }

    results.push({ key: serverId, dto });
  }

  return results;
}
