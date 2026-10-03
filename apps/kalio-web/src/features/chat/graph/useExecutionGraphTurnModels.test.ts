import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useExecutionGraphTurnModels } from './useExecutionGraphTurnModels';
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../services/apiClient', () => ({ apiClient: { get } }));
beforeEach(() => { get.mockReset(); });

it('loads only the selected session audit and clears evidence when the session changes', async () => {
  get.mockResolvedValueOnce({ data: [{ sessionId: 'first', type: 'runtime_event', label: 'llm.turn.started',
    data: { turnId: 'turn', model: 'swe-2' }, createdAt: 1, id: 'audit', durationMs: null, chunkCount: null }] });
  const { result, rerender } = renderHook(({ sessionId }) => useExecutionGraphTurnModels(sessionId, 'done'),
    { initialProps: { sessionId: 'first' } });
  await waitFor(() => expect(result.current.entries).toHaveLength(1));
  const query = new URLSearchParams(get.mock.calls[0][0].split('?')[1]);
  expect(query.get('sessionId')).toBe('first');
  expect(query.get('source')).toBe('all');
  get.mockReturnValueOnce(new Promise(() => undefined));
  rerender({ sessionId: 'second' });
  expect(result.current.entries).toEqual([]);
});

it('exposes failure without using fabricated model evidence', async () => {
  get.mockImplementation(async () => { throw new Error('offline'); });
  const { result } = renderHook(() => useExecutionGraphTurnModels('session', 'done'));
  await waitFor(() => expect(result.current.error).toBe('offline'));
  expect(result.current.entries).toEqual([]);
});
