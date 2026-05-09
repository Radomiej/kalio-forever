import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RAAppSummary } from '@kalio/types';
import { RAAppCoreCard } from './RAAppCoreCard';

function makeApp(): RAAppSummary {
  return {
    id: 'generated-cats',
    name: 'Koci Dashboard',
    description: 'Opis aplikacji o kotach',
    version: '1.2.3',
    tags: ['cats', 'dashboard'],
    expose_as_tool: false,
    tool_description: '',
    source: 'user',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('RAAppCoreCard', () => {
  it('renders catalog card content', () => {
    render(<RAAppCoreCard app={makeApp()} onRun={() => undefined} />);

    expect(screen.getByTestId('raapp-catalog-generated-cats')).toBeInTheDocument();
    expect(screen.getByText('Koci Dashboard')).toBeInTheDocument();
    expect(screen.getByText('v1.2.3')).toBeInTheDocument();
    expect(screen.getByText('user')).toBeInTheDocument();
    expect(screen.getByText('Opis aplikacji o kotach')).toBeInTheDocument();
  });

  it('calls onRun with app name', () => {
    const onRun = vi.fn();
    render(<RAAppCoreCard app={makeApp()} onRun={onRun} />);

    fireEvent.click(screen.getByTestId('raapp-catalog-run-generated-cats'));

    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun).toHaveBeenCalledWith('Koci Dashboard');
  });
});
