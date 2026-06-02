import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import extractZip from 'extract-zip';
import yaml from 'js-yaml';
import type { RAAppBlock, RAAppResult } from '@kalio/types';
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

const DEFAULT_RUNTIME_RA_APPS_PATH = './data/ra-apps';

function getPackagedRAAppsPath(): string {
  return path.resolve(__dirname, '../../assets/ra-apps');
}

function getRenderableScore(app: LoadedRAApp): number {
  let score = 0;
  if (app.htmlContent) score += 1;
  if (app.guiContent) score += 1;
  return score;
}

function isDirectoryOrigin(app: LoadedRAApp): boolean {
  return !app.zipPath.endsWith('.zip');
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
  private readonly packagedCoreDir: string | null;
  private readonly userDir: string;

  constructor(private readonly config: ConfigService) {
    const configuredBase = this.config.get<string | undefined>('RA_APPS_PATH', undefined);
    const runtimeBase = path.resolve(configuredBase ?? DEFAULT_RUNTIME_RA_APPS_PATH);

    if (configuredBase) {
      this.coreDir = path.resolve(runtimeBase, 'core');
      this.packagedCoreDir = null;
    } else {
      this.coreDir = path.resolve(runtimeBase, 'core');
      this.packagedCoreDir = path.resolve(getPackagedRAAppsPath(), 'core');
    }

    this.userDir = path.resolve(runtimeBase, 'user');
  }

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  async init(): Promise<void> {
    this.loaded.clear();
    await fs.mkdir(this.coreDir, { recursive: true });
    await fs.mkdir(this.userDir, { recursive: true });
    if (this.packagedCoreDir && path.resolve(this.packagedCoreDir) !== path.resolve(this.coreDir)) {
      await this.loadFromDir(this.packagedCoreDir, 'core');
    }
    await this.loadFromDir(this.coreDir, 'core');
    await this.loadFromDir(this.userDir, 'user');
  }

  private storeLoadedApp(app: LoadedRAApp): LoadedRAApp {
    const existing = this.loaded.get(app.id);
    if (!existing) {
      this.loaded.set(app.id, app);
      return app;
    }

    const existingScore = getRenderableScore(existing);
    const incomingScore = getRenderableScore(app);

    if (incomingScore < existingScore) {
      this.logger.warn(
        `[RAAppService] Keeping existing RA-App ${app.id}; duplicate ${app.zipPath} is less renderable (${incomingScore} < ${existingScore})`,
      );
      return existing;
    }

    if (incomingScore === existingScore && isDirectoryOrigin(existing) && !isDirectoryOrigin(app)) {
      this.logger.warn(
        `[RAAppService] Keeping unpacked RA-App ${app.id}; duplicate archive ${app.zipPath} would overwrite equivalent content`,
      );
      return existing;
    }

    if (incomingScore > existingScore || !isDirectoryOrigin(existing) && isDirectoryOrigin(app)) {
      this.logger.warn(
        `[RAAppService] Replacing duplicate RA-App ${app.id} with ${app.zipPath}`,
      );
    } else if (incomingScore === existingScore) {
      this.logger.warn(
        `[RAAppService] Replacing duplicate RA-App ${app.id} with ${app.zipPath} (equivalent renderable content)` ,
      );
    }

    this.loaded.set(app.id, app);
    return app;
  }

  private async loadFromDir(dir: string, source: 'core' | 'user'): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      let count = 0;
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.zip')) {
          await this.loadZip(path.join(dir, entry.name), source).catch((err) =>
            this.logger.warn(`Failed to load RA-App ${entry.name}: ${String(err)}`),
          );
          count++;
        } else if (entry.isDirectory()) {
          const appDir = path.join(dir, entry.name);
          const metaPath = path.join(appDir, 'meta.yml');

          try {
            await fs.access(metaPath);
            await this.loadDirectory(appDir, source).catch((err) =>
              this.logger.warn(`Failed to load unpacked RA-App ${entry.name}: ${String(err)}`),
            );
            count++;
            continue;
          } catch { /* no unpacked RA-App in this subdir — try versioned zip */ }

          // versioned user apps live in {slug}/current.zip after migration
          const currentZip = path.join(appDir, 'current.zip');
          try {
            await fs.access(currentZip);
            await this.loadZip(currentZip, source).catch((err) =>
              this.logger.warn(`Failed to load versioned RA-App ${entry.name}/current.zip: ${String(err)}`),
            );
            count++;
          } catch { /* no current.zip in this subdir — skip */ }
        }
      }
      this.logger.log(`Loaded ${source} RA-Apps (${count})`);
    } catch {
      this.logger.log(`${source} RA-Apps dir empty or not found: ${dir}`);
    }
  }

  private async loadDirectory(appDir: string, source: 'core' | 'user'): Promise<LoadedRAApp> {
    return this.loadExtractedApp(appDir, appDir, source);
  }

  private async loadExtractedApp(
    appDir: string,
    originPath: string,
    source: 'core' | 'user',
  ): Promise<LoadedRAApp> {
    const metaRaw = await fs.readFile(path.join(appDir, 'meta.yml'), 'utf-8');
    const meta = yaml.load(metaRaw) as RAAppMeta;
    const stats = await fs.stat(originPath);
    const createdAt = stats.birthtimeMs > 0 ? Math.min(stats.birthtimeMs, stats.mtimeMs) : stats.mtimeMs;

    let htmlContent: string | null = null;
    for (const candidate of ['main.html', 'index.html']) {
      try {
        htmlContent = await fs.readFile(path.join(appDir, candidate), 'utf-8');
        break;
      } catch { /* not found, try next */ }
    }

    let guiContent: string | null = null;
    try {
      guiContent = await fs.readFile(path.join(appDir, 'ui.gui'), 'utf-8');
    } catch { /* not found */ }

    let systemsContent: string | null = null;
    try {
      systemsContent = await fs.readFile(path.join(appDir, 'systems.yml'), 'utf-8');
    } catch { /* not found */ }

    const renderAs = (meta.execution?.render_as as string | undefined) ?? (meta as { ui?: { render_as?: string } }).ui?.render_as;
    const appMode: 'display' | 'interactive' = renderAs === 'interactive' ? 'interactive' : 'display';

    const app: LoadedRAApp = {
      id: meta.id,
      zipPath: originPath,
      meta,
      source,
      htmlContent,
      guiContent,
      systemsContent,
      appMode,
      createdAt,
      updatedAt: stats.mtimeMs,
    };

    const storedApp = this.storeLoadedApp(app);
    this.logger.log(
      `RA-App loaded: ${storedApp.id} v${storedApp.meta.version ?? '?'} (${source}) html=${storedApp.htmlContent != null} gui=${storedApp.guiContent != null}`,
    );
    return storedApp;
  }

  private async loadZip(zipPath: string, source: 'core' | 'user'): Promise<LoadedRAApp> {
    const tmpDir = path.resolve(this.coreDir, '..', 'tmp', randomUUID());
    try {
      await extractZip(zipPath, { dir: tmpDir });
      return this.loadExtractedApp(tmpDir, zipPath, source);
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
    await fs.rm(app.zipPath, { recursive: true, force: true });
    this.loaded.delete(id);
  }

  /**
   * Extract the source files from a stored RA-App ZIP and return them as
   * a string record.  Only the well-known text files are included.
   */
  async getSourceFiles(id: string): Promise<Record<string, string>> {
    const app = this.loaded.get(id);
    if (!app) throw new Error(`RA-App not found: ${id}`);

    const tmpDir = path.resolve(this.coreDir, '..', 'tmp', randomUUID());
    try {
      if (app.zipPath.endsWith('.zip')) {
        await extractZip(app.zipPath, { dir: tmpDir });
      } else {
        // Directory-based app — copy directly
        await fs.cp(app.zipPath, tmpDir, { recursive: true });
      }
      const candidates = ['meta.yml', 'systems.yml', 'ui.gui', 'ui.yml', 'tests.yml', 'components.yml'];
      const result: Record<string, string> = {};
      for (const name of candidates) {
        try {
          result[name] = await fs.readFile(path.join(tmpDir, name), 'utf-8');
        } catch { /* file absent — skip */ }
      }
      return result;
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
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

