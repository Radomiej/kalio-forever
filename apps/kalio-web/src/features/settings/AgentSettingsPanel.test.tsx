import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
vi.mock('./LLMPanel', () => ({ LLMPanel: () => <p>Conversational model configuration</p> }));
vi.mock('./DecisionSettingsPanel', () => ({ DecisionSettingsPanel: () => <p>Typed decision configuration</p> }));
import { AgentSettingsPanel } from './AgentSettingsPanel';

describe('AgentSettingsPanel', () => {
  it('switches between separate LLM and Decision settings', () => {
    render(<AgentSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Decision Settings' }));
    expect(screen.getByText('Typed decision configuration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decision Settings' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'LLM Settings' }));
    expect(screen.getByText('Conversational model configuration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LLM Settings' })).toHaveAttribute('aria-pressed', 'true');
  });
});
