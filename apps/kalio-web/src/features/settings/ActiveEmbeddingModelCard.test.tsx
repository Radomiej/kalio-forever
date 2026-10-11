import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { EmbeddingStatus } from '@kalio/types';
import { ActiveEmbeddingModelCard } from './ActiveEmbeddingModelCard';

const status: EmbeddingStatus = {
  source: 'local', provider: 'local-transformers', configured: true,
  model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu',
  baseUrlMasked: '(local cache)', profileId: 'local',
};
const ready: NonNullable<ComponentProps<typeof ActiveEmbeddingModelCard>['localAvailability']> = {
  status: 'ready', installed: true, model: status.model, dimensions: 384,
  backend: 'cpu', message: null,
};

describe('ActiveEmbeddingModelCard', () => {
  it.each([
    ['ready', true, 'Installed · ready to use'],
    ['missing', false, 'Not installed · install below'],
    ['installing', false, 'Installing…'],
    ['error', false, 'Installation failed'],
    ['ready', false, 'Not installed · install below'],
  ] as const)('reports %s installation with installed=%s', (state, installed, label) => {
    render(<ActiveEmbeddingModelCard status={status} localAvailability={{ ...ready, status: state, installed }} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.getByText(status.model)).toBeInTheDocument();
  });

  it.each([
    { model: 'draft-model' }, { dimensions: 768 }, { backend: 'auto' as const },
  ])('does not apply draft availability when identity differs: %j', (draft) => {
    render(<ActiveEmbeddingModelCard status={status} localAvailability={{ ...ready, ...draft }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Availability not checked');
    expect(screen.getByText(status.model)).toBeInTheDocument();
    expect(screen.queryByText('Installed · ready to use')).not.toBeInTheDocument();
  });

  it('does not infer readiness from configured or unknown availability', () => {
    render(<ActiveEmbeddingModelCard status={status} localAvailability={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Availability not checked');
  });

  it('keeps the summary present while loading', () => {
    render(<ActiveEmbeddingModelCard status={null} localAvailability={null} />);
    expect(screen.getByRole('heading', { name: 'Selected embedding model' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking status…');
  });

  it.each([
    ['db', 'Selected · not tested'], ['env', 'Selected · not tested'],
    ['mock', 'Test provider'], ['disabled', 'Disabled'],
  ] as const)('shows %s without claiming local installation', (source, label) => {
    render(<ActiveEmbeddingModelCard status={{ ...status, source }} localAvailability={ready} />);
    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.queryByText('Installed · ready to use')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
