import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMContextPreview } from '@kalio/types';

const apiGetMock = vi.hoisted(() => vi.fn());
const apiPostMock = vi.hoisted(() => vi.fn());

vi.mock('../../../services/apiClient', () => ({
  apiClient: {
    get: apiGetMock,
    post: apiPostMock,
  },
}));

import { useContextPreview } from './useContextPreview';

function makePreview(overrides: Partial<LLMContextPreview> = {}): LLMContextPreview {
  return {
    sessionId: 'session-1',
    personaId: 'persona-1',
    model: 'mimo-v2.5',
    contextLimit: 32000,
    estimatedTokens: {
      total: 120,
      systemPrompt: 40,
      tools: 20,
      history: 50,
      images: 0,
      reasoning: 10,
    },
    compaction: {
      applied: false,
      unboundedMessageCount: 2,
      finalMessageCount: 2,
      safeTargetTokens: 25600,
    },
    effectiveSystemPrompt: 'Effective prompt',
    tools: [],
    messages: [
      { role: 'system', content: 'Effective prompt', source: 'system_prompt', estimatedTokens: 40 },
      { role: 'user', content: 'draft', source: 'draft', estimatedTokens: 5 },
    ],
    ...overrides,
  };
}

describe('useContextPreview', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    apiPostMock.mockResolvedValue({ data: makePreview() });
  });

  it('fetches backend context preview with the unsent draft message', async () => {
    const { result } = renderHook(() => useContextPreview({
      sessionId: 'session-1',
      personaId: 'persona-1',
      draftUserMessage: 'draft',
      refreshKey: 0,
    }));

    await waitFor(() => expect(result.current.preview).toBeTruthy());

    expect(apiPostMock).toHaveBeenCalledWith('/api/sessions/session-1/context-preview', {
      personaId: 'persona-1',
      draftUserMessage: 'draft',
      attachments: undefined,
    });
    expect(result.current.tokenCount?.total).toBe(120);
    expect(result.current.preview?.messages.at(-1)?.source).toBe('draft');
  });

  it('marks existing preview stale while a manual invalidation refresh is pending', async () => {
    let resolveSecond!: (value: { data: LLMContextPreview }) => void;
    apiPostMock
      .mockResolvedValueOnce({ data: makePreview({ estimatedTokens: { ...makePreview().estimatedTokens, total: 120 } }) })
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    const { result } = renderHook(() => useContextPreview({
      sessionId: 'session-1',
      personaId: 'persona-1',
      draftUserMessage: 'draft',
      refreshKey: 0,
    }));

    await waitFor(() => expect(result.current.preview).toBeTruthy());

    act(() => result.current.invalidate());

    await waitFor(() => expect(result.current.stale).toBe(true));

    await act(async () => {
      resolveSecond({ data: makePreview({ estimatedTokens: { ...makePreview().estimatedTokens, total: 240 } }) });
    });

    await waitFor(() => expect(result.current.tokenCount?.total).toBe(240));
    expect(result.current.stale).toBe(false);
  });

  it('ignores stale responses when a newer request finishes first', async () => {
    let resolveFirst!: (value: { data: LLMContextPreview }) => void;
    apiPostMock
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({ data: makePreview({ estimatedTokens: { ...makePreview().estimatedTokens, total: 300 } }) });

    const { result, rerender } = renderHook(
      ({ draft }) => useContextPreview({
        sessionId: 'session-1',
        personaId: 'persona-1',
        draftUserMessage: draft,
        refreshKey: 0,
      }),
      { initialProps: { draft: 'old draft' } },
    );

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1));
    rerender({ draft: 'new draft' });
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.tokenCount?.total).toBe(300));

    await act(async () => {
      resolveFirst({ data: makePreview({ estimatedTokens: { ...makePreview().estimatedTokens, total: 100 } }) });
    });

    expect(result.current.tokenCount?.total).toBe(300);
  });

  it('ignores an in-flight response after session is cleared', async () => {
    let resolveFirst!: (value: { data: LLMContextPreview }) => void;
    apiPostMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveFirst = resolve;
    }));

    const { result, rerender } = renderHook(
      ({ sessionId }) => useContextPreview({
        sessionId,
        personaId: sessionId ? 'persona-1' : null,
        draftUserMessage: 'draft',
        refreshKey: 0,
      }),
      { initialProps: { sessionId: 'session-1' as string | null } },
    );

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledTimes(1));

    rerender({ sessionId: null });

    await act(async () => {
      resolveFirst({ data: makePreview({ estimatedTokens: { ...makePreview().estimatedTokens, total: 999 } }) });
    });

    expect(result.current.preview).toBeNull();
    expect(result.current.tokenCount).toBeNull();
  });

  it('does not call the backend for pending host-session ids', () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useContextPreview({
      sessionId: 'pending-host-session:temp-1',
      personaId: 'persona-1',
      draftUserMessage: 'draft',
      refreshKey: 0,
    }));

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(apiPostMock).not.toHaveBeenCalled();
    expect(result.current.preview).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('keeps the previous preview marked stale when a refresh fails', async () => {
    apiPostMock
      .mockResolvedValueOnce({ data: makePreview() })
      .mockRejectedValueOnce(new Error('Preview failed'));

    const { result } = renderHook(() => useContextPreview({
      sessionId: 'session-1',
      personaId: 'persona-1',
      draftUserMessage: 'draft',
      refreshKey: 0,
    }));

    await waitFor(() => expect(result.current.preview).toBeTruthy());

    act(() => result.current.invalidate());

    await waitFor(() => expect(result.current.error).toBe('Preview failed'));
    expect(result.current.preview).toBeTruthy();
    expect(result.current.stale).toBe(true);
  });
});
