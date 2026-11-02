import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectSessionGroups } from './ProjectSessionGroups';
import type { ProjectSessionGroup } from './projectSessionListModel';

describe('ProjectSessionGroups accessibility', () => {
  it('keeps the count readable while preserving expansion and children', () => {
    const group: ProjectSessionGroup = {
      project: { id: 'system:none', name: 'Bez projektu', path: null, kind: 'none', isSystem: true, createdAt: 1, updatedAt: 1 },
      entries: [{ type: 'session', depth: 0, session: { id: 's', title: 'Chat', personaId: 'default', createdAt: 1, updatedAt: 1 } }],
      latestActivityAt: 1, isExpanded: false,
    };
    render(<ProjectSessionGroups groups={[group]}>{() => <p>Conversation child</p>}</ProjectSessionGroups>);
    const toggle = screen.getByRole('button', { name: 'Bez projektu 1' });
    expect(within(toggle).getByText('1')).toHaveClass('text-base-content/60');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Conversation child')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Conversation child')).toBeInTheDocument();
  });
});
