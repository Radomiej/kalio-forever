import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import extractZip from 'extract-zip';
import yaml from 'js-yaml';
import type { RAAppBlock, RAAppResult } from '@kalio/types';
import { RAAppSandboxService } from './raapp-sandbox.service';

export interface RAAppMeta {
  id: string;
  name: string;
  version?: string;
  description?: string;
  author?: string;
  tags?: string[];
  expose_as_tool?: boolean;
  tool_description?: string;
  input_schema?: unknown;
  output_type?: string;
  execution?: {
    timeout_ms?: number;
    requires_user_approval?: boolean;
    render_as?: string;
  };
}

export interface LoadedRAApp {
  id: string;
  zipPath: string;
  meta: RAAppMeta;
  source: 'core' | 'user';
  htmlContent: string | null;   // null = no main.html in zip
  appMode: 'display' | 'interactive';
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class RAAppService implements OnModuleInit {
  private readonly logger = new Logger(RAAppService.name);
  private readonly loaded = new Map<string, LoadedRAApp>();
  private readonly coreDir: string;
  private readonly userDir: string;

  constructor(
    private readonly sandbox: RAAppSandboxService,
    private readonly config: ConfigService,
  ) {
    const base = this.config.get<string>('RA_APPS_PATH', './data/ra-apps');
    this.coreDir = path.resolve(base, 'core');
    this.userDir = path.resolve(base, 'user');
  }

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  async init(): Promise<void> {
    this.loaded.clear();
    await fs.mkdir(this.coreDir, { recursive: true });
    await fs.mkdir(this.userDir, { recursive: true });
    await this.loadFromDir(this.coreDir, 'core');
    await this.loadFromDir(this.userDir, 'user');
  }

  private async loadFromDir(dir: string, source: 'core' | 'user'): Promise<void> {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        if (!entry.endsWith('.zip')) continue;
        await this.loadZip(path.join(dir, entry), source).catch((err) =>
          this.logger.warn(`Failed to load RA-App ${entry}: ${String(err)}`),
        );
      }
      this.logger.log(`Loaded ${source} RA-Apps (${entries.filter((e) => e.endsWith('.zip')).length})`);
    } catch {
      this.logger.log(`${source} RA-Apps dir empty or not found: ${dir}`);
    }
  }

  private async loadZip(zipPath: string, source: 'core' | 'user'): Promise<LoadedRAApp> {
    const tmpDir = path.resolve(this.coreDir, '..', 'tmp', randomUUID());
    try {
      await extractZip(zipPath, { dir: tmpDir });
      const metaRaw = await fs.readFile(path.join(tmpDir, 'meta.yml'), 'utf-8');
      const meta = yaml.load(metaRaw) as RAAppMeta;
      const stats = await fs.stat(zipPath);
      const createdAt = stats.birthtimeMs > 0 ? Math.min(stats.birthtimeMs, stats.mtimeMs) : stats.mtimeMs;

      // Try to read main.html (falling back to index.html)
      let htmlContent: string | null = null;
      for (const candidate of ['main.html', 'index.html']) {
        try {
          htmlContent = await fs.readFile(path.join(tmpDir, candidate), 'utf-8');
          break;
        } catch { /* not found, try next */ }
      }

      const appMode: 'display' | 'interactive' =
        (meta.execution?.render_as as string | undefined) === 'interactive' ? 'interactive' : 'display';

      const app: LoadedRAApp = { id: meta.id, zipPath, meta, source, htmlContent, appMode, createdAt, updatedAt: stats.mtimeMs };
      this.loaded.set(meta.id, app);
      this.logger.log(`RA-App loaded: ${meta.id} v${meta.version ?? '?'} (${source}) html=${htmlContent != null}`);
      return app;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  getAll(): LoadedRAApp[] {
    return Array.from(this.loaded.values());
  }

  getById(id: string): LoadedRAApp | undefined {
    return this.loaded.get(id);
  }

  async saveUpload(buffer: Buffer, originalName: string): Promise<LoadedRAApp> {
    const id = originalName.replace(/\.zip$/i, '').replace(/[^a-z0-9-_]/gi, '-');
    const zipPath = path.join(this.userDir, `${id}.zip`);
    await fs.writeFile(zipPath, buffer);
    return this.loadZip(zipPath, 'user');
  }

  async delete(id: string): Promise<void> {
    const app = this.loaded.get(id);
    if (!app) return;
    if (app.source === 'core') throw new Error(`Cannot delete core RA-App: ${id}`);
    await fs.unlink(app.zipPath);
    this.loaded.delete(id);
  }

  async execute(block: RAAppBlock): Promise<RAAppResult> {
    if (block.type === 'html') {
      return { status: 'ready', renderedContent: block.content };
    }
    try {
      const result = await this.sandbox.execute(block.content);
      return { status: 'ready', renderedContent: result };
    } catch (err) {
      this.logger.error('[RAAppService] DSL execution error', err);
      return {
        status: 'error',
        error: {
          code: 'DSL_EXEC_ERROR',
          message: err instanceof Error ? err.message : 'Unknown error',
        },
      };
    }
  }

  parse(content: string): RAAppResult {
    if (!content || typeof content !== 'string') {
      return { status: 'error', error: { code: 'DSL_PARSE_ERROR', message: 'Empty or invalid DSL content' } };
    }
    return { status: 'ready', renderedContent: content };
  }
}

