import { describe, expect, it } from 'vitest';
import { chunkWebSearchResult } from './web-search-chunking';

const citations = [
  'https://docs.example.com/alpha',
  'https://docs.example.com/beta',
  'https://docs.example.com/gamma',
];

describe('chunkWebSearchResult', () => {
  it('keeps paragraphs whole and binds citations from inline markers', () => {
    const chunks = chunkWebSearchResult({
      query: 'latest alpha beta',
      answer: [
        '# Section One',
        '',
        'Alpha paragraph stays whole and cites [1].',
        '',
        'Beta paragraph stays whole and cites [2][3].',
      ].join('\n'),
      citations,
      provider: 'perplexity',
      model: 'sonar',
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      blockType: 'paragraph',
      headingPath: ['Section One'],
      citationUrls: ['https://docs.example.com/alpha'],
      content: 'Alpha paragraph stays whole and cites [1].',
    });
    expect(chunks[1]).toMatchObject({
      blockType: 'paragraph',
      headingPath: ['Section One'],
      citationUrls: ['https://docs.example.com/beta', 'https://docs.example.com/gamma'],
      content: 'Beta paragraph stays whole and cites [2][3].',
    });
  });

  it('groups list and quote blocks without splitting them', () => {
    const chunks = chunkWebSearchResult({
      query: 'list and quote',
      answer: [
        '## Notes',
        '',
        '- First bullet [1]',
        '- Second bullet [1]',
        '',
        '> Quoted evidence line one [2]',
        '> Quoted evidence line two [2]',
      ].join('\n'),
      citations,
      provider: 'perplexity',
      model: 'sonar',
    });

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      blockType: 'list',
      headingPath: ['Notes'],
      citationUrls: ['https://docs.example.com/alpha'],
    });
    expect(chunks[0]?.content).toContain('- First bullet [1]');
    expect(chunks[0]?.content).toContain('- Second bullet [1]');
    expect(chunks[1]).toMatchObject({
      blockType: 'quote',
      headingPath: ['Notes'],
      citationUrls: ['https://docs.example.com/beta'],
    });
    expect(chunks[1]?.content).toContain('> Quoted evidence line one [2]');
  });

  it('keeps fenced code as one block when it fits', () => {
    const chunks = chunkWebSearchResult({
      query: 'fenced code',
      answer: [
        '### Example',
        '',
        '```ts',
        'const value = 1;',
        'console.log(value);',
        '```',
      ].join('\n'),
      citations,
      provider: 'perplexity',
      model: 'sonar',
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      blockType: 'code',
      headingPath: ['Example'],
      citationUrls: citations,
    });
    expect(chunks[0]?.content).toContain('```ts');
    expect(chunks[0]?.content).toContain('console.log(value);');
  });

  it('falls back to all citations when inline markers are missing', () => {
    const chunks = chunkWebSearchResult({
      query: 'no markers',
      answer: 'This paragraph has no explicit markers but should keep all sources.',
      citations,
      provider: 'perplexity',
      model: 'sonar',
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.citationUrls).toEqual(citations);
  });

  it('splits oversized paragraphs by sentence boundaries before whitespace fallback', () => {
    const longSentence = 'This sentence is intentionally verbose so the block grows well past the configured soft limit while still ending cleanly.';
    const answer = `${longSentence} ${longSentence} ${longSentence} ${longSentence} ${longSentence} ${longSentence}`;

    const chunks = chunkWebSearchResult({
      query: 'oversized paragraph',
      answer,
      citations,
      provider: 'perplexity',
      model: 'sonar',
      limits: { soft: 220, hard: 280, overlap: 40 },
    });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 280)).toBe(true);
    expect(chunks[0]?.content.endsWith('.')).toBe(true);
    expect(chunks[1]?.content.includes('This sentence')).toBe(true);
  });
});
