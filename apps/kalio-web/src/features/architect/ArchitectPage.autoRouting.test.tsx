import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    { id: 'auto', label: 'Automatic Router', kind: 'auto_router', autoRouting: { confidenceThreshold: 0.7, instructions: 'Choose.' } },
    { id: 'choice', label: 'Choice', kind: 'parallel' },
    { id: 'fallback', label: 'Fallback', kind: 'parallel' },
  ],
  edges: [
    { id: 'choice-edge', fromNodeId: 'auto', toNodeId: 'choice', selection: 'choice' },
    { id: 'default-edge', fromNodeId: 'auto', toNodeId: 'fallback', selection: 'default' },
  ],
};

async function openSettings() {
  render(<ArchitectPage />);
  await screen.findByTestId('architect-node-properties-open');
  expect(screen.getByTestId('architect-save-variant')).toBeDisabled();
  fireEvent.click(screen.getByTestId('architect-node-properties-open'));
  expect(screen.getByLabelText('Confidence threshold')).toBeEnabled();
  expect(screen.getByLabelText('Routing instructions')).toBeEnabled();
}

describe('ArchitectPage enabled auto-routing flow', () => {
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

  it('edits both enabled settings, marks the variant dirty, saves them, then clears dirty state', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Confidence threshold'), { target: { value: '0.9' } });
    fireEvent.change(screen.getByLabelText('Routing instructions'), { target: { value: 'Prefer verification.' } });
    expect(screen.getByLabelText('Confidence threshold')).toHaveValue(0.9);
    expect(screen.getByLabelText('Routing instructions')).toHaveValue('Prefer verification.');
    expect(screen.getByTestId('architect-save-variant')).toBeEnabled();
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByTestId('architect-save-variant'));
    fireEvent.click(screen.getByTestId('architect-confirm-save-variant'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/architecture-registry/schemas/auto-schema/variants', expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({ id: 'auto', autoRouting: { confidenceThreshold: 0.9, instructions: 'Prefer verification.' } })]),
    })));
    await waitFor(() => expect(screen.getByTestId('architect-save-variant')).toBeDisabled());
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByLabelText('Routing instructions')).toHaveValue('Prefer verification.');
    expect(schema.nodes[0]?.autoRouting?.instructions).toBe('Choose.');
  });

  it('includes a settings-only edit in the inline run schema', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Confidence threshold'), { target: { value: '0.8' } });
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByTestId('architect-start-run'));
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/architecture-runs/async', expect.objectContaining({
      schema: expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ autoRouting: { confidenceThreshold: 0.8, instructions: 'Choose.' } })]) }),
    })));
    const posted = apiPost.mock.calls.find(([url]) => url === '/api/architecture-runs/async')![1] as CreateArchitectureRunDto;
    expect(posted.schema?.nodes[0]?.autoRouting).not.toBe(schema.nodes[0]?.autoRouting);
  });

  it('edits a newly created auto-router without leaking its settings into another node', async () => {
    render(<ArchitectPage />);
    await screen.findByTestId('architect-node-properties-open');
    fireEvent.click(screen.getByLabelText('More graph controls'));
    fireEvent.click(screen.getByTestId('architect-mode-add-auto_router'));
    fireEvent.click(screen.getByTestId('architect-graph-canvas'), { clientX: 660, clientY: 260 });
    await screen.findByTestId('architect-node-custom-node-4');
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    fireEvent.change(screen.getByLabelText('Confidence threshold'), { target: { value: '0.6' } });
    fireEvent.change(screen.getByLabelText('Routing instructions'), { target: { value: 'New route.' } });
    expect(screen.getByLabelText('Confidence threshold')).toHaveValue(0.6);
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByTestId('architect-mode-select'));
    fireEvent.click(screen.getByTestId('architect-node-auto'));
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByLabelText('Confidence threshold')).toHaveValue(0.7);
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByTestId('architect-node-custom-node-4'));
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByLabelText('Routing instructions')).toHaveValue('New route.');
  });

  it('clears dirty state when settings return to the baseline and on refresh', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Routing instructions'), { target: { value: 'Changed' } });
    expect(screen.getByTestId('architect-save-variant')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Routing instructions'), { target: { value: 'Choose.' } });
    expect(screen.getByTestId('architect-save-variant')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Confidence threshold'), { target: { value: '0.9' } });
    fireEvent.click(screen.getByTestId('architect-node-properties-close'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByTestId('architect-save-variant')).toBeDisabled());
    fireEvent.click(screen.getByTestId('architect-node-properties-open'));
    expect(screen.getByLabelText('Confidence threshold')).toHaveValue(0.7);
  });
});
