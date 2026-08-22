import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeIntelligenceQuickTrust } from './CodeIntelligenceQuickTrust';

const DISABLED = {
  projectId: 'project-1', projectName: 'Portal', lifecycle: 'disabled', enabled: false,
  trustAcknowledged: false, workspaceTrusted: false, bridgeCompatible: true, ownership: 'none', languages: [], capabilities: [],
};

describe('CodeIntelligenceQuickTrust', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/integration') && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ ...DISABLED, enabled: true, trustAcknowledged: true, lifecycle: 'idle_stopped' }), { status: 200 });
      }
      return new Response(JSON.stringify(DISABLED), { status: 200 });
    }));
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('offers project-local activation without opening Settings', async () => {
    render(<CodeIntelligenceQuickTrust projectId="project-1" />);
    expect(await screen.findByRole('button', { name: 'Enable VS Code Bridge' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Enable VS Code Bridge' }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/code-intelligence/projects/project-1/integration',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: true, acknowledgedRisk: true }) }),
    ));
    expect(await screen.findByText(/VS Code Bridge enabled/)).toBeInTheDocument();
  });
});
