import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { backendHealth } from '../../services/backendHealth';
import { BackendStatusBadge } from './BackendStatusBadge';

afterEach(() => {
  act(() => {
    backendHealth.reportSuccess();
    backendHealth.stop();
  });
});

describe('BackendStatusBadge', () => {
  it('appears when the backend goes offline and disappears after recovery', () => {
    const { queryByRole } = render(<BackendStatusBadge />);

    expect(queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      backendHealth.reportFailure();
    });

    expect(screen.getByRole('status')).toHaveTextContent('Backend offline — retrying…');

    act(() => {
      backendHealth.reportSuccess();
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
