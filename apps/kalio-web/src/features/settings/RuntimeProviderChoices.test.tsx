import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimeProviderChoices } from './RuntimeProviderChoices';

const mocks = vi.hoisted(() => ({ request: vi.fn(), profiles: vi.fn() }));
vi.mock('../../services/apiClient', () => ({ getExecutionProfiles: mocks.profiles }));
vi.mock('./decision-settings.transport', () => ({ decisionSettingsRequest: mocks.request }));

describe('RuntimeProviderChoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.request.mockImplementation(async (_path: string, init?: RequestInit) => new Response(JSON.stringify({ executionProfileId: init?.method === 'PUT' ? 'devin' : null })));
    mocks.profiles.mockResolvedValue([{ id: 'devin', name: 'Devin local', kind: 'devin-cli-acp', model: 'swe-2', enabled: true }]);
  });

  it('shows Devin and persists an explicit default selection, not merely an API credential', async () => {
    render(<RuntimeProviderChoices />);
    await screen.findByRole('option', { name: 'Devin · swe-2' });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Default connected agent'), { target: { value: 'devin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use by default' }));
    await screen.findByRole('button', { name: 'Default agent saved' });
    expect(mocks.request).toHaveBeenCalledWith('/api/runtime/default-profile', { method: 'PUT', body: JSON.stringify({ executionProfileId: 'devin' }) });
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });

  it('retains a saved unavailable agent instead of silently selecting another provider', async () => {
    mocks.request.mockImplementation(async () => new Response(JSON.stringify({ executionProfileId: 'missing' })));
    render(<RuntimeProviderChoices />);
    await screen.findByRole('option', { name: 'Saved agent unavailable' });
    await waitFor(() => expect(screen.getByLabelText('Default connected agent')).toHaveValue('missing'));
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
