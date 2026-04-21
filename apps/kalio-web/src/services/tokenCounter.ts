/**
 * Token counting service — browser-compatible approximation.
 *
 * Heuristics:
 * - Text:   ~4 chars = 1 token  (cl100k_base empirical average)
 * - JSON:   ~3 chars = 1 token  (denser encoding)
 * - Images: ~85 tokens per 512×512 tile + 85 base (OpenAI vision pricing)
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TokenBreakdown {
  systemPrompt: number;
  skills: number;
  tools: number;
  history: number;
  images: number;
}

export interface TokenCount {
  total: number;
  breakdown: TokenBreakdown;
  /** Tokens that can be cached by the provider (system + tools + skills) */
  cacheable: number;
  contextLimit: number;
  /** 0–100 */
  usagePercent: number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN_TEXT = 4;
const CHARS_PER_TOKEN_JSON = 3;
const IMAGE_BASE_TOKENS = 85;
const IMAGE_TILE_TOKENS = 85;
const IMAGE_TILE_SIZE = 512;

// ── Helpers ────────────────────────────────────────────────────────────────────

export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_TEXT);
}

export function estimateJsonTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_JSON);
}

/**
 * Estimate tokens for an image based on dimensions and OpenAI detail level.
 * - detail 'low': flat 85 tokens (provider scales image down to 512×512 thumbnail internally)
 * - detail 'auto' | 'high': tile-based formula ceil(w/512) * ceil(h/512) * 85 + 85
 */
export function estimateImageTokens(width = 1024, height = 1024, detail: 'low' | 'auto' | 'high' = 'auto'): number {
  if (detail === 'low') return IMAGE_BASE_TOKENS;
  const tilesX = Math.ceil(width / IMAGE_TILE_SIZE);
  const tilesY = Math.ceil(height / IMAGE_TILE_SIZE);
  return tilesX * tilesY * IMAGE_TILE_TOKENS + IMAGE_BASE_TOKENS;
}

// ── Main counter ───────────────────────────────────────────────────────────────

export interface CountTokensInput {
  systemPromptText: string;
  skillsText: string;
  toolsText: string;
  historyTexts: string[];
  /** Number of images in the conversation */
  imageCount: number;
  contextLimit: number;
  /** OpenAI detail level for image token estimation. Default: 'auto' */
  imageDetailMode?: 'low' | 'auto' | 'high';
}

export function countTokens(input: CountTokensInput): TokenCount {
  const systemPrompt = estimateTextTokens(input.systemPromptText);
  const skills = estimateTextTokens(input.skillsText);
  const tools = estimateTextTokens(input.toolsText);

  let history = 0;
  for (const text of input.historyTexts) {
    history += estimateTextTokens(text);
  }

  const images = input.imageCount * estimateImageTokens(1024, 1024, input.imageDetailMode ?? 'auto');

  const breakdown: TokenBreakdown = { systemPrompt, skills, tools, history, images };
  const total = systemPrompt + skills + tools + history + images;
  const cacheable = systemPrompt + tools + skills;
  const usagePercent = input.contextLimit > 0
    ? Math.min(100, Math.round((total / input.contextLimit) * 100))
    : 0;

  return { total, breakdown, cacheable, contextLimit: input.contextLimit, usagePercent };
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

/** Format a token count like "24.5k" or "320" */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    const k = tokens / 1000;
    return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
  }
  return String(tokens);
}
