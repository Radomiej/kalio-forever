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
