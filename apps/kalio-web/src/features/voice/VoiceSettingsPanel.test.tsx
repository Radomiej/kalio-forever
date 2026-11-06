import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceSettingsPanel } from './VoiceSettingsPanel';

const mock = vi.hoisted(() => ({
  status: vi.fn(), install: vi.fn(), cancelInstall: vi.fn(), local: vi.fn(), listLaunch: vi.fn(),
}));
vi.mock('./voiceApi', () => ({ isLocalSpeechPage: mock.local, speechApi: mock }));
vi.mock('./voiceDraftStore', () => ({ voiceDraftStore: { listLaunch: mock.listLaunch } }));
vi.mock('./VoiceInputControl', () => ({ VoiceInputControl: () => <div>Recording recovery</div> }));
const missing = { status: 'missing', installed: false, totalBytes: 679400000, downloadedBytes: 0, phase: null, errorCode: null };
beforeEach(() => {
  vi.clearAllMocks();
  mock.local.mockReturnValue(true);
  mock.status.mockResolvedValue(missing);
  mock.listLaunch.mockResolvedValue([]);
});

describe('voice installation settings', () => {
  it('presents one voice heading and a concise model card before an explicit install', async () => {
    render(<VoiceSettingsPanel />);
    expect(await screen.findByText('679.4 MB download')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Voice input' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Parakeet TDT v3' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading').filter((heading) => /voice/i.test(heading.textContent ?? ''))).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Not installed');
    expect(screen.getByText('Includes the model and required software.')).toBeInTheDocument();
    expect(screen.getByText(/sherpa-onnx/)).not.toBeVisible();
    expect(mock.install).not.toHaveBeenCalled();
  });

  it('shows installed readiness without implying a new download', async () => {
    mock.status.mockResolvedValue({ ...missing, status: 'ready', installed: true });
    render(<VoiceSettingsPanel />);
    expect(await screen.findByText('Ready to dictate')).toBeInTheDocument();
    expect(screen.queryByText(/MB download/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(mock.install).not.toHaveBeenCalled();
  });

  it('uses backend size and progress and supports keyboard installation and cancellation', async () => {
    mock.status.mockResolvedValue({ ...missing, totalBytes: 812300000 });
    mock.install.mockResolvedValue({ ...missing, totalBytes: 812300000, status: 'installing', downloadedBytes: 406150000, phase: 'model' });
    mock.cancelInstall.mockResolvedValue(missing);
    const user = userEvent.setup();
    render(<VoiceSettingsPanel />);
    expect(await screen.findByText('812.3 MB download')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Install' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('progressbar', { name: 'Voice input download' })).toHaveAttribute('value', '406150000');
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '812300000');
    expect(screen.getByText('406.1 / 812.3 MB · 50%')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Downloading');
    expect(screen.getByRole('button', { name: 'Cancel installation' })).toHaveFocus();
    await user.keyboard(' ');
    await waitFor(() => expect(mock.cancelInstall).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Install' })).toBeEnabled();
    expect(mock.install).toHaveBeenCalledOnce();
  });

  it('requires a complete download size before enabling Install', async () => {
    mock.status.mockResolvedValue({ ...missing, totalBytes: 0 });
    render(<VoiceSettingsPanel />);
    expect(await screen.findByText('Download size unavailable')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not installed'));
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
    expect(mock.install).not.toHaveBeenCalled();
  });

  it('distinguishes checking from unavailable and prevents installation without status', async () => {
    let rejectStatus: (error: Error) => void = () => { throw new Error('Status request not started'); };
    mock.status.mockImplementation(() => new Promise((_resolve, reject) => { rejectStatus = reject; }));
    render(<VoiceSettingsPanel />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking availability');
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
    await act(async () => { rejectStatus(new Error('404')); });
    expect(await screen.findByRole('alert')).toHaveTextContent('Voice input is unavailable. Check that Kalio is running on this computer.');
    expect(screen.getByRole('status')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled();
  });

  it('keeps verification separate from readiness', async () => {
    mock.status.mockResolvedValue({ ...missing, status: 'verifying' });
    render(<VoiceSettingsPanel />);
    expect(await screen.findByText('Checking downloaded files…')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verifying');
    expect(screen.queryByText('Ready to dictate')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel installation' })).toBeEnabled();
  });

  it('never treats an inconsistent ready response as installed', async () => {
    mock.status.mockResolvedValue({ ...missing, status: 'ready', installed: false });
    render(<VoiceSettingsPanel />);
    expect(await screen.findByRole('button', { name: 'Install' })).toBeEnabled();
    expect(screen.queryByText('Ready to dictate')).not.toBeInTheDocument();
  });

  it('shows a concise recoverable error without exposing backend codes', async () => {
    mock.status.mockResolvedValue({ ...missing, status: 'error', errorCode: 'speech_runtime_integrity_failed' });
    render(<VoiceSettingsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Installation could not finish. Try installing again.');
    expect(screen.queryByText(/speech_runtime_integrity_failed/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled();
  });

  it('locks the pending install and reports cancellation failure without claiming cancellation', async () => {
    let finishInstall: (value: typeof missing) => void = () => { throw new Error('Install not started'); };
    mock.install.mockImplementation(() => new Promise((resolve) => { finishInstall = resolve; }));
    mock.cancelInstall.mockRejectedValue(new Error('401'));
    render(<VoiceSettingsPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    await act(async () => { finishInstall({ ...missing, status: 'installing' }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel installation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm cancellation. Check the installation status before trying again.');
    expect(screen.getByRole('status')).toHaveTextContent('Downloading');
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('does not request status or offer installation on a remote page', async () => {
    mock.local.mockReturnValue(false);
    await act(async () => { render(<VoiceSettingsPanel />); });
    expect(screen.getByText('Open Kalio on this computer at localhost to use voice input.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(mock.status).not.toHaveBeenCalled();
    expect(mock.install).not.toHaveBeenCalled();
  });

  it('keeps unfinished launch recordings discoverable with English recovery labels', async () => {
    mock.listLaunch.mockResolvedValue([{ draftId: 'launch-a' }]);
    render(<VoiceSettingsPanel />);
    expect(await screen.findByRole('heading', { name: 'Unfinished recordings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Recovered transcript')).toBeInTheDocument();
    expect(screen.getByText('Recording recovery')).toBeInTheDocument();
    expect(mock.install).not.toHaveBeenCalled();
  });
});
