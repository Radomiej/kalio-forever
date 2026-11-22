import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalDecisionModelControl } from './LocalDecisionModelControl';
import { LOCAL_DECISION_MODEL, type LocalDecisionCatalog, type LocalDecisionJob, type LocalDecisionModel, type LocalDecisionModelTransport } from './local-decision-model.transport';
import { DecisionSettingsTransportError } from './decision-settings.transport';

const ready: LocalDecisionModel = {
  modelTag: LOCAL_DECISION_MODEL, displayName: 'Qwen 3.5 2B', expectedSizeBytes: 1945781358,
  installed: true, chatCompatible: true, readiness: 'metadata_ready', sizeBytes: 1945781358,
  digest: 'a'.repeat(64), capabilities: ['completion'], installable: false,
};
const missing: LocalDecisionModel = { ...ready, installed: false, chatCompatible: null, readiness: 'not_installed', sizeBytes: null, digest: null, capabilities: [], installable: true };
const job = (state: LocalDecisionJob['state'] = 'pulling'): LocalDecisionJob => ({
  jobId: '12345678-1234-1234-1234-123456789abc', requestId: 'request-a', modelTag: LOCAL_DECISION_MODEL,
  revision: 1, state, progress: { completedBytes: 50000000, observedTotalBytes: 100000000,
    currentBlob: { digest: 'a'.repeat(64), completedBytes: 50000000, totalBytes: 100000000 } },
  error: null, cancelScope: 'request_only', createdAt: 1, updatedAt: 2,
});
function setup(model = missing, activeJob: LocalDecisionJob | null = null) {
  const catalog: LocalDecisionCatalog = { version: 1, backendAvailable: true, backendError: null, models: [model], activeJob, recentJobs: activeJob ? [activeJob] : [] };
  const transport: LocalDecisionModelTransport = {
    catalog: vi.fn().mockResolvedValue(catalog), job: vi.fn().mockResolvedValue(activeJob),
    install: vi.fn().mockResolvedValue({ outcome: 'started', model, job: job() }),
    cancel: vi.fn().mockResolvedValue({ ...job('cancel_requested'), revision: 2 }),
  };
  const onChange = vi.fn();
  return { catalog, transport, onChange };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('LocalDecisionModelControl', () => {
  it.each(['http://localhost:11435/api/chat', 'http://other.local:11434/api/chat',
    'https://localhost:11434/api/chat', 'http://localhost:11434/api/chat?extra=1'])(
    'does not bind local model readiness to a different decision connection %s', async (endpoint) => {
      const { transport, onChange } = setup(ready);
      render(<LocalDecisionModelControl endpoint={endpoint} value="existing:custom" onChange={onChange} transport={transport} />);
      expect(screen.getByText('Use localhost:11434 in Connection settings to manage models here.')).toBeInTheDocument();
      expect(screen.getByLabelText('Decision model')).toBeDisabled();
      expect(screen.getByLabelText('Decision model')).toHaveValue('existing:custom');
      expect(screen.queryByText('Installed')).not.toBeInTheDocument();
      expect(transport.catalog).not.toHaveBeenCalled();
      expect(transport.install).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it('invalidates a loaded local catalogue after changing the decision connection', async () => {
    const { transport, onChange } = setup(ready);
    const view = render(<LocalDecisionModelControl endpoint="http://localhost:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    await screen.findByText('Installed');
    view.rerender(<LocalDecisionModelControl endpoint="http://localhost:11435/api/chat" value="existing:custom" onChange={onChange} transport={transport} />);
    expect(screen.getByLabelText('Decision model')).toBeDisabled();
    expect(screen.queryByText('Installed')).not.toBeInTheDocument();
    expect(transport.catalog).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });
  it('shows actual installed size and metadata readiness without autoselection, install or inference claims', async () => {
    const { transport, onChange } = setup(ready);
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    expect(await screen.findByText('Installed')).toBeInTheDocument();
    expect(screen.getByText('1.95 GB installed')).toBeInTheDocument();
    expect(screen.getByLabelText('Decision model')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(transport.install).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(/metadata|inference has not/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Decision model'), { target: { value: LOCAL_DECISION_MODEL } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(LOCAL_DECISION_MODEL);
  });

  it('preserves an unmatched configured model and installs only on explicit activation', async () => {
    const { transport, onChange } = setup();
    const user = userEvent.setup();
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="existing:custom" onChange={onChange} transport={transport} />);
    expect(await screen.findByText('About 1.95 GB download')).toBeInTheDocument();
    expect(screen.getByLabelText('Decision model')).toHaveValue('existing:custom');
    expect(transport.install).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(transport.install).toHaveBeenCalledOnce());
    expect(vi.mocked(transport.install).mock.calls[0]).toEqual([LOCAL_DECISION_MODEL, expect.stringMatching(/^[A-Za-z0-9_-]{1,80}$/), expect.any(AbortSignal)]);
    expect(await screen.findByText('Downloading model')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Decision model')).toHaveValue('existing:custom');
  });

  it('rehydrates a managed job on remount and cancels only by its job ID', async () => {
    const active = job(); const { transport, onChange } = setup(missing, active);
    const view = render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    expect(await screen.findByText('50.0 / 100.0 MB · current file')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50000000');
    expect(screen.queryByText(/50%/)).not.toBeInTheDocument();
    view.unmount();
    expect(transport.cancel).not.toHaveBeenCalled();
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel download request' }));
    await waitFor(() => expect(transport.cancel).toHaveBeenCalledWith(active.jobId, expect.any(AbortSignal)));
    expect(await screen.findByText('Cancelling download request…')).toBeInTheDocument();
    expect(screen.getByText('Cancels this request only. Other downloads may continue; cached files are kept.')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps uncertain installation request identity for an explicit retry, with no automatic PUT replay', async () => {
    const { transport, onChange } = setup();
    vi.mocked(transport.install).mockRejectedValue(new Error('connection reset'));
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('button', { name: 'Retry install request' })).toBeEnabled();
    expect(transport.install).toHaveBeenCalledOnce();
    const firstId = vi.mocked(transport.install).mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Retry install request' }));
    await waitFor(() => expect(transport.install).toHaveBeenCalledTimes(2));
    expect(vi.mocked(transport.install).mock.calls[1][1]).toBe(firstId);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not offer replay when the backend has tombstoned the request ID', async () => {
    const { transport, onChange } = setup();
    vi.mocked(transport.install).mockRejectedValue(new DecisionSettingsTransportError(409, 'OLLAMA_REQUEST_EXPIRED'));
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This install request cannot be safely retried. Refresh status to check its outcome.');
    expect(screen.queryByRole('button', { name: 'Retry install request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(transport.install).toHaveBeenCalledOnce();
  });

  it('keeps verification and unknown cancellation distinct from installation success', async () => {
    const active = job('verifying'); const { transport, onChange } = setup(missing, active);
    vi.mocked(transport.cancel).mockResolvedValue({ ...job('unknown'), revision: 2, error: { code: 'OLLAMA_CANCEL_UNCERTAIN', message: 'Stop unconfirmed.' } });
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    expect(await screen.findByText('Checking downloaded model…')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download request' }));
    expect(await screen.findByText('Request status is unconfirmed. Refresh status before starting another installation.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses metadata readiness rather than installed flag to enable a new model selection', async () => {
    const { transport, onChange } = setup({ ...ready, chatCompatible: null, readiness: 'unknown' });
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    expect(await screen.findByText('Compatibility unavailable')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Qwen 3.5 2B' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('invalidates selection readiness when refreshing metadata fails', async () => {
    const { transport, onChange } = setup(ready);
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    await screen.findByText('Installed');
    vi.mocked(transport.catalog).mockRejectedValue(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('option', { name: 'Qwen 3.5 2B' })).toBeDisabled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts an already-installed receipt without selecting or starting another request', async () => {
    const { transport, catalog, onChange } = setup();
    vi.mocked(transport.catalog).mockResolvedValueOnce(catalog).mockResolvedValue({ ...catalog, models: [ready] });
    vi.mocked(transport.install).mockImplementation(async (_tag, requestId) => ({
      outcome: 'already_installed', model: ready, job: { ...job('installed'), requestId },
    }));
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(await screen.findByText('Installed')).toBeInTheDocument();
    expect(transport.install).toHaveBeenCalledOnce();
    expect(transport.job).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Decision model')).toHaveValue('');
  });

  it('makes no manager requests on desktop', async () => {
    vi.stubGlobal('location', { origin: 'http://tauri.localhost', protocol: 'http:', hostname: 'tauri.localhost' });
    const { transport, onChange } = setup();
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="existing:model" onChange={onChange} transport={transport} />);
    expect(screen.getByText('Model management is available in the local web app only.')).toBeInTheDocument();
    expect(transport.catalog).not.toHaveBeenCalled();
    expect(transport.install).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Decision model')).toHaveValue('existing:model');
  });

  it('shows missing Ollama and read failures without exposing upstream errors', async () => {
    const { transport, catalog, onChange } = setup();
    vi.mocked(transport.catalog).mockResolvedValue({ ...catalog, backendAvailable: false,
      backendError: { code: 'OLLAMA_UNAVAILABLE', message: 'Unavailable.' }, models: [{ ...missing, installable: false }] });
    const view = render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    expect(await screen.findByText('Ollama is unavailable. Start it on this computer, then refresh status.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    view.unmount();
    vi.mocked(transport.catalog).mockRejectedValue(new Error('SECRET_RAW_UPSTREAM'));
    render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load local models. Refresh status to try again.');
    expect(screen.queryByText(/SECRET_RAW_UPSTREAM/)).not.toBeInTheDocument();
  });

  it('allows observed progress to regress on a newer revision without fake total percentages', async () => {
    vi.useFakeTimers();
    const active = job(); const { transport, onChange } = setup(missing, active);
    vi.mocked(transport.job).mockResolvedValue({ ...active, revision: 2, progress: { completedBytes: 10000000, observedTotalBytes: 100000000,
      currentBlob: { digest: 'a'.repeat(64), completedBytes: 10000000, totalBytes: 100000000 } } });
    await act(async () => { render(<LocalDecisionModelControl endpoint="http://127.0.0.1:11434/api/chat" value="" onChange={onChange} transport={transport} />); });
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50000000');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '10000000');
    expect(screen.getByText('10.0 / 100.0 MB · current file')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
