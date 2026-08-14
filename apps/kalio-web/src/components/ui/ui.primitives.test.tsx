import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './Badge';
import { Spinner } from './Spinner';

describe('UI primitives', () => {
  it('uses default variants and sizes', () => {
    render(<><Badge label="Default" /><Spinner /></>);

    expect(screen.getByTestId('badge')).toHaveClass('badge-ghost');
    expect(screen.getByTestId('spinner')).toHaveClass('loading-md');
  });

  it('accepts explicit variants and sizes', () => {
    render(<><Badge label="Success" variant="success" /><Spinner size="lg" /></>);

    expect(screen.getByTestId('badge')).toHaveClass('badge-success');
    expect(screen.getByTestId('spinner')).toHaveClass('loading-lg');
  });
});
