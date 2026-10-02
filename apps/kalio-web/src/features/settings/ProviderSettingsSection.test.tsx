import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AddForm } from './llm-panel.types';
import { ProviderSettingsSection } from './ProviderSettingsSection';

const EMPTY_FORM: AddForm = {
  name: '',
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: '',
  nameEdited: false,
};

describe('ProviderSettingsSection', () => {
  it('keeps the QA mock fallback out of the selectable provider list', () => {
    const onUseEnvFallback = vi.fn();

    render(
      <ProviderSettingsSection
        credentials={[]}
        activeId={null}
        syncing={null}
        loading={false}
        showEnvFallback={true}
        envFallbackActive={true}
        envFallbackProviderId="mock"
        envFallbackProviderLabel="Mock"
        envFallbackModel="mock"
        showForm={false}
        form={EMPTY_FORM}
        allowsKeylessAuth={false}
        normalizedApiKey={undefined}
        testState="idle"
        testError={null}
        emptyStateMessage="No credentials configured. Runtime currently uses the env fallback."
        onActivate={vi.fn()}
        onRemove={vi.fn()}
        onUseEnvFallback={onUseEnvFallback}
        onShowAdd={vi.fn()}
        onCancelAdd={vi.fn()}
        onSubmit={vi.fn()}
        onProviderTypeChange={vi.fn()}
        onNameChange={vi.fn()}
        onApiKeyChange={vi.fn()}
        onBaseUrlChange={vi.fn()}
        onModelChange={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByTestId('provider-env-mock')).toHaveTextContent(/test-only fallback/i);
    expect(screen.queryByTestId('provider-row-env')).not.toBeInTheDocument();
    expect(screen.queryByTestId('provider-activate-env')).not.toBeInTheDocument();
    expect(onUseEnvFallback).not.toHaveBeenCalled();
  });

  it('uses clear primary and cancel button hierarchy for adding a provider', () => {
    render(
      <ProviderSettingsSection
        credentials={[]}
        activeId={null}
        syncing={null}
        loading={false}
        showEnvFallback={false}
        envFallbackActive={false}
        envFallbackProviderId="env"
        showForm={true}
        form={EMPTY_FORM}
        allowsKeylessAuth={false}
        normalizedApiKey={undefined}
        testState="idle"
        testError={null}
        emptyStateMessage="No providers configured."
        onActivate={vi.fn()}
        onRemove={vi.fn()}
        onUseEnvFallback={vi.fn()}
        onShowAdd={vi.fn()}
        onCancelAdd={vi.fn()}
        onSubmit={vi.fn()}
        onProviderTypeChange={vi.fn()}
        onNameChange={vi.fn()}
        onApiKeyChange={vi.fn()}
        onBaseUrlChange={vi.fn()}
        onModelChange={vi.fn()}
        onTest={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Add Provider' })).toHaveClass('btn-primary');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('btn-error');
  });
});
