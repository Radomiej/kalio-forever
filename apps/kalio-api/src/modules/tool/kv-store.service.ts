import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Simple JSON-backed KV store per workspace, stored in the workspace dir.
@Injectable()
export class KVStoreService {
  private readonly workspaceRoot: string;

  constructor(private readonly config: ConfigService) {
    this.workspaceRoot = resolve(this.config.get<string>('WORKSPACE_ROOT', './data/workspaces'));
  }

  private kvPath(sessionId: string): string {
    return join(this.workspaceRoot, 'sessions', sessionId, '_kv.json');
  }

  private load(sessionId: string): Record<string, string> {
    const path = this.kvPath(sessionId);
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private save(sessionId: string, data: Record<string, string>): void {
    const path = this.kvPath(sessionId);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  }

  get(sessionId: string, key: string): string | undefined {
    return this.load(sessionId)[key];
  }

  set(sessionId: string, key: string, value: string): void {
    const data = this.load(sessionId);
    data[key] = value;
    this.save(sessionId, data);
  }

  delete(sessionId: string, key: string): boolean {
    const data = this.load(sessionId);
    if (!(key in data)) return false;
    delete data[key];
    this.save(sessionId, data);
    return true;
  }

  list(sessionId: string): Record<string, string> {
    return this.load(sessionId);
  }
}
