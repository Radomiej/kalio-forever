import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageResultRenderer } from './ImageResultRenderer';

describe('ImageResultRenderer', () => {
  it('renders metadata, exposes the download action, and opens and closes the preview modal', () => {
    render(
      <ImageResultRenderer
        data={{
          image_url: 'https://example.com/generated.png',
          download_url: 'https://example.com/download/generated.png',
          path: '/tmp/generated.png',
          model: 'gpt-image-1',
          size: '1024x1024',
          format: 'png',
          durationMs: 1530,
          refCount: 2,
          message: 'Mountain at sunrise',
        }}
      />,
    );

    expect(screen.getByAltText('Mountain at sunrise')).toHaveAttribute('src', 'https://example.com/generated.png');
    expect(screen.getByText('gpt-image-1')).toBeInTheDocument();
    expect(screen.getByText('1024x1024')).toBeInTheDocument();
    expect(screen.getByText('.png')).toBeInTheDocument();
    expect(screen.getByText('1.5s')).toBeInTheDocument();
    expect(screen.getByText('2 ref(s)')).toBeInTheDocument();
    expect(screen.getByText('/tmp/generated.png')).toBeInTheDocument();

    const downloadLink = screen.getByRole('link', { name: /download/i });
    expect(downloadLink).toHaveAttribute('href', 'https://example.com/download/generated.png');
    expect(downloadLink).toHaveAttribute('download', 'generated.png');

    fireEvent.click(screen.getByRole('button', { name: /view full size/i }));

    expect(document.querySelector('dialog.modal-open')).not.toBeNull();
    expect(screen.getAllByAltText('Mountain at sunrise')[1]).toHaveAttribute('src', 'https://example.com/generated.png');

    fireEvent.click(screen.getByText('Close'));

    expect(document.querySelector('dialog.modal-open')).toBeNull();

    fireEvent.click(screen.getByAltText('Mountain at sunrise'));
    expect(document.querySelector('dialog.modal-open')).not.toBeNull();
  });

  it('omits the download action and uses the fallback alt text when metadata is sparse', () => {
    render(
      <ImageResultRenderer
        data={{
          image_url: 'https://example.com/generated.png',
          path: '/tmp/generated.png',
        }}
      />,
    );

    expect(screen.getByAltText('Generated image')).toHaveAttribute('src', 'https://example.com/generated.png');
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
    expect(screen.queryByText('gpt-image-1')).toBeNull();
  });
});
