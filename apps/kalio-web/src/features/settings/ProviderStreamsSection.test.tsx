import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProviderStreamsSection } from './ProviderStreamsSection';

describe('ProviderStreamsSection', () => {
  it('renders the current stream limit and commits only after release', async () => {
    const onInputChange = vi.fn();
    const onCommit = vi.fn();

    render(
      <ProviderStreamsSection
        value={2}
        onInputChange={onInputChange}
        onCommit={onCommit}
      />,
    );

    expect(screen.getByTestId('provider-max-streams-value')).toHaveTextContent('2');

    const slider = screen.getByTestId('provider-max-streams-slider') as HTMLInputElement;
    slider.value = '8';
    fireEvent.input(slider);

    expect(onInputChange).toHaveBeenCalledWith(8);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.mouseUp(slider);

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(8));
  });
});
