import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Persona } from '@kalio/types';
import { PersonaListItem } from './PersonaListItem';

const PERSONA: Persona = {
  id: 'p1',
  name: 'Existing Persona',
  systemPrompt: 'Prompt',
  model: 'gpt-4o-mini',
  allowedTools: ['vfs_read_file'],
  skillIds: [],
  mcpPolicy: 'allow_all',
  avatarSeed: 'existing persona',
  avatarVariant: 'marble',
  avatarPaletteKey: 'ocean',
  avatarIndex: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe('PersonaListItem', () => {
  it('renders compact selector without edit/delete controls', () => {
    render(<PersonaListItem persona={PERSONA} selected={false} onSelect={() => {}} />);

    expect(screen.getByText('Existing Persona')).toBeInTheDocument();
    expect(screen.getByText('1 tool · MCP allow_all')).toBeInTheDocument();
    expect(screen.queryByTitle('Edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('persona-delete-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('persona-avatar')).toBeInTheDocument();
  });
});
