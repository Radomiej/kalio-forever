import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AllowedPath } from '@kalio/types';
import { AllowedPathsPanel } from './AllowedPathsPanel';

type MockReply = Error | 204 | unknown;

function installFetchQueue(routes: Record<string, MockReply[]>): ReturnType<typeof vi.fn> {
  const queues = new Map(Object.entries(routes));
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method?.toUpperCase() ?? 'GET';
    const key = `${method} ${url}`;
    const queue = queues.get(key);

    if (!queue || queue.length === 0) {
      throw new Error(`Unexpected fetch: ${key}`);
    }

    const reply = queue.shift();
    if (reply instanceof Error) {
      throw reply;
    }
    if (reply === 204) {
      return new Response(null, { status: 204 });
    }

    return new Response(JSON.stringify(reply), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const EXISTING_PATH: AllowedPath = {
  id: 'path-1',
  path: '/workspace/project',
  createdAt: 1,
};

describe('AllowedPathsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loaded paths and empty state', async () => {
    installFetchQueue({
      'GET /api/allowed-paths': [[EXISTING_PATH]],
    });

    render(<AllowedPathsPanel />);

    expect(await screen.findByText('/workspace/project')).toBeInTheDocument();
    expect(screen.queryByText(/No allowed paths configured/i)).not.toBeInTheDocument();
  });

  it('adds a path on Enter and removes it again', async () => {
    const user = userEvent.setup();
    const createdPath: AllowedPath = {
      id: 'path-2',
      path: '/workspace/new-dir',
      createdAt: 2,
    };
    const fetchMock = installFetchQueue({
      'GET /api/allowed-paths': [[]],
      'POST /api/allowed-paths': [createdPath],
      'DELETE /api/allowed-paths/path-2': [204],
    });

    render(<AllowedPathsPanel />);

    const input = await screen.findByTestId('allowed-path-input');
    await user.type(input, '/workspace/new-dir{enter}');

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/allowed-paths' && init?.method === 'POST',
      );

      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({ path: '/workspace/new-dir' });
    });

    expect(input).toHaveValue('');
    expect(await screen.findByText('/workspace/new-dir')).toBeInTheDocument();

    await user.click(screen.getByTestId('allowed-path-remove-path-2'));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/allowed-paths/path-2' && init?.method === 'DELETE',
      )).toBe(true);
      expect(screen.queryByText('/workspace/new-dir')).not.toBeInTheDocument();
    });
  });

  it('keeps allowed paths as manual absolute-path entry only', async () => {
    installFetchQueue({
      'GET /api/allowed-paths': [[]],
    });

    render(<AllowedPathsPanel />);

    await screen.findByTestId('allowed-path-input');
    expect(screen.queryByTitle('Pick folder (if browser supports it)')).not.toBeInTheDocument();
  });
});
