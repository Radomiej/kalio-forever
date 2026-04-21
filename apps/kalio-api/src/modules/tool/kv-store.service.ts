import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Simple JSON-backed KV store per conversation, stored in the workspace dir.
@Injectable()
export class KVStoreService {
  private readonly workspaceRoot: string;

  constructor(private readonly config: ConfigService) {
    this.workspaceRoot = resolve(this.config.get<string>('WORKSPACE_ROOT', './data/workspaces'));
  }

  private kvPath(conversationId: string): string {
    return join(this.workspaceRoot, 'conversations', conversationId, '_kv.json');
  }

  private load(conversationId: string): Record<string, string> {
    const path = this.kvPath(conversationId);
    if (!existsSync(path)) return {};
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private save(conversationId: string, data: Record<string, string>): void {
    const path = this.kvPath(conversationId);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  }

  get(conversationId: string, key: string): string | undefined {
    return this.load(conversationId)[key];
  }

  set(conversationId: string, key: string, value: string): void {
    const data = this.load(conversationId);
    data[key] = value;
    this.save(conversationId, data);
  }

  delete(conversationId: string, key: string): boolean {
    const data = this.load(conversationId);
    if (!(key in data)) return false;
    delete data[key];
    this.save(conversationId, data);
    return true;
  }

  list(conversationId: string): Record<string, string> {
    return this.load(conversationId);
  }
}
