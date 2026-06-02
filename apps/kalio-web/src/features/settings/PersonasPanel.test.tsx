import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Persona, ToolMeta } from '@kalio/types';
import { PersonasPanel } from './PersonasPanel';

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

const TOOLS: ToolMeta[] = [
  {
    name: 'web_search',
    description: 'Search the web',
    parameters: { type: 'object' },
    requiresConfirmation: false,
  },
  {
    name: 'shell_exec',
    description: 'Execute shell commands',
    parameters: { type: 'object' },
    requiresConfirmation: true,
  },
];

const SYSTEM_PERSONA: Persona = {
  id: 'default',
  name: 'Default',
  systemPrompt: 'Default prompt',
  model: 'gpt-4o-mini',
  allowedTools: [],
  skillIds: [],
  mcpPolicy: 'allow_all',
  createdAt: 1,
  updatedAt: 1,
};

const CUSTOM_PERSONA: Persona = {
  id: 'builder',
  name: 'Builder',
  systemPrompt: 'Build things',
  model: 'claude-sonnet',
  allowedTools: ['web_search'],
  skillIds: [],
  mcpPolicy: 'allow_list',
  createdAt: 2,
  updatedAt: 2,
};

describe('PersonasPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  it('loads personas and shows system/tool metadata', async () => {
    installFetchQueue({
      'GET /api/personas': [[SYSTEM_PERSONA, CUSTOM_PERSONA]],
      'GET /api/tools': [TOOLS],
    });

    render(<PersonasPanel />);

    const systemRow = await screen.findByTestId('persona-row-default');
    const customRow = screen.getByTestId('persona-row-builder');

    expect(within(systemRow).getByText('system')).toBeInTheDocument();
    expect(within(systemRow).getByText('All 2 tools')).toBeInTheDocument();
    expect(within(customRow).getByText('1 tools')).toBeInTheDocument();
    expect(within(customRow).getByText('Build things')).toBeInTheDocument();
  });

  it('validates blank names and creates a persona with an explicit tool allowlist', async () => {
    const createdPersona: Persona = {
      id: 'researcher',
      name: 'Researcher',
      systemPrompt: 'Investigate carefully',
      model: 'gpt-4.1',
      allowedTools: ['shell_exec'],
      skillIds: [],
      mcpPolicy: 'allow_all',
      createdAt: 3,
      updatedAt: 3,
    };
    const fetchMock = installFetchQueue({
      'GET /api/personas': [[], [createdPersona]],
      'GET /api/tools': [TOOLS, TOOLS],
      'POST /api/personas': [createdPersona],
    });

    render(<PersonasPanel />);

    await screen.findByTestId('new-persona-btn');
    fireEvent.click(screen.getByTestId('new-persona-btn'));
    fireEvent.click(await screen.findByTestId('persona-save-btn'));

    expect(await screen.findByTestId('persona-edit-error')).toHaveTextContent('Name is required');
    expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/personas' && init?.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'Researcher' } });
    fireEvent.change(screen.getByTestId('persona-prompt-input'), { target: { value: 'Investigate carefully' } });
    fireEvent.change(screen.getByTestId('persona-model-input'), { target: { value: 'gpt-4.1' } });

    fireEvent.click(screen.getByTestId('tool-toggle-all'));
    fireEvent.click(within(screen.getByTestId('tool-toggle-web_search')).getByRole('checkbox'));
    fireEvent.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/personas' && init?.method === 'POST',
      );

      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        name: 'Researcher',
        systemPrompt: 'Investigate carefully',
        model: 'gpt-4.1',
        allowedTools: ['shell_exec'],
      });
    });

    expect(await screen.findByTestId('persona-row-researcher')).toBeInTheDocument();
  });

  it('updates and deletes an existing custom persona', async () => {
    const updatedPersona: Persona = {
      ...CUSTOM_PERSONA,
      name: 'Builder v2',
      systemPrompt: 'Build safer things',
      model: 'claude-opus',
      updatedAt: 4,
    };
    const fetchMock = installFetchQueue({
      'GET /api/personas': [[CUSTOM_PERSONA], [updatedPersona], []],
      'GET /api/tools': [TOOLS, TOOLS, TOOLS],
      'PUT /api/personas/builder': [updatedPersona],
      'DELETE /api/personas/builder': [204],
    });

    render(<PersonasPanel />);

    fireEvent.click(await screen.findByTestId('persona-row-builder'));

    const nameInput = await screen.findByTestId('persona-name-input');
    fireEvent.change(nameInput, { target: { value: 'Builder v2' } });

    fireEvent.change(screen.getByTestId('persona-prompt-input'), { target: { value: 'Build safer things' } });
    fireEvent.change(await screen.findByTestId('persona-model-input'), { target: { value: 'claude-opus' } });

    fireEvent.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([url, init]) => url === '/api/personas/builder' && init?.method === 'PUT',
      );

      expect(call).toBeDefined();
      expect(JSON.parse(String(call?.[1]?.body))).toEqual({
        name: 'Builder v2',
        systemPrompt: 'Build safer things',
        model: 'claude-opus',
        allowedTools: ['web_search'],
      });
    });

    expect(await screen.findByText('Builder v2')).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId('persona-row-builder'));
    fireEvent.click(await screen.findByTestId('persona-delete-btn'));

    await waitFor(() => {
      expect(globalThis.confirm).toHaveBeenCalledWith('Delete persona "Builder v2"? This cannot be undone.');
      expect(fetchMock.mock.calls.some(
        ([url, init]) => url === '/api/personas/builder' && init?.method === 'DELETE',
      )).toBe(true);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('persona-row-builder')).not.toBeInTheDocument();
    });
  });
});
