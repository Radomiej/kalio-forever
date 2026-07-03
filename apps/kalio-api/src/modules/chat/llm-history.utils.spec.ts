import { describe, expect, it } from 'vitest';
import { sanitizeToolResultContentForLLM } from './llm-history.utils';

describe('sanitizeToolResultContentForLLM', () => {
  it('keeps bounded web_search chunk previews with citations instead of raw oversized payloads', () => {
    const content = JSON.stringify({
      answer: 'summary',
      citations: ['https://docs.example.com/root'],
      provider: 'perplexity',
      model: 'sonar',
      offline: true,
      results: [
        {
          content: 'A'.repeat(1400),
          citationUrls: ['https://docs.example.com/alpha', 'https://docs.example.com/beta'],
          blockType: 'paragraph',
          headingPath: ['Section'],
        },
        {
          content: 'B'.repeat(1400),
          citationUrls: ['https://docs.example.com/gamma'],
          blockType: 'quote',
          headingPath: ['Section'],
        },
        {
          content: 'C'.repeat(1400),
          citationUrls: ['https://docs.example.com/delta'],
          blockType: 'list',
          headingPath: ['Section'],
        },
        {
          content: 'D'.repeat(1400),
          citationUrls: ['https://docs.example.com/epsilon'],
          blockType: 'paragraph',
          headingPath: ['Section'],
        },
      ],
    });

    const sanitized = sanitizeToolResultContentForLLM(content);
    const parsed = JSON.parse(sanitized) as { results: Array<{ content: string; citationUrls: string[] }> };

    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0]?.content.length).toBeLessThanOrEqual(840);
    expect(parsed.results[0]?.citationUrls).toEqual(['https://docs.example.com/alpha', 'https://docs.example.com/beta']);
  });

  it('drops malformed web_search chunks and clamps answer-level metadata', () => {
    const content = JSON.stringify({
      answer: 'S'.repeat(900),
      citations: [
        'https://docs.example.com/1',
        'https://docs.example.com/2',
        'https://docs.example.com/3',
        'https://docs.example.com/4',
        'https://docs.example.com/5',
        'https://docs.example.com/6',
        'https://docs.example.com/7',
        'https://docs.example.com/8',
        'https://docs.example.com/9',
        42,
      ],
      provider: 'perplexity',
      model: 'sonar',
      offline: false,
      results: [
        {
          content: 'Valid block',
          citationUrls: ['https://docs.example.com/alpha', 99],
          blockType: 'paragraph',
          headingPath: ['Top', 7, 'Leaf'],
        },
        { notContent: 'invalid block' },
      ],
    });

    const sanitized = sanitizeToolResultContentForLLM(content);
    const parsed = JSON.parse(sanitized) as {
      answer: string;
      citations: string[];
      offline: boolean;
      results: Array<{ citationUrls: string[]; headingPath: string[] }>;
    };

    expect(parsed.answer.length).toBeGreaterThan(600);
    expect(parsed.answer).toContain('[truncated ');
    expect(parsed.citations).toHaveLength(8);
    expect(parsed.offline).toBe(false);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({
      content: 'Valid block',
      blockType: 'paragraph',
      citationUrls: ['https://docs.example.com/alpha'],
      headingPath: ['Top', 'Leaf'],
    });
  });

  it('keeps oversized AgentFlow tool results as parseable control metadata', () => {
    const content = JSON.stringify({
      flowRunId: 'flow-1',
      flowDefinitionId: 'goal_guard_delivery_loop',
      parentSessionId: 'parent-1',
      parentToolCallId: 'tool-1',
      childSessionId: 'child-1',
      status: 'completed',
      summary: 'AgentFlow completed with deterministic evidence.',
      decisions: ['accepted'],
      nextActions: ['continue parent chat'],
      artifacts: ['architecture.md'],
      openChatSessionId: 'child-1',
      openGraphRunId: 'graph-1',
      tracePreview: Array.from({ length: 80 }, (_, index) => ({
        id: `event-${index}`,
        message: 'large trace event '.repeat(80),
        detail: { payload: 'x'.repeat(500) },
      })),
    });

    const sanitized = sanitizeToolResultContentForLLM(content);
    const parsed = JSON.parse(sanitized) as {
      flowRunId?: string;
      childSessionId?: string;
      tracePreview?: unknown[];
    };

    expect(parsed.flowRunId).toBe('flow-1');
    expect(parsed.childSessionId).toBe('child-1');
    expect(JSON.stringify(parsed).length).toBeLessThanOrEqual(4000);
    expect(parsed.tracePreview).toEqual([
      { omitted: 80, reason: 'omitted for context safety' },
    ]);
  });
});
