import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@kalio/types';
import { SkillEditorPanel } from './SkillEditorPanel';

const skill: Skill = {
  id: 'skill-a',
  name: 'Manual QA',
  description: 'Check UI behavior',
  prompt: 'Verify the rendered UI.',
  source: 'user',
  createdAt: new Date('2026-05-31T10:00:00Z').getTime(),
  updatedAt: new Date('2026-05-31T10:00:00Z').getTime(),
};

describe('SkillEditorPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an empty selection state without fetching', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<SkillEditorPanel skillId={null} />);

    expect(screen.getByText('Select a skill to edit')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads a skill and saves edited fields', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/skills/skill-a' && !init?.method) return response(skill);
      if (url === '/api/skills/skill-a' && init?.method === 'PUT') return response({});
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SkillEditorPanel skillId="skill-a" />);

    const nameInput = await screen.findByTestId('skill-name-input');
    expect(nameInput).toHaveValue('Manual QA');

    await user.clear(nameInput);
    await user.type(nameInput, 'Manual QA Pro');
    await user.clear(screen.getByDisplayValue('Check UI behavior'));
    await user.type(screen.getByPlaceholderText('What does this skill do?'), 'Check the full user flow');
    await user.clear(screen.getByDisplayValue('Verify the rendered UI.'));
    await user.type(screen.getByPlaceholderText(/Enter the prompt snippet this skill injects/), 'Verify FE and BE evidence.');
    await user.click(screen.getByTestId('skill-save-btn'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/skills/skill-a', expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          name: 'Manual QA Pro',
          description: 'Check the full user flow',
          prompt: 'Verify FE and BE evidence.',
        }),
      }));
    });
    expect(await screen.findByText('✓ Saved')).toBeInTheDocument();
  });
});

function response(data: unknown): Response {
  return {
    ok: true,
    json: async () => data,
  } as Response;
}
