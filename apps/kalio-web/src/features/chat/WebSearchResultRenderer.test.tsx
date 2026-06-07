import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WebSearchResultRenderer } from './WebSearchResultRenderer';

describe('WebSearchResultRenderer', () => {
  it('renders offline web_search chunks with headings and source links', () => {
    render(
      <WebSearchResultRenderer
        data={{
          offline: true,
          results: [
            {
              content: 'Stored web result about TypeScript 5.8',
              citationUrls: ['https://example.com/typescript'],
              blockType: 'paragraph',
              headingPath: ['Release Notes'],
              webResultId: 'web-1',
              blockIndex: 0,
              query: 'TypeScript latest',
              provider: 'perplexity',
              model: 'sonar',
            },
            {
              content: 'Stored release note summary',
              citationUrls: ['https://example.com/release-note'],
              blockType: 'list',
              headingPath: ['Highlights'],
              webResultId: 'web-1',
              blockIndex: 1,
              query: 'TypeScript latest',
              provider: 'perplexity',
              model: 'sonar',
            },
          ],
        }}
      />,
    );

    expect(screen.getByTestId('web-search-result-renderer')).toBeInTheDocument();
    expect(screen.getByText('offline memory')).toBeInTheDocument();
    expect(screen.getByText('2 results')).toBeInTheDocument();
    expect(screen.getByText('Stored web result about TypeScript 5.8')).toBeInTheDocument();
    expect(screen.getByText('Stored release note summary')).toBeInTheDocument();
    expect(screen.getByText('paragraph')).toBeInTheDocument();
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(screen.getByText('Release Notes')).toBeInTheDocument();
    expect(screen.getByText('Highlights')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/typescript' })).toHaveAttribute('href', 'https://example.com/typescript');
    expect(screen.getByRole('link', { name: 'https://example.com/release-note' })).toHaveAttribute('href', 'https://example.com/release-note');
  });

  it('renders online web_search chunks without empty heading or source sections', () => {
    render(
      <WebSearchResultRenderer
        data={{
          offline: false,
          results: [
            {
              content: 'Fresh answer from live search',
              citationUrls: [],
              blockType: 'code',
              headingPath: [],
              webResultId: 'web-2',
              blockIndex: 0,
              query: 'latest release',
              provider: 'perplexity',
              model: 'sonar',
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('web results')).toBeInTheDocument();
    expect(screen.getByText('1 result')).toBeInTheDocument();
    expect(screen.getByText('Fresh answer from live search')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(' > ')).not.toBeInTheDocument();
  });
});
