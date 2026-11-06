import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewChatScreen } from './NewChatScreen';

vi.mock('./PersonaCombobox', () => ({ PersonaCombobox: () => <span>Persona control</span> }));
vi.mock('./ExecutionProfileCombobox', () => ({ ExecutionProfileCombobox: () => <span>Runtime control</span> }));
vi.mock('./CodeIntelligenceQuickTrust', () => ({ CodeIntelligenceQuickTrust: () => null }));
const speech = vi.hoisted(() => ({ capture: vi.fn(), transcribe: vi.fn() }));
vi.mock('../../voice/voiceApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../voice/voiceApi')>(),
  isLocalSpeechPage: () => true,
  speechApi: {
    status: async () => ({ status: 'ready', installed: true }),
    transcribe: (...args: unknown[]) => speech.transcribe(...args), cancel: async () => ({ cancelled: true }),
  },
}));
vi.mock('../../voice/voiceDraftStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../voice/voiceDraftStore')>(),
  voiceDraftStore: { list: async () => [], setDelivery: async () => undefined, remove: async () => undefined },
}));
vi.mock('../../voice/audioCapture', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../voice/audioCapture')>(),
  startSpeechCapture: (...args: unknown[]) => speech.capture(...args),
}));

describe('compact new chat', () => {
  it('dictates the first prompt without creating a chat and sends only after explicit Run', async () => {
    speech.capture.mockResolvedValue({ stop: async () => new Blob(['fixture wav']), dispose: async () => undefined });
    speech.transcribe.mockResolvedValue('First dictated prompt');
    const onRunPrompt = vi.fn();
    render(<NewChatScreen architectures={[]} heading="New Chat" subtitle="Test" isBusy={false}
      personas={[]} projectPath="E:/Projekty/home-site" selectedPersonaId="default"
      selectedArchitectureId="single-chat" testIdPrefix="welcome"
      onArchitectureChange={vi.fn()} onDraftChange={vi.fn()} onPersonaChange={vi.fn()}
      onProjectPathChange={vi.fn()} onRunPrompt={onRunPrompt} />);
    const microphone = await screen.findByRole('button', { name: 'Record voice input' });
    await waitFor(() => expect(microphone).toBeEnabled());
    expect(speech.capture).not.toHaveBeenCalled(); expect(onRunPrompt).not.toHaveBeenCalled();
    fireEvent.click(microphone);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop recording' }));
    await waitFor(() => expect(screen.getByLabelText('Prompt')).toHaveValue('First dictated prompt'));
    expect(speech.transcribe).toHaveBeenCalledWith(expect.any(String), { draftId: expect.any(String) }, expect.any(Blob), expect.any(AbortSignal));
    expect(onRunPrompt).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Edited first prompt' } });
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));
    expect(onRunPrompt).toHaveBeenCalledWith('Edited first prompt', undefined);
  });
  it('retains the draft until the caller actually starts a conversation', () => {
    const onRunPrompt = vi.fn();
    const onDraftChange = vi.fn();
    render(<NewChatScreen
      architectures={[]} heading="New Chat" subtitle="Test" isBusy={false}
      personas={[]} projectPath="E:/Projekty/home-site" selectedPersonaId="default"
      selectedArchitectureId="single-chat" testIdPrefix="welcome"
      onArchitectureChange={vi.fn()} onDraftChange={onDraftChange} onPersonaChange={vi.fn()}
      onProjectPathChange={vi.fn()} onRunPrompt={onRunPrompt}
    />);
    const prompt = screen.getByLabelText('Prompt');
    fireEvent.change(prompt, { target: { value: 'Improve Home Site' } });
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));
    expect(onRunPrompt).toHaveBeenCalledWith('Improve Home Site', undefined);
    expect(prompt).toHaveValue('Improve Home Site');
    expect(onDraftChange).not.toHaveBeenCalledWith('');
  });
  it('does not let Enter bypass the required runtime selection', () => {
    const onRunPrompt = vi.fn();
    render(<NewChatScreen
      architectures={[]} heading="New Chat" subtitle="Test" isBusy={false}
      personas={[]} executionProfiles={[]} selectedExecutionProfileId=""
      projectPath="E:/Projekty/home-site" selectedPersonaId="default"
      selectedArchitectureId="single-chat" testIdPrefix="welcome"
      onArchitectureChange={vi.fn()} onDraftChange={vi.fn()} onPersonaChange={vi.fn()}
      onProjectPathChange={vi.fn()} onRunPrompt={onRunPrompt}
    />);
    const prompt = screen.getByLabelText('Prompt');
    fireEvent.change(prompt, { target: { value: 'Build the company site' } });
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(prompt, { key: 'Enter', metaKey: true });
    expect(onRunPrompt).not.toHaveBeenCalled();
    expect(prompt).toHaveValue('Build the company site');
  });
  it('toggles configuration without hiding or replacing the prompt', () => {
    const onRunPrompt = vi.fn();
    render(<NewChatScreen
      architectures={[]} heading="New Chat" subtitle="Test" isBusy={false}
      personas={[]} projectPath="E:/Projekty/home-site" selectedPersonaId="default"
      selectedArchitectureId="single-chat" testIdPrefix="welcome"
      onArchitectureChange={vi.fn()} onDraftChange={vi.fn()} onPersonaChange={vi.fn()}
      onProjectPathChange={vi.fn()} onRunPrompt={onRunPrompt}
    />);
    const prompt = screen.getByLabelText('Prompt');
    const configuration = screen.getByRole('button', { name: 'Conversation settings' });
    const panel = document.getElementById(configuration.getAttribute('aria-controls') ?? '');
    expect(configuration).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveClass('hidden', 'lg:block');
    expect(prompt.closest('.hidden')).toBeNull();
    fireEvent.change(prompt, { target: { value: 'Improve Home Site' } });
    fireEvent.click(configuration);
    expect(configuration).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveClass('hidden');
    expect(screen.getByLabelText('Prompt')).toBe(prompt);
    fireEvent.click(configuration);
    expect(configuration).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveClass('hidden', 'lg:block');
    expect(prompt).toHaveValue('Improve Home Site');
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));
    expect(onRunPrompt).toHaveBeenCalledWith('Improve Home Site', undefined);
  });
});

it.each(['codex-app-server', 'devin-cli-acp'] as const)(
  'keeps a pasted image local until a %s first prompt is explicitly submitted', async (kind) => {
  const onRunPrompt = vi.fn();
  const onRunImagePrompt = vi.fn().mockResolvedValue(true);
  render(<NewChatScreen architectures={[]} heading="New Chat" subtitle="Test" isBusy={false}
    personas={[]} projectPath="" selectedPersonaId="default"
    selectedArchitectureId="single-chat" testIdPrefix="welcome"
    executionProfiles={[{ id: 'codex', name: 'Codex', kind, model: 'fixture',
      approvalMode: 'codex_guard', enabled: true, capabilitiesVersion: '1', createdAt: 1, updatedAt: 1 }]}
    selectedExecutionProfileId="codex" onArchitectureChange={vi.fn()} onDraftChange={vi.fn()}
    onPersonaChange={vi.fn()} onProjectPathChange={vi.fn()}
    onRunPrompt={onRunPrompt} onRunImagePrompt={onRunImagePrompt} />);
  const prompt = screen.getByLabelText('Prompt');
  const image = new File(['image'], 'clipboard.png', { type: 'image/png' });
  fireEvent.paste(prompt, { clipboardData: { files: [image] } });
  expect(screen.getByRole('button', { name: 'Remove clipboard.png' })).toBeInTheDocument();
  expect(onRunImagePrompt).not.toHaveBeenCalled();
  fireEvent.change(prompt, { target: { value: 'Look at this' } });
  fireEvent.keyDown(prompt, { key: 'Enter' });
  expect(onRunImagePrompt).toHaveBeenCalledExactlyOnceWith('Look at this', 'codex', [image]);
  expect(onRunPrompt).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove clipboard.png' })).not.toBeInTheDocument());
});
