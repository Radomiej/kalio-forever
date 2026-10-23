import { describe, expect, it } from 'vitest';
import { chunkProjectResourceContent } from './project-resource-chunks';

function verify(path: string, source: string, fits?: (content: string) => boolean) {
  const expectedLine = (offset: number) => 1 + [...source.matchAll(/\r\n|\r|\n/g)]
    .filter(match => match.index + match[0].length <= offset).length;
  const chunks = chunkProjectResourceContent(path, source, fits);
  expect(chunks).toEqual(chunkProjectResourceContent(path, source, fits));
  let covered = 0;
  let previousStart = -1;
  for (const chunk of chunks) {
    expect(chunk.startOffset).toBeGreaterThan(previousStart);
    expect(chunk.startOffset).toBeLessThanOrEqual(covered);
    expect(chunk.endOffset).toBeGreaterThan(covered);
    expect(chunk.endOffset - chunk.startOffset).toBeLessThanOrEqual(2000);
    const body = source.slice(chunk.startOffset, chunk.endOffset);
    expect(chunk.content.endsWith(`Source:\n${body}`)).toBe(true);
    if (fits) expect(fits(chunk.content)).toBe(true);
    expect(chunk.content).toContain(`File: ${JSON.stringify(path)}; lines ${chunk.startLine}-${chunk.endLine}`);
    expect(chunk.content.length).toBeLessThanOrEqual(2400 + JSON.stringify(path).length + 100);
    expect(chunk.startLine).toBe(expectedLine(chunk.startOffset));
    expect(chunk.endLine).toBe(expectedLine(chunk.endOffset - 1));
    expect(body).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/u);
    expect(body.startsWith('\n') && source[chunk.startOffset - 1] === '\r').toBe(false);
    covered = chunk.endOffset;
    previousStart = chunk.startOffset;
  }
  expect(covered).toBe(source.length);
  return chunks;
}

describe('chunkProjectResourceContent', () => {
  it.each(['\n', '\r\n'])('fits a finite prefix-aware budget and preserves full Unicode source with %j', newline => {
    const fits = (content: string) => Buffer.byteLength(`passage: ${content}`, 'utf8') <= 160;
    const source = `const text = '${'zażółć🐈'.repeat(900)}';${newline}// FINAL_TAIL`;
    verify('long.js', source, fits);
  });
  it('drops optional import/class context when it cannot leave space for payload', () => {
    const source = `import { ${'x'.repeat(350)} } from './other';\nclass Large {\nrun() {${'work();'.repeat(700)}}\n}\n`;
    const fits = (content: string) => Buffer.byteLength(content, 'utf8') <= 100;
    const chunks = verify('a.ts', source, fits);
    expect(chunks.every(chunk => !chunk.content.includes('Context:\n'))).toBe(true);
  });
  it('throws instead of truncating when the header plus one complete code point cannot fit', () => {
    const path = `${'long'.repeat(70)}.ts`;
    expect(() => chunkProjectResourceContent(path, '🐈', content => content.length <= 40)).toThrow('PROJECT_RESOURCE_TOKEN_LIMIT');
    const header = 'File: "a.ts"; lines 1-1\nSource:\n';
    expect(() => chunkProjectResourceContent('a.ts', '🐈', content => content.length <= header.length + 1)).toThrow('PROJECT_RESOURCE_TOKEN_LIMIT');
    expect(verify('a.ts', '🐈', content => content.length <= header.length + 2)).toHaveLength(1);
  });
  it('handles a minimal payload budget without overlap stalling or cutting CRLF', () => {
    const fits = (content: string) => {
      const body = content.split('Source:\n')[1]!;
      return Array.from(body).length <= 2;
    };
    verify('tiny.txt', '🐈🐈\r\n🐈\r\nend', fits);
  });
  it('returns no chunks for empty/whitespace input and keeps short files whole', () => {
    expect(chunkProjectResourceContent('empty.ts', ' \r\n')).toEqual([]);
    const source = '// café 🐈\r\nexport const value = 1;\r\n';
    const chunks = verify('short.ts', source);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ startLine: 1, endLine: 2 });
  });

  it.each(['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'])('splits declarations and preserves import context for .%s', extension => {
    const source = `import { value } from './value';\n// first\nexport function first() {\n${'  value();\n'.repeat(95)}}\n// second\nexport function second() {\n${'  value();\n'.repeat(95)}}\nexport const tail = 'COMPLETE_TAIL';\n`;
    const chunks = verify(`src/main.${extension}`, source);
    const second = chunks.find(chunk => source.slice(chunk.startOffset, chunk.endOffset).includes('export function second'))!;
    expect(second.startOffset).toBe(source.indexOf('\n// second'));
    expect(second.content).toContain("import { value } from './value';");
    expect(chunks.at(-1)!.content).toContain('COMPLETE_TAIL');
  });

  it('splits a large class at members and preserves its header', () => {
    const source = `import { Base } from './base';\nexport class Worker extends Base {\n  first() {\n${'    this.work();\n'.repeat(85)}  }\n  second() {\n${'    this.work();\n'.repeat(85)}  }\n}\n`;
    const chunks = verify('worker.ts', source);
    const second = chunks.find(chunk => source.slice(chunk.startOffset, chunk.endOffset).includes('second()'))!;
    expect(second.startOffset).toBe(source.indexOf('\n  second()'));
    expect(second.content).toContain('export class Worker extends Base {');
    expect(second.content).toContain("import { Base } from './base';");
  });

  it.each(['\n', '\r\n'])('covers a long single method and Unicode with %j', newline => {
    const source = `class Huge {${newline}  run() {${newline}${`    log('zażółć 🐈');${newline}`.repeat(900)}  }${newline}}${newline}// FINAL_TAIL`;
    const chunks = verify('huge.ts', source);
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.at(-1)!.content).toContain('FINAL_TAIL');
  });

  it.each(['py', 'rs', 'txt'])('uses line windows for .%s, with bounded overlap', extension => {
    const source = `${'a'.repeat(79)}\n`.repeat(90) + 'TAIL';
    const chunks = verify(`other.${extension}`, source);
    for (let index = 1; index < chunks.length; index++) {
      expect(chunks[index - 1]!.endOffset - chunks[index]!.startOffset).toBeLessThanOrEqual(200);
      expect(source[chunks[index]!.startOffset - 1]).toBe('\n');
    }
  });

  it('bounds a single huge line without splitting surrogate pairs or dropping its tail', () => {
    verify('minified.js', `const text = '${'🐈'.repeat(10000)}'; // tail`);
  });

  it('bounds large imports/context, retains comments, JSX and trailing trivia', () => {
    const source = `${`import '${'x'.repeat(3000)}';\n`}export const View = () => <div>${'hello'.repeat(800)}</div>;\n/* trailing */\n`;
    verify('view.tsx', source);
  });

  it('covers malformed syntax without silently losing unparsed text', () => {
    verify('broken.ts', `export function broken( { ${'x! '.repeat(2200)}\n// LAST`);
  });
});
