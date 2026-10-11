import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import type { EmbeddingStatus } from '@kalio/types';
import { ProjectContextCard } from './ProjectContextCard';

const api = vi.hoisted(() => ({ getSettings: vi.fn(), saveSettings: vi.fn(), getProjects: vi.fn(), getStatus: vi.fn(), refresh: vi.fn(), search: vi.fn() }));
vi.mock('./project-context.transport', () => ({ projectContextTransport: api }));
const settings = { enabled: false, modelRevision: 'sha256:verified-model', providerScope: 'local-user' };
const local: EmbeddingStatus = { provider: 'local-transformers', source: 'local', model: 'local-model', dimensions: 384, configured: true, baseUrlMasked: '(local cache)' };
const remote: EmbeddingStatus = { ...local, provider: 'openai-compatible', source: 'db', model: 'remote-model' };
const space = { model: 'local-model', modelRevision: 'rev' };

async function ready(status = local) {
  const view = render(<ProjectContextCard status={status} />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeEnabled());
  return view;
}

describe('ProjectContextCard', () => {
  it('allows the first search and displays the index created by backend auto-refresh', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    const user = userEvent.setup(); await ready();
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    await screen.findByText(/Not indexed/);
    await user.type(screen.getByLabelText('Search project context'), 'contact');
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    api.getStatus.mockResolvedValue({ projectId: 'p', space, indexedChunks: 3, indexedAt: 1000 });
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Project index ready');
    expect(api.refresh).not.toHaveBeenCalled();
    expect(screen.getByText(/3 searchable sections/)).toBeInTheDocument();
  });
  beforeEach(() => {
    vi.resetAllMocks();
    api.getSettings.mockResolvedValue(settings);
    api.getProjects.mockResolvedValue([{ id: 'p', name: 'HomeSite', path: 'E:/home-site' }, { id: 'q', name: 'Other', path: 'E:/other' }, { id: 'none', name: 'No workspace', path: null }]);
    api.getStatus.mockResolvedValue({ projectId: 'p', space, indexedChunks: 0, indexedAt: null });
    api.saveSettings.mockImplementation(async value => ({ ...settings, ...value }));
    api.refresh.mockResolvedValue({ projectId: 'p', space, indexedFiles: 2, indexedChunks: 3, skipped: [], indexedAt: 1000 });
    api.search.mockResolvedValue([]);
  });

  it('explicitly associates the Project label with its selector', async () => {
    await ready();
    const selector = screen.getByRole('combobox', { name: 'Project' });
    expect(screen.getByLabelText('Project')).toBe(selector);
    expect(selector.id).not.toBe('');
    expect(screen.getByText('Project').closest('label')).toHaveAttribute('for', selector.id);
  });

  it('lays out each field label and control vertically with explicit flex classes', async () => {
    await ready();
    for (const name of ['Project', 'Search project context']) {
      const label = screen.getByLabelText(name).closest('label');
      expect(label).toHaveClass('flex', 'flex-col', 'gap-1');
      expect(label).not.toHaveClass('form-control');
    }
  });

  it('defaults off and applies drafts explicitly without automatic indexing', async () => {
    const user = userEvent.setup();
    await ready();
    expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).not.toBeChecked();
    expect(screen.queryByLabelText('Provider scope')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Model revision')).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'No workspace' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Allow project indexing' }));
    expect(api.saveSettings).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Project context settings applied.');
    expect(api.saveSettings).toHaveBeenCalledWith({ enabled: true });
    expect(api.refresh).not.toHaveBeenCalled(); expect(api.search).not.toHaveBeenCalled();
  });

  it('refreshes and searches the selected project, showing metadata/content and empty states', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    api.search.mockResolvedValueOnce([{ id: 'r', path: 'assets/logo.png', resourceType: 'image', representation: 'metadata', content: 'File metadata only' }]).mockResolvedValueOnce([]);
    const user = userEvent.setup(); await ready();
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    await screen.findByText(/Not indexed/);
    await user.click(screen.getByRole('button', { name: 'Refresh project index' }));
    await screen.findByText('Indexed 2 files, 3 chunks. Skipped 0 files.');
    expect(api.refresh).toHaveBeenCalledWith('p', false);
    await user.type(screen.getByLabelText('Search project context'), 'logo');
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('assets/logo.png');
    expect(screen.getByText('Type: image · Representation: metadata')).toBeInTheDocument();
    expect(screen.getByText('File metadata only')).toBeInTheDocument();
    expect(api.search).toHaveBeenCalledWith('p', 'logo', false);
    await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('No matching project resources.');
    expect(screen.queryByText('assets/logo.png')).not.toBeInTheDocument();
  });

  it('consumes remote consent on every operation including failure and clears it on project change', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    api.getStatus.mockResolvedValue({ projectId: 'p', space, indexedChunks: 3, indexedAt: 1000 });
    api.refresh.mockRejectedValueOnce(new Error('REMOTE_EMBEDDING_CONSENT_REQUIRED'));
    const user = userEvent.setup(); await ready(remote);
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    const consent = screen.getByRole('checkbox', { name: /Allow remote processing/ });
    expect(consent).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
    await user.click(consent); await user.click(screen.getByRole('button', { name: 'Refresh project index' }));
    await screen.findByRole('alert');
    expect(consent).not.toBeChecked(); expect(api.refresh).toHaveBeenCalledWith('p', true);
    await user.type(screen.getByLabelText('Search project context'), 'hello');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    await user.click(consent); await user.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('No matching project resources.');
    expect(api.search).toHaveBeenCalledWith('p', 'hello', true); expect(consent).not.toBeChecked();
    await user.click(consent); await user.selectOptions(screen.getByLabelText('Project'), 'q');
    expect(consent).not.toBeChecked();
  });

  it('keeps the disabled default safe after loading failure and supports retry', async () => {
    api.getSettings.mockRejectedValueOnce(new Error('unavailable'));
    const user = userEvent.setup(); render(<ProjectContextCard status={local} />);
    await screen.findByRole('alert');
    expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeEnabled());
  });

  it('does not unlock operations when Apply fails or the provider is unavailable', async () => {
    api.saveSettings.mockRejectedValue(new Error('save failed'));
    const user = userEvent.setup(); await ready({ ...local, configured: false });
    await user.click(screen.getByRole('checkbox', { name: 'Allow project indexing' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('save failed');
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('discards stale project status responses', async () => {
    let resolveOld!: (value: unknown) => void;
    api.getStatus.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const user = userEvent.setup(); await ready();
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    await user.selectOptions(screen.getByLabelText('Project'), 'q');
    await screen.findByText(/Not indexed/);
    resolveOld({ projectId: 'p', space: { model: 'stale-model', modelRevision: 'old' }, indexedChunks: 99, indexedAt: null });
    await waitFor(() => expect(screen.queryByText(/stale-model/)).not.toBeInTheDocument());
  });

  it('blocks duplicate operations and ignores old status after a manual refresh', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    let resolveStatus!: (value: unknown) => void;
    let resolveRefresh!: (value: unknown) => void;
    api.getStatus.mockImplementationOnce(() => new Promise(resolve => { resolveStatus = resolve; }));
    api.refresh.mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));
    const user = userEvent.setup(); await ready();
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    await user.click(screen.getByRole('button', { name: 'Refresh project index' }));
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
    expect(screen.getByLabelText('Project')).toBeDisabled();
    resolveRefresh({ projectId: 'p', space, indexedFiles: 2, indexedChunks: 3, skipped: [], indexedAt: 1000 });
    await screen.findByText('Indexed 2 files, 3 chunks. Skipped 0 files.');
    resolveStatus({ projectId: 'p', space: { model: 'old-index', modelRevision: 'old' }, indexedChunks: 0, indexedAt: null });
    await waitFor(() => expect(screen.queryByText(/old-index/)).not.toBeInTheDocument());
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });

  it('clears one-operation consent when the embedding provider changes', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    const user = userEvent.setup(); const view = await ready(remote);
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    await user.click(screen.getByRole('checkbox', { name: /Allow remote processing/ }));
    view.rerender(<ProjectContextCard status={{ ...remote, model: 'new-model' }} />);
    expect(screen.getByRole('checkbox', { name: /Allow remote processing/ })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
  });

  it('allows saving the opt-in without asking the user for a model identity, but blocks indexing until verified', async () => {
    api.getSettings.mockResolvedValue({ ...settings, modelRevision: 'unresolved' });
    api.saveSettings.mockResolvedValue({ ...settings, enabled: true, modelRevision: 'unresolved' });
    const user = userEvent.setup(); await ready();
    await user.click(screen.getByRole('checkbox', { name: 'Allow project indexing' }));
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeEnabled();
    await user.click(apply);
    await screen.findByText('Project context settings applied.');
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
    expect(screen.getByText(/Project indexing is not ready for this model/)).toBeInTheDocument();
    expect(api.saveSettings).toHaveBeenCalledWith({ enabled: true });
  });

  it('keeps the second StrictMode load authoritative even if the first resolves after editing', async () => {
    let resolveFirst!: (value: unknown) => void;
    api.getSettings.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const user = userEvent.setup(); render(<StrictMode><ProjectContextCard status={local} /></StrictMode>);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: 'Allow project indexing' }));
    await act(async () => { resolveFirst({ ...settings, enabled: true, modelRevision: 'stale-revision' }); });
    expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('refreshes parent embedding status after a successful Apply, never after a failed save', async () => {
    const onApplied = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup(); render(<ProjectContextCard status={local} onApplied={onApplied} />);
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeEnabled());
    await user.click(screen.getByRole('checkbox', { name: 'Allow project indexing' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Project context settings applied.');
    expect(onApplied).toHaveBeenCalledTimes(1);
    api.saveSettings.mockRejectedValueOnce(new Error('save rejected'));
    await user.click(screen.getByRole('checkbox', { name: 'Allow project indexing' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('save rejected');
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('reloads the selected project index after a model change without requiring manual refresh', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    api.getStatus.mockResolvedValueOnce({ projectId: 'p', space, indexedChunks: 3, indexedAt: 1000 })
      .mockResolvedValue({ projectId: 'p', space: { model: 'new-model', modelRevision: 'new-rev' }, indexedChunks: 0, indexedAt: null });
    const user = userEvent.setup(); const view = await ready();
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    await user.type(screen.getByLabelText('Search project context'), 'logo');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
    view.rerender(<ProjectContextCard status={{ ...local, model: 'new-model' }} />);
    await screen.findByText(/Not indexed for this model/);
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeEnabled();
    expect(api.getStatus).toHaveBeenLastCalledWith('p');
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('keeps controls locked while the new model is loading even if an old refresh finishes', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    let finishRefresh!: (value: unknown) => void;
    let finishSettings!: (value: unknown) => void;
    api.refresh.mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve; }));
    const user = userEvent.setup(); const view = await ready();
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    await user.click(screen.getByRole('button', { name: 'Refresh project index' }));
    api.getSettings.mockImplementationOnce(() => new Promise(resolve => { finishSettings = resolve; }));
    view.rerender(<ProjectContextCard status={{ ...local, model: 'new-model' }} />);
    await screen.findByText('Loading project context…');
    await act(async () => { finishRefresh({ projectId: 'p', space, indexedFiles: 2, indexedChunks: 3, skipped: [], indexedAt: 1000 }); });
    expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeDisabled();
    expect(screen.queryByText('Project index ready')).not.toBeInTheDocument();
    await act(async () => { finishSettings({ ...settings, enabled: true }); });
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeEnabled());
  });

  it('does not reuse the previous model identity after a failed reload and supports retry', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    const user = userEvent.setup(); const view = await ready();
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    api.getSettings.mockRejectedValueOnce(new Error('Model unavailable'));
    view.rerender(<ProjectContextCard status={{ ...local, model: 'new-model' }} />);
    await screen.findByText('Model unavailable');
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Allow project indexing' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeEnabled());
    expect(api.refresh).not.toHaveBeenCalled();
  });

  it('does not offer project indexing when Ollama metadata cannot guarantee the model used for inference', async () => {
    api.getSettings.mockResolvedValue({ ...settings, enabled: true });
    api.getStatus.mockResolvedValue({ projectId: 'p', space, indexedChunks: 3, indexedAt: 1000 });
    const user = userEvent.setup();
    await ready({ ...local, provider: 'ollama', baseUrlMasked: 'http://localhost:11434' });
    await user.selectOptions(screen.getByLabelText('Project'), 'p');
    expect(screen.getByRole('button', { name: 'Refresh project index' })).toBeDisabled();
    expect(screen.queryByText('Project index ready')).not.toBeInTheDocument();
    expect(screen.getByText(/Project indexing is not ready for this model/)).toBeInTheDocument();
    expect(api.refresh).not.toHaveBeenCalled();
  });
});
