import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('./PersonaToolPicker', () => ({
  PersonaToolPicker: () => <div data-testid="persona-tool-picker" />,
  PersonaToolBadges: () => <div data-testid="persona-tool-badges" />,
}));

const EXISTING_PERSONA: Persona = {
  id: 'persona-existing',
  name: 'Existing Persona',
  systemPrompt: 'Stay focused on the current plan.',
  model: 'gpt-4o-mini',
  maxToolAttempts: 60,
  allowedTools: ['vfs_read_file'],
  skillIds: [],
  mcpPolicy: 'allow_all',
  avatarSeed: 'existing persona',
  avatarVariant: 'marble',
  avatarPaletteKey: 'ocean',
  avatarIndex: 0,
  createdAt: 1,
  updatedAt: 1,
};

const UPDATED_PERSONA: Persona = {
  ...EXISTING_PERSONA,
  name: 'Updated Persona',
  model: 'gpt-4.1-mini',
  systemPrompt: 'Trimmed prompt.',
  maxToolAttempts: 75,
  updatedAt: 2,
};

const CREATED_PERSONA: Persona = {
  id: 'persona-created',
  name: 'New Planner',
  systemPrompt: 'Plan the next step before acting.',
  model: 'gpt-4o-mini',
  maxToolAttempts: 60,
  allowedTools: [],
  skillIds: [],
  mcpPolicy: 'deny_all',
  avatarSeed: 'new planner',
  avatarVariant: 'marble',
  avatarPaletteKey: 'ocean',
  avatarIndex: 0,
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

  it('loads personas and creates a new persona from the main editor', async () => {
    const user = userEvent.setup();
    setPersonaGetResponse([EXISTING_PERSONA]);
    apiClientMock.post.mockResolvedValueOnce({ data: CREATED_PERSONA });

    render(<PersonaPanel />);

    expect(await screen.findByTestId('persona-editor')).toBeInTheDocument();
    expect(screen.getByText('1 persona')).toBeInTheDocument();
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument();

    await user.click(screen.getByTestId('new-persona-btn'));
    const saveButton = screen.getByTestId('persona-save-btn');
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'New Planner' } });
    fireEvent.change(screen.getByTestId('persona-model-input'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.change(screen.getByTestId('persona-prompt-textarea'), { target: { value: 'Plan the next step before acting.' } });
    fireEvent.change(screen.getByTestId('persona-max-tool-attempts-input'), { target: { value: '60' } });

    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => {
      expect(apiClientMock.post).toHaveBeenCalledWith('/api/personas', {
        name: 'New Planner',
        model: 'gpt-4o-mini',
        systemPrompt: 'Plan the next step before acting.',
        maxToolAttempts: 60,
        allowedTools: [],
        mcpPolicy: 'allow_all',
        avatarSeed: 'new planner',
        avatarVariant: 'marble',
        avatarPaletteKey: 'ocean',
        avatarIndex: 0,
      });
    });

    expect(await screen.findByDisplayValue('New Planner')).toBeInTheDocument();
    expect(screen.getByText('2 personas')).toBeInTheDocument();
  });

  it('edits a persona from the main editor and persists the trimmed update payload', async () => {
    const user = userEvent.setup();
    setPersonaGetResponse([EXISTING_PERSONA]);
    apiClientMock.put.mockResolvedValueOnce({ data: UPDATED_PERSONA });

    render(<PersonaPanel />);

    await screen.findByDisplayValue('Existing Persona');
    expect(screen.getByTestId('persona-max-tool-attempts-input')).toHaveValue(60);
    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'Updated Persona' } });
    fireEvent.change(screen.getByTestId('persona-model-input'), { target: { value: 'gpt-4.1-mini' } });
    fireEvent.change(screen.getByTestId('persona-prompt-textarea'), { target: { value: 'Trimmed prompt.' } });
    fireEvent.change(screen.getByTestId('persona-max-tool-attempts-input'), { target: { value: '75' } });

    await user.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      expect(apiClientMock.put).toHaveBeenCalledWith('/api/personas/persona-existing', {
        name: 'Updated Persona',
        model: 'gpt-4.1-mini',
        systemPrompt: 'Trimmed prompt.',
        maxToolAttempts: 75,
        allowedTools: ['vfs_read_file'],
        mcpPolicy: 'allow_all',
        avatarSeed: 'existing persona',
        avatarVariant: 'marble',
        avatarPaletteKey: 'ocean',
        avatarIndex: 0,
      });
    });

    expect(await screen.findByDisplayValue('Updated Persona')).toBeInTheDocument();
  });

  it('shows a load error and retries the personas request', async () => {
    const user = userEvent.setup();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    apiClientMock.get
      .mockRejectedValueOnce(new Error('persona service offline'))
      .mockResolvedValueOnce({ data: [EXISTING_PERSONA] });

    render(<PersonaPanel />);

    expect((await screen.findAllByText('Unable to load personas')).length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: 'Retry' })[0]);

    await waitFor(() => {
      expect(apiClientMock.get).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByDisplayValue('Existing Persona')).toBeInTheDocument();

    errorSpy.mockRestore();
  });
});
