import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AppTile } from './AppTile';

describe('AppTile', () => {
  it('renders the tile name, description, and keyboard activation', () => {
    const onClick = vi.fn();

    render(
      <AppTile
        id="cats-suite"
        name="Cats Suite"
        description="A cat tools pack"
        size="wide"
        index={2}
        onClick={onClick}
      />,
    );

    const tile = screen.getByTestId('app-tile-cats-suite');
    expect(tile).toHaveClass('col-span-2');
    expect(tile).toHaveAttribute('title', 'A cat tools pack');
    expect(tile).toHaveTextContent('Cats Suite');
    expect(tile).toHaveTextContent('A cat tools pack');

    fireEvent.keyDown(tile, { key: 'Enter' });
    fireEvent.keyDown(tile, { key: ' ' });

    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('shows generated icon actions without triggering the tile click', () => {
    const onClick = vi.fn();
    const onGenerateIcon = vi.fn();
    const onRemoveIcon = vi.fn();

    render(
      <AppTile
        id="cats-suite"
        name="Cats Suite"
        size="small"
        index={1}
        iconUrl="https://example.com/icon.png"
        onClick={onClick}
        onGenerateIcon={onGenerateIcon}
        onRemoveIcon={onRemoveIcon}
      />,
    );

    fireEvent.click(screen.getByTestId('tile-gen-icon-cats-suite'));
    fireEvent.click(screen.getByTestId('tile-rm-icon-cats-suite'));

    expect(onGenerateIcon).toHaveBeenCalledTimes(1);
    expect(onRemoveIcon).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByAltText('')).toHaveAttribute('src', 'https://example.com/icon.png');
  });

  it('shows a loading spinner instead of action buttons while generating an icon', () => {
    render(
      <AppTile
        id="cats-suite"
        name="Cats Suite"
        size="small"
        index={0}
        isGenerating={true}
        onClick={() => undefined}
        onGenerateIcon={() => undefined}
      />,
    );

    expect(screen.queryByTestId('tile-gen-icon-cats-suite')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tile-rm-icon-cats-suite')).not.toBeInTheDocument();
  });
});
