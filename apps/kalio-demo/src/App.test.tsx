import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('Kalio demo page', () => {
  it('renders a static product overview without backend-dependent UI', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: /build with agentic workflows/i })).toBeTruthy();
    expect(screen.getByLabelText(/kalio overview video/i)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Chat' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Tools' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Files' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Observability' })).toBeTruthy();
    expect(screen.getByText(/component gallery/i)).toBeTruthy();
    expect(screen.queryByText(/localhost/i)).toBeNull();
  });
});
