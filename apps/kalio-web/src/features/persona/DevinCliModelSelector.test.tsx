import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExecutionProfile } from '@kalio/types';
import { DevinCliModelSelector } from './DevinCliModelSelector';

const getDevinCliStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/apiClient', () => ({
  getDevinCliStatus: getDevinCliStatusMock,
}));

const STORED_PROFILE: ExecutionProfile = {
  id: 'devin-old-model',
  name: 'Devin old model',
  kind: 'devin-cli-acp',
  model: 'old-saved-model',
  approvalMode: 'kalio_strict',
  enabled: true,
  capabilitiesVersion: '1',
  createdAt: 1,
  updatedAt: 1,
};

describe('DevinCliModelSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads fresh models dynamically and filters the selectable list', async () => {
    const user = userEvent.setup();
    getDevinCliStatusMock.mockResolvedValue({
      models: ['glm-5-2', 'swe-2-high', 'swe-2-medium', 'swe-2-max'],
      modelCatalogStatus: 'ready',
      modelCatalogStale: false,
      modelCatalogDiscoveredAt: 10,
    });
    const onChange = vi.fn();

    render(<DevinCliModelSelector profiles={[]} model="" onChange={onChange} />);

    const select = await screen.findByTestId('persona-model-input');
    expect(getDevinCliStatusMock).toHaveBeenCalledWith(true);
    expect(select.querySelectorAll('option')).toHaveLength(5);
    await user.type(screen.getByTestId('persona-devin-model-search'), 'swe-2-');
    expect(select.querySelectorAll('option')).toHaveLength(4);
    await user.selectOptions(select, 'swe-2-high');
    expect(onChange).toHaveBeenCalledWith('swe-2-high');
  });

  it('keeps an existing saved model visible when discovery fails and supports retry', async () => {
    const user = userEvent.setup();
    getDevinCliStatusMock
      .mockResolvedValueOnce({ models: [], modelCatalogStatus: 'command-failed', modelCatalogStale: false, modelCatalogDiscoveredAt: null })
      .mockResolvedValueOnce({ models: ['old-saved-model'], modelCatalogStatus: 'ready', modelCatalogStale: false, modelCatalogDiscoveredAt: 20 });

    render(<DevinCliModelSelector profiles={[STORED_PROFILE]} model="old-saved-model" onChange={vi.fn()} />);

    expect(await screen.findByTestId('persona-devin-catalog-error')).toBeInTheDocument();
    expect(screen.getByTestId('persona-model-input')).toHaveValue('old-saved-model');
    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(getDevinCliStatusMock).toHaveBeenCalledTimes(2));
    expect(getDevinCliStatusMock.mock.calls).toEqual([[true], [true]]);
    expect(screen.queryByTestId('persona-devin-catalog-error')).not.toBeInTheDocument();
  });

  it('warns when a saved model is missing from the fresh catalog', async () => {
    getDevinCliStatusMock.mockResolvedValue({
      models: ['swe-2-high'],
      modelCatalogStatus: 'ready',
      modelCatalogStale: false,
      modelCatalogDiscoveredAt: 20,
    });

    render(<DevinCliModelSelector profiles={[STORED_PROFILE]} model="old-saved-model" onChange={vi.fn()} />);

    expect(await screen.findByTestId('persona-devin-model-warning')).toBeInTheDocument();
    expect(screen.getByTestId('persona-model-input')).toHaveValue('old-saved-model');
  });

  it('keeps the selected model visible when the catalog is capped for display', async () => {
    getDevinCliStatusMock.mockResolvedValue({
      models: [...Array.from({ length: 150 }, (_, index) => `model-${String(index).padStart(3, '0')}`), 'zzz-selected-model'],
      modelCatalogStatus: 'ready',
      modelCatalogStale: false,
      modelCatalogDiscoveredAt: 20,
    });

    render(<DevinCliModelSelector profiles={[]} model="zzz-selected-model" onChange={vi.fn()} />);

    const select = await screen.findByTestId('persona-model-input');
    expect(select).toHaveValue('zzz-selected-model');
    expect(select.querySelector('option[value="zzz-selected-model"]')).toBeInTheDocument();
    expect(screen.getByTestId('persona-devin-model-count')).toHaveTextContent('Showing 100 of 151 models');
  });
});
