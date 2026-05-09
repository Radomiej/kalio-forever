import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Credential } from '@kalio/types';
import { ProviderCard } from './ProviderCard';

const fetchMock = vi.fn();

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-1',
    name: 'Primary Provider',
    provider: 'custom',
    baseUrl: 'http://localhost:11434',
    model: 'gpt-4.1',
    createdAt: 1,
    ...overrides,
  };
}

describe('ProviderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
      writable: true,
    });
  });

  it('renders provider details and calls onActivate from the header control', () => {
    const onActivate = vi.fn();

    render(
      <ProviderCard
        credential={makeCredential()}
        isActive={true}
        isSyncing={false}
        onActivate={onActivate}
        onRemove={() => undefined}
      />,
    );

    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:11434')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('provider-activate-cred-1'));
    expect(onActivate).toHaveBeenCalledWith('cred-1');
  });

  it('shows success details when connection test succeeds', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: true, modelCount: 12 }),
    });

    render(
      <ProviderCard
        credential={makeCredential()}
        isActive={false}
        isSyncing={false}
        onActivate={() => undefined}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('provider-test-cred-1'));

    expect(await screen.findByText(/Connected — 12 models available/i)).toBeInTheDocument();
    expect(screen.getByText(/12 models/i)).toBeInTheDocument();
  });

  it('shows backend and network errors from connection tests', async () => {
    fetchMock
      .mockResolvedValueOnce({
        json: async () => ({ ok: false, error: 'bad credentials' }),
      })
      .mockRejectedValueOnce(new Error('network down'));

    render(
      <ProviderCard
        credential={makeCredential()}
        isActive={false}
        isSyncing={false}
        onActivate={() => undefined}
        onRemove={() => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('provider-test-cred-1'));
    expect(await screen.findByText(/Failed: bad credentials/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('provider-test-cred-1'));
    expect(await screen.findByText(/Failed: network down/i)).toBeInTheDocument();
  });

  it('removes inactive credentials immediately', () => {
    const onRemove = vi.fn();

    render(
      <ProviderCard
        credential={makeCredential()}
        isActive={false}
        isSyncing={false}
        onActivate={() => undefined}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByTestId('provider-remove-cred-1'));
    expect(onRemove).toHaveBeenCalledWith('cred-1');
  });

  it('asks for confirmation before removing the active provider', async () => {
    const onRemove = vi.fn();

    render(
      <ProviderCard
        credential={makeCredential()}
        isActive={true}
        isSyncing={false}
        onActivate={() => undefined}
        onRemove={onRemove}
      />,
    );

    fireEvent.click(screen.getByTestId('provider-remove-cred-1'));
    expect(screen.getByText(/remove anyway/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText('No'));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('provider-remove-cred-1'));
    fireEvent.click(screen.getByText('Yes'));

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('cred-1'));
  });
});
