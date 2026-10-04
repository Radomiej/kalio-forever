import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { DevinCliStatus } from '../../services/apiClient';
import { DevinCliIntegrationCard } from './DevinCliIntegrationCard';

it('CLI readiness does not claim that a model host is running', () => {
  render(<DevinCliIntegrationCard
    status={{ models: ['swe-2'], probeChecked: true, hosts: [], hostCount: 0, executable: 'devin.exe',
      version: '3000.11.1', authenticated: true, acp: true, modelCatalogStatus: 'ready',
      modelCatalogStale: false, modelCatalogDiscoveredAt: 10000 } satisfies DevinCliStatus}
    settings={null} loading={false} onRefresh={vi.fn()} onUpdateNativeTool={vi.fn()}
    tokenOverride="" onTokenOverrideChange={vi.fn()} onUpdateBridgeToken={vi.fn()}
    updating={false} bridgeUpdating={false}
  />);
  expect(screen.getByText('CLI ready')).toBeVisible();
  expect(screen.queryByText('Online', { exact: true })).toBeNull();
  expect(screen.getByText(/Model hosts start on the first message/)).toBeVisible();
  expect(screen.getByText('0 model hosts · devin.exe')).toBeVisible();
});

it('Escape closes only the model catalog and restores focus to its opener', () => {
  const parentEscape = vi.fn();
  window.addEventListener('keydown', parentEscape);
  try {
    render(<DevinCliIntegrationCard
      status={{ models: ['swe-2'], probeChecked: false, hosts: [], hostCount: 0, executable: 'devin.exe',
        version: null, authenticated: false, acp: false, modelCatalogStatus: 'not-checked',
        modelCatalogStale: false, modelCatalogDiscoveredAt: null } satisfies DevinCliStatus}
      settings={null} loading={false} onRefresh={vi.fn()} onUpdateNativeTool={vi.fn()}
      tokenOverride="" onTokenOverrideChange={vi.fn()} onUpdateBridgeToken={vi.fn()}
      updating={false} bridgeUpdating={false}
    />);
    const opener = screen.getByRole('button', { name: 'Browse 1 models' });
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search Devin models' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Devin models' })).toBeNull();
    expect(parentEscape).not.toHaveBeenCalled();
    expect(opener).toHaveFocus();
  } finally {
    window.removeEventListener('keydown', parentEscape);
  }
});
