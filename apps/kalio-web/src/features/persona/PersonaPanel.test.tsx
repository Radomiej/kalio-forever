import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Persona } from '@kalio/types';
import { PersonaPanel } from './PersonaPanel';

const apiClientMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({ apiClient: apiClientMock }));

const EXISTING_PERSONA: Persona = {
  id: 'persona-existing',
  name: 'Existing Persona',
  systemPrompt: 'Stay focused on the current plan.',
  model: 'gpt-4o-mini',
  allowedTools: ['vfs_read_file'],
  skillIds: [],
  mcpPolicy: 'allow_all',
  createdAt: 1,
  updatedAt: 1,
};

const UPDATED_PERSONA: Persona = {
  ...EXISTING_PERSONA,
  name: 'Updated Persona',
  model: 'gpt-4.1-mini',
  systemPrompt: 'Trimmed prompt.',
  updatedAt: 2,
};

const CREATED_PERSONA: Persona = {
  id: 'persona-created',
  name: 'New Planner',
  systemPrompt: 'Plan the next step before acting.',
  model: 'gpt-4o-mini',
  allowedTools: [],
  skillIds: [],
  mcpPolicy: 'deny_all',
  createdAt: 3,
  updatedAt: 3,
};

function setPersonaGetResponse(personas: Persona[]) {
  apiClientMock.get.mockResolvedValueOnce({ data: personas });
}

describe('PersonaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads personas and creates a new persona from the form', async () => {
    const user = userEvent.setup();
    setPersonaGetResponse([EXISTING_PERSONA]);
    apiClientMock.post.mockResolvedValueOnce({ data: CREATED_PERSONA });

    render(<PersonaPanel />);

    expect(await screen.findByRole('heading', { name: 'Existing Persona' })).toBeInTheDocument();
    expect(screen.getByText('1 persona')).toBeInTheDocument();

    await user.click(screen.getByTestId('new-persona-btn'));
    const saveButton = screen.getByTestId('persona-save-btn');
    expect(saveButton).toBeDisabled();

    await user.type(screen.getByTestId('persona-name-input'), 'New Planner');
    await user.clear(screen.getByTestId('persona-model-input'));
    await user.type(screen.getByTestId('persona-model-input'), 'gpt-4o-mini');
    await user.clear(screen.getByTestId('persona-prompt-textarea'));
    await user.type(screen.getByTestId('persona-prompt-textarea'), 'Plan the next step before acting.');

    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => {
      expect(apiClientMock.post).toHaveBeenCalledWith('/api/personas', {
        name: 'New Planner',
        model: 'gpt-4o-mini',
        systemPrompt: 'Plan the next step before acting.',
        allowedTools: [],
        mcpPolicy: 'allow_all',
      });
    });

    expect(await screen.findByRole('heading', { name: 'New Planner' })).toBeInTheDocument();
    expect(screen.getByText('2 personas')).toBeInTheDocument();
  });

  it('edits a persona and persists the trimmed update payload', async () => {
    const user = userEvent.setup();
    setPersonaGetResponse([EXISTING_PERSONA]);
    apiClientMock.put.mockResolvedValueOnce({ data: UPDATED_PERSONA });

    render(<PersonaPanel />);

    await screen.findByRole('heading', { name: 'Existing Persona' });
    await user.click(screen.getByTitle('Edit'));

    const row = screen.getByTestId('persona-item');
    const scoped = within(row);
    await user.clear(scoped.getByDisplayValue('Existing Persona'));
    await user.type(scoped.getByPlaceholderText('Name'), 'Updated Persona');
    await user.clear(scoped.getByDisplayValue('gpt-4o-mini'));
    await user.type(scoped.getByPlaceholderText('Model'), 'gpt-4.1-mini');
    const promptField = scoped.getByDisplayValue('Stay focused on the current plan.');
    await user.clear(promptField);
    await user.type(promptField, 'Trimmed prompt.');

    await user.click(scoped.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(apiClientMock.put).toHaveBeenCalledWith('/api/personas/persona-existing', {
        name: 'Updated Persona',
        model: 'gpt-4.1-mini',
        systemPrompt: 'Trimmed prompt.',
        allowedTools: ['vfs_read_file'],
        mcpPolicy: 'allow_all',
      });
    });

    expect(await screen.findByRole('heading', { name: 'Updated Persona' })).toBeInTheDocument();
  });

  it('shows a load error and retries the personas request', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiClientMock.get
      .mockRejectedValueOnce(new Error('persona service offline'))
      .mockResolvedValueOnce({ data: [EXISTING_PERSONA] });

    render(<PersonaPanel />);

    expect((await screen.findAllByText('Unable to load personas')).length).toBe(2);

    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0]);

    await waitFor(() => {
      expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByRole('heading', { name: 'Existing Persona' })).toBeInTheDocument();

    errorSpy.mockRestore();
  });
});
