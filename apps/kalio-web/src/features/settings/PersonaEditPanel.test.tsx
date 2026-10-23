import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExecutionProfile } from '@kalio/types';
import { PersonaEditPanel } from './PersonaEditPanel';

const getDevinCliStatusMock = vi.hoisted(() => vi.fn());
const resolveDevinCliExecutionProfileMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/apiClient', () => ({
  getDevinCliStatus: getDevinCliStatusMock,
  resolveDevinCliExecutionProfile: resolveDevinCliExecutionProfileMock,
}));

const DEVIN_PROFILE: ExecutionProfile = {
  id: 'devin-local-swe-2-high',
  name: 'Devin · swe-2-high',
  kind: 'devin-cli-acp',
  model: 'swe-2-high',
  approvalMode: 'kalio_strict',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
};

describe('PersonaEditPanel Devin CLI binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/runtime/profiles' || url === '/api/credentials') {
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
    getDevinCliStatusMock.mockResolvedValue({
      models: ['swe-2-high'],
      modelCatalogStatus: 'ready',
      modelCatalogStale: false,
      modelCatalogDiscoveredAt: 10,
    });
    resolveDevinCliExecutionProfileMock.mockResolvedValue(DEVIN_PROFILE);
  });

  it('binds a model discovered at runtime and persists its resolved profile', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PersonaEditPanel persona={null} tools={[]} onSave={onSave} onDelete={vi.fn()} onClose={vi.fn()} />);

    const runtimeSelect = await screen.findByTestId('persona-runtime-kind-select');
    await waitFor(() => expect(runtimeSelect).toBeEnabled());
    await user.selectOptions(runtimeSelect, 'devin-cli-acp');
    await user.selectOptions(await screen.findByTestId('persona-model-input'), 'swe-2-high');
    fireEvent.change(screen.getByTestId('persona-name-input'), { target: { value: 'Devin Settings' } });
    fireEvent.change(screen.getByTestId('persona-prompt-input'), { target: { value: 'Use Devin.' } });
    await user.click(screen.getByTestId('persona-save-btn'));

    await waitFor(() => {
      expect(resolveDevinCliExecutionProfileMock).toHaveBeenCalledWith('swe-2-high');
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Devin Settings',
        model: 'swe-2-high',
        executionProfileId: DEVIN_PROFILE.id,
      }));
    });
  });
});
