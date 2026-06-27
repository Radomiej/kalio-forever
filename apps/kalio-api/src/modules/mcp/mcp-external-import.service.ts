import { Injectable, Logger } from '@nestjs/common';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CreateMCPServerDto, MCPServer } from '@kalio/types';
import { MCPService } from './mcp.service';
import { buildMcpSignatureFromDto, buildMcpSignatureFromServer } from './mcp-registry.utils';

export interface ExternalMCPServerEntry {
  id: string;
  source: 'cursor' | 'windsurf' | 'codex' | 'copilot';
  configPath: string;
  key: string;
  dto: CreateMCPServerDto;
  details: {
    envKeys: string[];
    headerKeys: string[];
  };
  equivalentToExisting: boolean;
}

export interface ExternalMCPImportResult {
  imported: MCPServer[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
}

interface ExternalSourceConfig {
  source: ExternalMCPServerEntry['source'];
  paths: string[];
}

@Injectable()
export class MCPExternalImportService {
  private readonly logger = new Logger(MCPExternalImportService.name);

  constructor(private readonly mcpService: MCPService) {}

  async discover(): Promise<ExternalMCPServerEntry[]> {
    const existing = await this.mcpService.findAll();
    const existingSignatures = new Set(existing.map((server) => buildMcpSignatureFromServer(server)));
    const discovered: ExternalMCPServerEntry[] = [];

    for (const sourceConfig of this.getSourceConfigs()) {
      for (const configPath of sourceConfig.paths) {
        if (!(await this.fileExists(configPath))) {
          continue;
        }

        try {
          const raw = await readFile(configPath, 'utf8');
          const parsed = this.parseConfig(raw, sourceConfig.source, configPath);
          for (const entry of parsed) {
            const signature = buildMcpSignatureFromDto(entry.dto);
            discovered.push({ ...entry, equivalentToExisting: existingSignatures.has(signature) });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`[MCP] External config read failed for ${configPath}: ${message}`);
        }
      }
    }

    return discovered;
  }

  async apply(entryIds: string[]): Promise<ExternalMCPImportResult> {
    const discovered = await this.discover();
    const byId = new Map(discovered.map((entry) => [entry.id, entry]));
    const imported: MCPServer[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];
    const failed: Array<{ id: string; reason: string }> = [];

    const uniqueIds = [...new Set(entryIds)];
    for (const id of uniqueIds) {
      const entry = byId.get(id);
      if (!entry) {
        failed.push({ id, reason: 'Entry was not found in current discovery snapshot' });
        continue;
      }

      try {
        const created = await this.mcpService.addServer(entry.dto);
        imported.push(created);
      } catch (err) {
        failed.push({
          id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { imported, skipped, failed };
  }

  private getSourceConfigs(): ExternalSourceConfig[] {
    const home = homedir();
    const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
    const cwd = process.cwd();

    return [
      {
        source: 'cursor',
        paths: this.uniquePaths([
          join(home, '.cursor', 'mcp.json'),
          join(appData, 'Cursor', 'User', 'mcp.json'),
        ]),
      },
      {
        source: 'windsurf',
        paths: this.uniquePaths([
          join(appData, 'Windsurf', 'User', 'mcp.json'),
          join(home, '.codeium', 'windsurf', 'mcp.json'),
        ]),
      },
      {
        source: 'codex',
        paths: this.uniquePaths([
          join(home, '.codex', 'mcp.json'),
          join(home, '.config', 'codex', 'mcp.json'),
        ]),
      },
      {
        source: 'copilot',
        paths: this.uniquePaths([
          ...this.workspaceConfigPaths(cwd, '.vscode', 'mcp.json'),
          join(appData, 'Code', 'User', 'mcp.json'),
        ]),
      },
    ];
  }

  private workspaceConfigPaths(startPath: string, configDir: string, fileName: string): string[] {
    const paths: string[] = [];
    let current = startPath;

    while (current) {
      paths.push(join(current, configDir, fileName));
      const parent = dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    return paths;
  }

  private uniquePaths(paths: string[]): string[] {
    return [...new Set(paths.map((path) => path.trim()).filter((path) => path.length > 0))];
  }

  private async fileExists(path: string): Promise<boolean> {
    try {
      await access(path, fsConstants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  private parseConfig(raw: string, source: ExternalMCPServerEntry['source'], configPath: string): ExternalMCPServerEntry[] {
    const json = JSON.parse(raw.replace(/^\uFEFF/, '')) as unknown;
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return [];
    }

    const container = (json as Record<string, unknown>)['mcpServers'] ?? (json as Record<string, unknown>)['servers'];
    if (!container || typeof container !== 'object' || Array.isArray(container)) {
      return [];
    }

    const entries: ExternalMCPServerEntry[] = [];
    for (const [key, value] of Object.entries(container as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const entryObj = value as Record<string, unknown>;
      const dto = this.toDto(key, entryObj, source);
      if (!dto) {
        continue;
      }

      entries.push({
        id: `${source}:${configPath}:${key}`,
        source,
        configPath,
        key,
        dto,
        details: {
          envKeys: this.readObjectKeys(entryObj['env']),
          headerKeys: this.readObjectKeys(entryObj['headers']),
        },
        equivalentToExisting: false,
      });
    }

    return entries;
  }

  private toDto(
    key: string,
    entry: Record<string, unknown>,
    source: ExternalMCPServerEntry['source'],
  ): CreateMCPServerDto | null {
    const type = this.readString(entry['type']);
    const name = this.readString(entry['name']) ?? key;
    const url = this.readString(entry['url']);
    const command = this.readString(entry['command']);

    const transport = this.resolveTransport(type, url, command);
    if (!transport) {
      return null;
    }

    if (transport === 'http' && !url) {
      return null;
    }
    if (transport === 'stdio' && !command) {
      return null;
    }

    if (transport === 'http') {
      const headers = this.readStringMap(entry['headers']);
      return {
        name,
        transport,
        url,
        headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
        originSource: source,
      };
    }

    const args = this.readStringArray(entry['args']);
    if (args === null) {
      return null;
    }
    const env = this.readStringMap(entry['env']);

    return {
      name,
      transport,
      command,
      args: args ?? undefined,
      env: env && Object.keys(env).length > 0 ? env : undefined,
      originSource: source,
    };
  }

  private resolveTransport(type: string | undefined, url: string | undefined, command: string | undefined): 'stdio' | 'http' | null {
    if ((type === 'http' || type === 'sse') && url) {
      return 'http';
    }
    if (type === 'stdio' && command) {
      return 'stdio';
    }
    if (url) {
      return 'http';
    }
    if (command) {
      return 'stdio';
    }
    return null;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private readStringArray(value: unknown): string[] | undefined | null {
    if (value === undefined) {
      return undefined;
    }
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      return null;
    }
    return value;
  }

  private readStringMap(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, string> = {};
    for (const [key, entry] of entries) {
      out[key] = String(entry ?? '');
    }
    return out;
  }

  private readObjectKeys(value: unknown): string[] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [];
    }
    return Object.keys(value as Record<string, unknown>);
  }

}
