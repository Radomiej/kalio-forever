import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateArchitectureRunDto, CreateArchitectureSchemaVariantDto } from '@kalio/types';
import { ArchitectPage } from './ArchitectPage';
import { useSessionStore } from '../../store/sessionStore';

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock('../../services/apiClient', () => ({
  getExecutionProfiles: vi.fn().mockResolvedValue([]),
  getDevinCliStatus: vi.fn().mockResolvedValue({ modelCatalogStatus: 'ready', modelCatalogStale: false, models: [] }),
  apiClient: { get: apiGet, post: apiPost, delete: vi.fn() },
}));

const schema = {
  id: 'auto-schema', name: 'Auto Schema', description: '', version: '1.0.0', roleSlots: [],
  nodes: [
    { id: 'auto', label: 'Status condition', kind: 'status_router', statusRouting: { sourceNodeId: 'source', expectedStatus: 'completed' } },
    { id: 'source', label: 'Source', kind: 'role', roleSlotId: 'source' },
    { id: 'source-2', label: 'Second source', kind: 'role', roleSlotId: 'source-2' },
    { id: 'choice', label: 'Choice', kind: 'parallel' },
    { id: 'fallback', label: 'Fallback', kind: 'parallel' },
  ],
  edges: [
    { id: 'source-auto', fromNodeId: 'source', toNodeId: 'auto' },
    { id: 'choice-edge', fromNodeId: 'auto', toNodeId: 'choice', selection: 'choice' },
    { id: 'default-edge', fromNodeId: 'auto', toNodeId: 'fallback', selection: 'default' },
  ],
};

async function openSettings() {
  render(<ArchitectPage />);
  await screen.findByTestId('architect-node-properties-open');
  expect(screen.getByTestId('architect-save-variant')).toBeDisabled();
  fireEvent.click(screen.getByTestId('architect-node-properties-open'));
  expect(screen.getByLabelText('Source step')).toBeEnabled();
  expect(screen.getByLabelText('When status is')).toBeEnabled();
}

describe('ArchitectPage enabled status condition flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({ sessions: [], activeSessionId: null });
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/architecture-registry/schemas') return Promise.resolve({ data: [schema] });
      if (url === '/api/personas' || url === '/api/sessions' || url.endsWith('/events')) return Promise.resolve({ data: [] });
      if (url === '/api/llm/config') return Promise.resolve({ data: { provider: 'mock', model: 'mock', source: 'env' } });
      if (url === '/api/credentials/active') return Promise.resolve({ data: { credentialId: null } });
      if (url.endsWith('/graph')) return Promise.resolve({ data: { runId: 'auto-run', nodes: [], edges: [] } });
      if (url.endsWith('/chat')) return Promise.resolve({ data: { runId: 'auto-run', messages: [] } });
      throw new Error(`Unexpected GET ${url}`);
    });
    apiPost.mockImplementation((url: string, dto: CreateArchitectureSchemaVariantDto) => {
      if (url.endsWith('/variants')) return Promise.resolve({ data: { ...schema, ...dto, id: 'auto-schema-variant-1' } });
      if (url === '/api/architecture-runs/async') return Promise.resolve({ data: { id: 'auto-run', schemaId: schema.id, status: 'completed' } });
      throw new Error(`Unexpected POST ${url}`);
    });
  });

  it('edits expected status, saves, and reopens the persisted configuration without LLM controls', async () => {
    await openSettings();
    expect(screen.queryByLabelText('Persona override')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architect-node-max-tool-attempts')).not.toBeInTheDocument();
    expect(screen.queryByTestId('architect-node-tool-override')).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Edge role for Choice')).getByRole('option', { name: 'Yes' })).toHaveValue('choice');
    expect(within(screen.getByLabelText('Edge role for Fallback')).getByRole('option', { name: 'Else' })).toHaveValue('default');
    fireEvent.change(screen.getByLabelText('When status is'), { target: { value: 'failed' } });
    expect(screen.getByTestId('architect-save-variant')).toBeEnabled();
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByTestId('architect-save-variant'));
    fireEvent.click(screen.getByTestId('architect-confirm-save-variant'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/architecture-registry/schemas/auto-schema/variants', expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'auto', statusRouting: { sourceNodeId: 'source', expectedStatus: 'failed' } })]),
    })));
    await waitFor(() => expect(screen.getByTestId('architect-save-variant')).toBeDisabled());
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByLabelText('Source step')).toHaveValue('source');
    expect(screen.getByLabelText('When status is')).toHaveValue('failed');
    expect(schema.nodes[0]?.statusRouting?.expectedStatus).toBe('completed');
  });

  it('sends a status-only edit through the inline run schema', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('When status is'), { target: { value: 'failed' } });
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByTestId('architect-start-run'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
      schema: expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ statusRouting: { sourceNodeId: 'source', expectedStatus: 'failed' } })]) }),
    })));
    const posted = apiPost.mock.calls.find(([url]) => url === '/api/architecture-runs/async')![1] as CreateArchitectureRunDto;
    expect(posted.schema?.nodes[0]?.statusRouting).not.toBe(schema.nodes[0]?.statusRouting);
  });

  it('tracks source/status changes and clears dirty state on baseline restoration and refresh', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Source step'), { target: { value: 'source-2' } });
    expect(screen.getByLabelText('Source step')).toHaveValue('source-2');
    expect(screen.getByTestId('architect-save-variant')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Source step'), { target: { value: 'source' } });
    expect(screen.getByTestId('architect-save-variant')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('When status is'), { target: { value: 'failed' } });
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('architect-save-variant')).toBeDisabled());
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByLabelText('When status is')).toHaveValue('completed');
  });

  it('creates and edits a slot-free status condition from the palette', async () => {
    render(<ArchitectPage />);
    await screen.findByTestId('architect-node-properties-open');
    fireEvent.click(screen.getByLabelText('More graph controls'));
    fireEvent.click(screen.getByTestId('architect-mode-add-status_router'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 660, clientY: 260 });
    await screen.findByTestId('architect-node-custom-node-6');
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByLabelText('Source step')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Source step'), { target: { value: 'source' } });
    fireEvent.change(screen.getByLabelText('When status is'), { target: { value: 'failed' } });
    expect(screen.getByLabelText('Source step')).toHaveValue('source');
    expect(screen.getByLabelText('When status is')).toHaveValue('failed');
    expect(screen.queryByLabelText('Persona override')).not.toBeInTheDocument();
  });
});
