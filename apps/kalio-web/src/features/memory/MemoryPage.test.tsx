import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Persona, MemorySearchResult, MemoryIngestResult } from '@kalio/types';
import { MemoryPage } from './MemoryPage';

const { apiGet, apiPost, apiDelete } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGet,
    post: apiPost,
    delete: apiDelete,
  },
}));

const PERSONA: Persona = {
  id: 'persona-1',
  name: 'Default persona',
  model: 'gpt-4o-mini',
  systemPrompt: 'You are a test persona',
  allowedTools: [],
  skillIds: [],
  mcpPolicy: 'allow_all',
  createdAt: 1,
  updatedAt: 1,
};

const SEARCH_RESULT: MemorySearchResult = {
  id: 'entry-1',
  content: 'Quick brown fox',
  score: 0.91,
  metadata: { source: 'unit' },
  createdAt: 1700000000000,
};

describe('MemoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('alert', vi.fn());
  });

  it('updates freshness state on browse/search/ingest/delete actions', async () => {
    const perPersonaResponses = [
      [{ id: 'entry-existing', content: 'Old memory', score: 0.7, metadata: {}, createdAt: 1 }],
      [{ id: 'entry-existing', content: 'Old memory', score: 0.7, metadata: {}, createdAt: 1 }],
      [],
    ];
    let memoryPersonaCall = 0;

    apiGet.mockImplementation((url: string) => {
      if (url === '/api/personas') {
        return Promise.resolve({ data: [PERSONA] });
      }

      if (url === '/api/memory/search') {
        return Promise.resolve({ data: [SEARCH_RESULT] });
      }

      if (url === `/api/memory/${PERSONA.id}`) {
        const response = perPersonaResponses[memoryPersonaCall] ?? [];
        memoryPersonaCall += 1;
        return Promise.resolve({ data: response });
      }

      throw new Error(`unexpected get call: ${url}`);
    });

    apiPost.mockImplementation((url: string) => {
      if (url === '/api/memory/ingest') {
        const response: MemoryIngestResult = { ids: ['entry-new'], count: 1 };
        return Promise.resolve({ data: response });
      }

      throw new Error(`unexpected post call: ${url}`);
    });

    apiDelete.mockResolvedValue({});

    render(<MemoryPage />);

    await screen.findByText('Default persona');
    await waitFor(() => expect(screen.getByTestId('memory-freshness')).toHaveTextContent('load @'));

    fireEvent.click(screen.getByTestId('memory-browse-btn'));
    await waitFor(() => expect(screen.getByTestId('memory-freshness')).toHaveTextContent('browse @'));

    fireEvent.change(screen.getByTestId('memory-search-input'), {
      target: { value: 'fox' },
    });
    fireEvent.click(screen.getByTestId('memory-search-btn'));

    expect(await screen.findByText('Quick brown fox')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('memory-freshness')).toHaveTextContent('search @'));

    fireEvent.click(screen.getByTestId('memory-ingest-btn'));
    fireEvent.change(screen.getByTestId('memory-ingest-textarea'), {
      target: { value: 'New memory note' },
    });
    fireEvent.click(screen.getByTestId('memory-ingest-submit'));
    await waitFor(() => expect(screen.getByTestId('memory-freshness')).toHaveTextContent('ingest @'));

    const deleteButton = screen.getByTitle('Delete');
    fireEvent.click(deleteButton);
    await waitFor(() => {
      expect(screen.getByTestId('memory-freshness')).toHaveTextContent('delete @');
      expect(screen.queryByText('Quick brown fox')).not.toBeInTheDocument();
    });

    expect(apiGet).toHaveBeenCalledWith(`/api/memory/${PERSONA.id}`);
  });

  it('enables actions for the default active persona before explicit selection', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/personas') {
        return Promise.resolve({ data: [PERSONA] });
      }

      if (url === `/api/memory/${PERSONA.id}`) {
        return Promise.resolve({ data: [] });
      }

      throw new Error(`unexpected get call: ${url}`);
    });

    render(<MemoryPage />);

    await screen.findByText('Default persona');

    expect(screen.getByTestId('memory-ingest-btn')).toBeEnabled();
    expect(screen.getByTestId('memory-browse-btn')).toBeEnabled();

    fireEvent.change(screen.getByTestId('memory-search-input'), {
      target: { value: 'fox' },
    });

    expect(screen.getByTestId('memory-search-btn')).toBeEnabled();
  });
});
