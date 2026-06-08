import { nanoid } from 'nanoid';

export interface WebSearchChunk {
  content: string;
  citationUrls: string[];
  blockType: 'heading' | 'paragraph' | 'list' | 'quote' | 'code';
  headingPath: string[];
  webResultId: string;
  blockIndex: number;
  query: string;
  provider: string;
  model: string;
}

interface ChunkLimits {
  soft: number;
  hard: number;
  overlap: number;
}

interface ChunkInput {
  query: string;
  answer: string;
  citations: string[];
  provider: string;
  model: string;
  limits?: ChunkLimits;
}

interface RawBlock {
  type: WebSearchChunk['blockType'];
  text: string;
  headingPath: string[];
}

const DEFAULT_LIMITS: ChunkLimits = {
  soft: 1200,
  hard: 1500,
  overlap: 120,
};

const LIST_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+/;
const QUOTE_PATTERN = /^\s*>\s?/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

function normalizeAnswer(answer: string): string {
  return answer.replace(/\r\n/g, '\n').trim();
}

function sentenceParts(text: string): string[] {
  const matches = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g);
  return (matches ?? [text]).map((part) => part.trim()).filter((part) => part.length > 0);
}

function overlapSuffix(text: string, maxChars: number): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  const suffix = text.slice(-maxChars).trimStart();
  return suffix.length > 0 ? suffix : text.slice(-maxChars);
}

function buildHeadingPath(existing: string[], depth: number, title: string): string[] {
  const next = existing.slice(0, Math.max(0, depth - 1));
  next.push(title.trim());
  return next;
}

function parseBlocks(answer: string): RawBlock[] {
  const lines = normalizeAnswer(answer).split('\n');
  const blocks: RawBlock[] = [];
  let headingPath: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(HEADING_PATTERN);
    if (headingMatch) {
      headingPath = buildHeadingPath(headingPath, headingMatch[1]!.length, headingMatch[2]!);
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const blockLines = [line];
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index] ?? '';
        blockLines.push(nextLine);
        index += 1;
        if (nextLine.trim().startsWith('```')) {
          break;
        }
      }
      blocks.push({ type: 'code', text: blockLines.join('\n').trim(), headingPath: [...headingPath] });
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const blockLines: string[] = [];
      while (index < lines.length) {
        const nextLine = lines[index] ?? '';
        if (!nextLine.trim()) break;
        if (!QUOTE_PATTERN.test(nextLine)) break;
        blockLines.push(nextLine);
        index += 1;
      }
      blocks.push({ type: 'quote', text: blockLines.join('\n').trim(), headingPath: [...headingPath] });
      continue;
    }

    if (LIST_PATTERN.test(line)) {
      const blockLines: string[] = [];
      while (index < lines.length) {
        const nextLine = lines[index] ?? '';
        if (!nextLine.trim()) break;
        if (!LIST_PATTERN.test(nextLine)) break;
        blockLines.push(nextLine);
        index += 1;
      }
      blocks.push({ type: 'list', text: blockLines.join('\n').trim(), headingPath: [...headingPath] });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const nextLine = lines[index] ?? '';
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed) break;
      if (nextTrimmed.startsWith('```') || QUOTE_PATTERN.test(nextLine) || LIST_PATTERN.test(nextLine) || HEADING_PATTERN.test(nextTrimmed)) {
        break;
      }
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: paragraphLines.join('\n').trim(), headingPath: [...headingPath] });
  }

  return blocks.filter((block) => block.text.length > 0);
}

export function extractCitationBindings(blockText: string, citations: string[]): string[] {
  const indexes = new Set<number>();
  for (const match of blockText.matchAll(/\[(\d+)\]/g)) {
    const value = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(value) && value > 0 && value <= citations.length) {
      indexes.add(value - 1);
    }
  }

  if (indexes.size === 0) {
    return [...citations];
  }

  return Array.from(indexes).map((index) => citations[index]!).filter((url) => typeof url === 'string' && url.length > 0);
}

export function splitOversizedBlock(block: RawBlock, limits: ChunkLimits): Array<Pick<WebSearchChunk, 'content' | 'blockType' | 'headingPath'>> {
  if (block.text.length <= limits.hard) {
    return [{ content: block.text, blockType: block.type, headingPath: block.headingPath }];
  }

  const sentences = sentenceParts(block.text.replace(/\n+/g, ' '));
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= limits.soft || current.length === 0) {
      current = candidate;
      continue;
    }

    chunks.push(current.trim());
    current = `${overlapSuffix(current, limits.overlap)} ${sentence}`.trim();

    if (current.length > limits.hard) {
      chunks.push(current.slice(0, limits.hard).trim());
      current = overlapSuffix(current, limits.overlap);
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.flatMap((chunk) => {
    if (chunk.length <= limits.hard) {
      return [{ content: chunk, blockType: block.type, headingPath: block.headingPath }];
    }

    const parts: string[] = [];
    let start = 0;
    while (start < chunk.length) {
      const slice = chunk.slice(start, start + limits.hard).trim();
      if (!slice) break;
      parts.push(slice);
      start += Math.max(1, limits.hard - limits.overlap);
    }
    return parts.map((content) => ({ content, blockType: block.type, headingPath: block.headingPath }));
  });
}

export function chunkWebSearchResult(input: ChunkInput): WebSearchChunk[] {
  const limits = input.limits ?? DEFAULT_LIMITS;
  const webResultId = nanoid();
  const blocks = parseBlocks(input.answer);

  return blocks
    .flatMap((block) => splitOversizedBlock(block, limits).map((piece) => ({
      ...piece,
      citationUrls: extractCitationBindings(piece.content, input.citations),
    })))
    .map((chunk, blockIndex) => ({
      content: chunk.content,
      citationUrls: chunk.citationUrls,
      blockType: chunk.blockType,
      headingPath: chunk.headingPath,
      webResultId,
      blockIndex,
      query: input.query,
      provider: input.provider,
      model: input.model,
    }));
}
