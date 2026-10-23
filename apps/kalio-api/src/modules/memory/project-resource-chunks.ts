import { extname } from 'node:path';
import * as ts from 'typescript';

/** Offsets are half-open UTF-16 source offsets; lines are one-based. */
export interface ProjectResourceContentChunk {
  content: string;
  startOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

const SOURCE_LIMIT = 2000;
const OVERLAP_LIMIT = 200;
const CONTEXT_LIMIT = 400;
const SCRIPT_KINDS: Readonly<Record<string, ts.ScriptKind>> = {
  '.ts': ts.ScriptKind.TS, '.tsx': ts.ScriptKind.TSX,
  '.mts': ts.ScriptKind.TS, '.cts': ts.ScriptKind.TS,
  '.js': ts.ScriptKind.JS, '.jsx': ts.ScriptKind.JSX,
  '.mjs': ts.ScriptKind.JS, '.cjs': ts.ScriptKind.JS,
};

interface SourceRange { start: number; end: number; context: string }

function splitsPair(source: string, offset: number): boolean {
  const before = source.charCodeAt(offset - 1);
  const after = source.charCodeAt(offset);
  return (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
    || (source[offset - 1] === '\r' && source[offset] === '\n');
}

function boundedContext(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const marker = '\n[context excerpt]';
  let end = limit - marker.length;
  if (splitsPair(text, end)) end--;
  return text.slice(0, end) + marker;
}

function declarationRanges(path: string, source: string): SourceRange[] {
  const kind = SCRIPT_KINDS[extname(path).toLowerCase()];
  if (kind === undefined || source.length <= SOURCE_LIMIT) {
    return [{ start: 0, end: source.length, context: '' }];
  }
  // Syntax only: no type checking, module resolution or filesystem access.
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind);
  const imports = file.statements.filter(node => ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node))
    .map(node => node.getText(file)).join('\n');
  const ranges: SourceRange[] = [];
  file.statements.forEach((node, index) => {
    const start = index === 0 ? 0 : node.getFullStart();
    const end = file.statements[index + 1]?.getFullStart() ?? source.length;
    if (ts.isClassDeclaration(node) && end - start > SOURCE_LIMIT && node.members.length > 0) {
      const header = source.slice(node.getStart(file), node.members[0]!.getFullStart());
      const classContext = boundedContext(header, CONTEXT_LIMIT / 2);
      const importContext = boundedContext(imports, CONTEXT_LIMIT - classContext.length - 1);
      const context = `${importContext}\n${classContext}`;
      node.members.forEach((member, memberIndex) => {
        ranges.push({ start: memberIndex === 0 ? start : member.getFullStart(),
          end: node.members[memberIndex + 1]?.getFullStart() ?? end, context });
      });
    } else {
      ranges.push({ start, end, context: boundedContext(imports, CONTEXT_LIMIT) });
    }
  });
  // TODO: legacy fallback — comments-only or unparsed files still need complete source coverage.
  return ranges.length ? ranges : [{ start: 0, end: source.length, context: '' }];
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let offset = 0; offset < source.length; offset++) {
    if (source[offset] === '\r') {
      if (source[offset + 1] === '\n') offset++;
      starts.push(offset + 1);
    } else if (source[offset] === '\n') starts.push(offset + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let left = 0; let right = starts.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (starts[middle]! <= offset) left = middle + 1;
    else right = middle;
  }
  return left;
}

/**
 * Payload <=2000 UTF-16 units; extra context <=400; path/line labels are additional.
 * Oversized ranges prefer line boundaries, overlap <=200, and always advance.
 * AST boundaries cover TS/JS variants only; other languages use line windows.
 * All source units are retained, including trivia, CRLF and the final tail.
 * When provided, fits validates the entire labelled content against the provider's budget.
 */
export function chunkProjectResourceContent(path: string, source: string, fits?: (content: string) => boolean): ProjectResourceContentChunk[] {
  if (!source.trim()) return [];
  const starts = lineStarts(source);
  const chunks: ProjectResourceContentChunk[] = [];
  for (const range of declarationRanges(path, source)) {
    let start = range.start;
    let covered = start;
    while (start < range.end) {
      let end = Math.min(start + SOURCE_LIMIT, range.end);
      if (end < range.end) {
        // Prefer the latest line end in the latter half of the window.
        const line = lineAt(starts, end);
        const boundary = starts[line - 1]!;
        if (boundary >= start + SOURCE_LIMIT / 2) end = boundary;
        if (splitsPair(source, end)) end--;
      }
      const startLine = lineAt(starts, start);
      let context = range.context ? `Context:\n${range.context}\n` : '';
      const render = (stop: number) => `File: ${JSON.stringify(path)}; lines ${startLine}-${lineAt(starts, stop - 1)}\n${context}Source:\n${source.slice(start, stop)}`;
      if (fits && !fits(render(end))) {
        // A code point or CRLF is the smallest safe source unit, never a partial pair.
        let minimum = start + 1;
        if (splitsPair(source, minimum)) minimum++;
        if (context && !fits(render(minimum))) context = '';
        if (!fits(render(minimum))) throw new Error('PROJECT_RESOURCE_TOKEN_LIMIT');
        // Check actual rendered candidates; no characters-to-tokens estimate.
        while (!fits(render(end))) {
          let shorter = start + Math.floor((end - start) / 2);
          if (splitsPair(source, shorter)) shorter--;
          end = Math.max(minimum, shorter);
        }
      }
      // A smaller budget at a later line label can consume the entire overlap.
      if (end <= covered) { start = covered; continue; }
      const endLine = lineAt(starts, end - 1);
      chunks.push({ startOffset: start, endOffset: end, startLine, endLine,
        content: render(end) });
      covered = end;
      if (end === range.end) break;
      const overlap = fits ? Math.min(OVERLAP_LIMIT, Math.floor((end - start) / 2)) : OVERLAP_LIMIT;
      let next = Math.max(start + 1, end - overlap);
      // The first line start within the overlap keeps the overlap bounded.
      const line = lineAt(starts, next);
      const boundary = starts[line - 1] === next ? next : starts[line];
      if (boundary !== undefined && boundary <= end) next = boundary;
      if (splitsPair(source, next)) next++;
      start = next;
    }
  }
  return chunks;
}
