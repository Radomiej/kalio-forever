import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewChatScreen } from './NewChatScreen';

vi.mock('./PersonaCombobox', () => ({ PersonaCombobox: () => <span>Persona control</span> }));
vi.mock('./ExecutionProfileCombobox', () => ({ ExecutionProfileCombobox: () => <span>Runtime control</span> }));
vi.mock('./CodeIntelligenceQuickTrust', () => ({ CodeIntelligenceQuickTrust: () => null }));

describe('compact new-chat wizard', () => {
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
  it('moves from configuration to prompt and back without discarding the draft', () => {
    const onRunPrompt = vi.fn();
    render(<NewChatScreen
      architectures={[]} heading="New Chat" subtitle="Test" isBusy={false}
      personas={[]} projectPath="E:/Projekty/home-site" selectedPersonaId="default"
      selectedArchitectureId="single-chat" testIdPrefix="welcome"
      onArchitectureChange={vi.fn()} onDraftChange={vi.fn()} onPersonaChange={vi.fn()}
      onProjectPathChange={vi.fn()} onRunPrompt={onRunPrompt}
    />);
    const prompt = screen.getByLabelText('Prompt');
    expect(prompt.closest('.hidden')).toHaveClass('lg:contents');
    fireEvent.click(screen.getByRole('button', { name: 'Next — write prompt' }));
    expect(screen.getByRole('status')).toHaveTextContent('2 / 2');
    expect(prompt.closest('.hidden')).toBeNull();
    fireEvent.change(prompt, { target: { value: 'Improve Home Site' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back — configuration' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 / 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next — write prompt' }));
    expect(prompt).toHaveValue('Improve Home Site');
    fireEvent.click(screen.getByTestId('welcome-run-prompt'));
    expect(onRunPrompt).toHaveBeenCalledWith('Improve Home Site', undefined);
  });
});
