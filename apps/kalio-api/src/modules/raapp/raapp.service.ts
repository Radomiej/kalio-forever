import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import extractZip from 'extract-zip';
import archiver from 'archiver';
import yaml from 'js-yaml';
import type { RAAppBlock, RAAppResult } from '@kalio/types';
import { RAAppSandboxService } from './raapp-sandbox.service';
import { compileGui } from './gui/guiDslExpand';
import { GuiParseError } from './gui/guiDslParser';

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
  guiContent: string | null;    // null = no ui.gui in zip
  systemsContent: string | null; // null = no systems.yml in zip
  appMode: 'display' | 'interactive';
  createdAt: number;
  updatedAt: number;
}

export interface SaveGeneratedAppInput {
  type: 'html' | 'gui';
  content: string;
  mode: 'display' | 'interactive';
  sessionId: string;
  title?: string;
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function tryExtractHtmlTitle(content: string): string | null {
  const titleMatch = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    const cleaned = cleanTitle(stripHtmlTags(titleMatch[1]));
    if (cleaned.length > 0) return cleaned;
  }

  const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match?.[1]) {
    const cleaned = cleanTitle(stripHtmlTags(h1Match[1]));
    if (cleaned.length > 0) return cleaned;
  }

  return null;
}

function tryExtractGuiTitle(content: string): string | null {
  const titleAssignment = content.match(/(^|\n)\s*title\s*=\s*["']([^"']+)["']/i);
  if (titleAssignment?.[2]) {
    const cleaned = cleanTitle(titleAssignment[2]);
    if (cleaned.length > 0) return cleaned;
  }
  return null;
}

export function deriveGeneratedAppName(input: SaveGeneratedAppInput): string {
  const explicit = typeof input.title === 'string' ? cleanTitle(input.title) : '';
  const extracted =
    input.type === 'html'
      ? tryExtractHtmlTitle(input.content)
      : tryExtractGuiTitle(input.content);

  const chosen = explicit || extracted;
  if (chosen) {
    return chosen.length > 80 ? chosen.slice(0, 80) : chosen;
  }

  return `Generated ${input.type.toUpperCase()} ${new Date().toISOString()}`;
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

      // Try to read ui.gui (GUI DSL)
      let guiContent: string | null = null;
      try {
        guiContent = await fs.readFile(path.join(tmpDir, 'ui.gui'), 'utf-8');
      } catch { /* not found */ }

      // Try to read systems.yml (system effects for computed outputs)
      let systemsContent: string | null = null;
      try {
        systemsContent = await fs.readFile(path.join(tmpDir, 'systems.yml'), 'utf-8');
      } catch { /* not found */ }

      const renderAs = (meta.execution?.render_as as string | undefined) ?? (meta as { ui?: { render_as?: string } }).ui?.render_as;
      const appMode: 'display' | 'interactive' = renderAs === 'interactive' ? 'interactive' : 'display';

      const app: LoadedRAApp = { id: meta.id, zipPath, meta, source, htmlContent, guiContent, systemsContent, appMode, createdAt, updatedAt: stats.mtimeMs };
      this.loaded.set(meta.id, app);
      this.logger.log(`RA-App loaded: ${meta.id} v${meta.version ?? '?'} (${source}) html=${htmlContent != null} gui=${guiContent != null}`);
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

  async saveGeneratedApp(input: SaveGeneratedAppInput): Promise<LoadedRAApp> {
    const sessionPart = input.sessionId.trim().slice(0, 8) || 'session';
    const appId = `generated-${sessionPart}-${randomUUID().slice(0, 8)}`;
    const tmpDir = path.resolve(this.coreDir, '..', 'tmp', randomUUID());
    const zipPath = path.join(this.userDir, `${appId}.zip`);

    try {
      await fs.mkdir(tmpDir, { recursive: true });

      const meta: RAAppMeta = {
        id: appId,
        name: deriveGeneratedAppName(input),
        description: 'Auto-saved by raapp_create tool',
        version: '1.0.0',
        tags: ['generated', 'raapp-create'],
        expose_as_tool: false,
        execution: {
          render_as: input.mode,
        },
      };

      await fs.writeFile(path.join(tmpDir, 'meta.yml'), yaml.dump(meta), 'utf-8');

      if (input.type === 'gui') {
        await fs.writeFile(path.join(tmpDir, 'ui.gui'), input.content, 'utf-8');
      } else {
        await fs.writeFile(path.join(tmpDir, 'main.html'), input.content, 'utf-8');
      }

      await new Promise<void>((resolve, reject) => {
        const output = fsSync.createWriteStream(zipPath);
        const arc = archiver('zip', { zlib: { level: 6 } });
        output.on('close', resolve);
        output.on('error', reject);
        arc.on('error', reject);
        arc.pipe(output);
        arc.directory(tmpDir, false);
        void arc.finalize();
      });

      const loaded = await this.loadZip(zipPath, 'user');
      this.logger.log(`[RAAppService] Saved generated app ${loaded.id} (${input.type}, mode=${input.mode})`);
      return loaded;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  async delete(id: string): Promise<void> {
    const app = this.loaded.get(id);
    if (!app) return;
    if (app.source === 'core') throw new Error(`Cannot delete core RA-App: ${id}`);
    await fs.unlink(app.zipPath);
    this.loaded.delete(id);
  }

  async executeSystems(systemsContent: string, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      const parsed = yaml.load(systemsContent) as {
        systems?: Array<{
          id: string;
          effects?: Array<{
            assign?: { target: string; expression: string };
          }>;
        }>;
      };
      const systems = parsed?.systems ?? [];

      let jsCode = `const input = ${JSON.stringify(inputs)};\nconst output = {};\n`;
      for (const system of systems) {
        for (const effect of system.effects ?? []) {
          const assign = effect.assign;
          if (!assign) continue;
          const targetKey = assign.target.replace(/^output\./, '');
          const expr = (assign.expression ?? '').replace(/\s+/g, ' ').trim();
          jsCode += `output['${targetKey}'] = ${expr};\n`;
        }
      }
      jsCode += 'return JSON.stringify(output);';

      const result = await this.sandbox.execute(jsCode);
      return JSON.parse(result) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(
        `[RAAppService] System execution error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {};
    }
  }

  async execute(block: RAAppBlock, data: Record<string, unknown> = {}): Promise<RAAppResult> {
    if (block.type === 'html') {
      return { status: 'ready', renderedContent: block.content };
    }
    // gui type: parse with GUI DSL and return nodes+data as JSON string
    try {
      const nodes = compileGui(block.content);
      const renderedContent = JSON.stringify({ nodes, data });
      return { status: 'ready', renderedContent };
    } catch (err) {
      this.logger.error('[RAAppService] GUI DSL parse error', err);
      return {
        status: 'error',
        error: {
          code: err instanceof GuiParseError ? 'DSL_PARSE_ERROR' : 'DSL_EXEC_ERROR',
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

