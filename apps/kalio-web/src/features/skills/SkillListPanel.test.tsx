import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@kalio/types';
import { SkillListPanel } from './SkillListPanel';

const skillA: Skill = {
  id: 'skill-a',
  name: 'Manual QA',
  description: 'Check UI behavior',
  prompt: 'Verify the rendered UI.',
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
};

const skillB: Skill = {
  id: 'skill-b',
  name: 'Bug Hunter',
  description: 'Find defects',
  prompt: 'Find runtime bugs.',
  source: 'agent',
  createdAt: 2,
  updatedAt: 2,
};

describe('SkillListPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads skills, selects one, and clears selection when deleting the active skill', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/skills' && !init?.method) {
        return response([skillA, skillB]);
      }
      if (url === '/api/skills/skill-a' && init?.method === 'DELETE') {
        return response({});
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SkillListPanel selectedId="skill-a" onSelect={onSelect} />);

    await screen.findByText('Manual QA');
    await user.click(screen.getByText('Bug Hunter'));
    expect(onSelect).toHaveBeenCalledWith('skill-b');

    await user.click(screen.getAllByTestId('skill-delete-btn')[0]!);

    await waitFor(() => {
      expect(screen.queryByText('Manual QA')).not.toBeInTheDocument();
    });
    expect(onSelect).toHaveBeenCalledWith(null);
    expect(fetchMock).toHaveBeenCalledWith('/api/skills/skill-a', { method: 'DELETE' });
  });

  it('creates a new skill and selects it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const created: Skill = {
      id: 'skill-new',
      name: 'New Skill',
      description: '',
      prompt: '',
      source: 'user',
      createdAt: 3,
      updatedAt: 3,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/skills' && !init?.method) return response([]);
      if (url === '/api/skills' && init?.method === 'POST') return response(created);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SkillListPanel selectedId={null} onSelect={onSelect} />);

    await screen.findByText('No skills yet. Click + to create.');
    await user.click(screen.getByTestId('new-skill-btn'));

    expect(await screen.findByText('New Skill')).toBeInTheDocument();
    expect(onSelect).toHaveBeenCalledWith('skill-new');
    expect(fetchMock).toHaveBeenCalledWith('/api/skills', expect.objectContaining({
      method: 'POST',
    }));
  });
});

function response(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}
