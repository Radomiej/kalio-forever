// ─── HTML detection ───────────────────────────────────────────────────────────

const HTML_MARKERS = ['<!doctype', '<html', '<div', '<table', '<body', '<svg'];

export function isHtmlString(str: string): boolean {
  const lower = str.trimStart().toLowerCase();
  return HTML_MARKERS.some((m) => lower.startsWith(m));
}

export function unescapeHtml(str: string): string {
  let s = str.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}

const HTML_FIELD_KEYS = ['html', 'cv_html', 'svg', 'content_html', 'body', 'template'];

export function findHtmlInData(data: unknown): string | null {
  if (typeof data === 'string') {
    if (isHtmlString(data)) return data;
    const unescaped = unescapeHtml(data);
    if (isHtmlString(unescaped)) return unescaped;
    return null;
  }
  if (!data || typeof data !== 'object') return null;

  // Check known keys first
  const obj = data as Record<string, unknown>;
  for (const key of HTML_FIELD_KEYS) {
    if (typeof obj[key] === 'string') {
      const val = obj[key] as string;
      if (isHtmlString(val)) return val;
      const unescaped = unescapeHtml(val);
      if (isHtmlString(unescaped)) return unescaped;
    }
  }

  // Full scan of all string values
  for (const val of Object.values(obj)) {
    if (typeof val === 'string' && val.length > 50 && isHtmlString(val)) return val;
  }

  return null;
}

// ─── CDN injection ────────────────────────────────────────────────────────────

export type UiRenderer = 'threejs' | 'pixi' | 'tone' | 'p5' | 'matter' | 'chartjs';

const ENGINE_CDN_MAP: Record<UiRenderer, string[]> = {
  threejs: ['https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js'],
  pixi: ['https://cdn.jsdelivr.net/npm/pixi.js@8.0.0/dist/pixi.min.js'],
  tone: ['https://cdn.jsdelivr.net/npm/tone@14.7.77/build/Tone.js'],
  p5: ['https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js'],
  matter: ['https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js'],
  chartjs: ['https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'],
};

function buildScriptTags(urls: string[]): string {
  return urls.map((url) => `<script src="${url}"></script>`).join('\n');
}

function injectBeforeHeadClose(html: string, snippet: string): string {
  const idx = html.toLowerCase().indexOf('</head>');
  if (idx !== -1) return html.slice(0, idx) + snippet + '\n' + html.slice(idx);
  const bodyIdx = html.toLowerCase().indexOf('<body');
  if (bodyIdx !== -1) return html.slice(0, bodyIdx) + snippet + '\n' + html.slice(bodyIdx);
  return snippet + '\n' + html;
}

export function injectEngineCDN(html: string, engine: UiRenderer): string {
  const urls = ENGINE_CDN_MAP[engine];
  if (!urls) return html;
  return injectBeforeHeadClose(html, buildScriptTags(urls));
}
