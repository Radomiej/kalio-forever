import { createHash } from 'node:crypto';
import path from 'node:path';

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
  htmlContent: string | null;
  guiContent: string | null;
  systemsContent: string | null;
  appMode: 'display' | 'interactive';
  createdAt: number;
  updatedAt: number;
  unchangedLegacyShippedQA?: boolean;
}

// Exact shipped 1.1.0 from 3077d9b7: JSON([meta.yml, ui.gui, systems.yml]), LF-normalized.
const LEGACY_QA_SHA256 = 'e0890239470c60ce2aae5564bc47f5067dd67a045a009cc63f744846e501c0d6';

export function isUnchangedLegacyShippedQA(files: string[], contents: Array<string | null>): boolean {
  if (files.length !== 3 || !['meta.yml', 'ui.gui', 'systems.yml'].every((name) => files.includes(name))
    || contents.some((content) => content === null)) return false;
  return createHash('sha256').update(JSON.stringify(contents.map((content) => content?.replaceAll('\r\n', '\n'))))
    .digest('hex') === LEGACY_QA_SHA256;
}

export function keepPackagedQAPatch(existing: LoadedRAApp, incoming: LoadedRAApp, packagedCoreDir: string | null): boolean {
  // TODO: legacy fallback — only unchanged shipped 1.1.0 core may yield to the packaged 1.1.1 fix.
  return packagedCoreDir !== null && existing.id === 'qa-interactive' && incoming.id === existing.id
    && existing.source === 'core' && incoming.source === 'core'
    && path.resolve(existing.zipPath) === path.resolve(packagedCoreDir, 'qa-interactive')
    && existing.meta.version === '1.1.1' && existing.appMode === 'interactive'
    && incoming.meta.version === '1.1.0' && incoming.unchangedLegacyShippedQA === true;
}

export interface SaveGeneratedAppInput {
  type: 'html' | 'gui';
  content: string;
  mode: 'display' | 'interactive';
  sessionId: string;
  title?: string;
}

export function getRenderableScore(app: LoadedRAApp): number {
  let score = 0;
  if (app.htmlContent) score += 1;
  if (app.guiContent) score += 1;
  return score;
}

export function isDirectoryOrigin(app: LoadedRAApp): boolean {
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
