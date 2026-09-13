import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CodeIntelligencePanel } from './CodeIntelligencePanel';

const PROJECT = {
  projectId: 'project-1', projectName: 'Kalio', lifecycle: 'disabled', enabled: false,
  trustAcknowledged: false, workspaceTrusted: false, bridgeCompatible: true, ownership: 'none', languages: [], capabilities: [],
};
const STATUS = {
  backend: 'vscode_bridge', platformSupported: true, enabled: true, autoStart: true,
  bridgeInstalled: true, bridgeVersion: '0.4.7', bridgeCompatible: true, writeToolsEnabled: false,
  sandboxSupported: false, maxManagedRuntimes: 2, activeRuntimeCount: 0, idleTimeoutMinutes: 10, projects: [PROJECT],
};

describe('CodeIntelligencePanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/code-intelligence/integration' && !init?.method) return new Response(JSON.stringify(STATUS), { status: 200 });
      if (url.endsWith('/integration') && init?.method === 'PATCH') return new Response(JSON.stringify({ ...PROJECT, enabled: true, trustAcknowledged: true, lifecycle: 'idle_stopped' }), { status: 200 });
      return new Response(JSON.stringify(STATUS), { status: 200 });
    }));
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('shows detected Bridge and disabled sandbox state', async () => {
    render(<CodeIntelligencePanel />);
    expect(await screen.findByText('VS Code')).toBeInTheDocument();
    expect(screen.getByText('0.4.7')).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getByText('Kalio')).toBeInTheDocument();
  });

  it('enables a project only after the explicit trust action', async () => {
    render(<CodeIntelligencePanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Enable & trust/i }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      '/api/code-intelligence/projects/project-1/integration',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: true, acknowledgedRisk: true }) }),
    ));
  });
});
