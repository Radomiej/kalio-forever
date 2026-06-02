import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
  it('shows the env fallback provider and default model in the visible provider list', () => {
    const onUseEnvFallback = vi.fn();

    render(
      <ProviderSettingsSection
        credentials={[]}
        activeId={null}
        syncing={null}
        loading={false}
        showEnvFallback={true}
        envFallbackActive={true}
        envFallbackProviderId="env"
        envFallbackProviderLabel="OpenAI"
        envFallbackModel="gpt-4o-mini"
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

    expect(screen.getByTestId('provider-row-env')).toHaveTextContent('Environment fallback');
    expect(screen.getByTestId('provider-row-env')).toHaveTextContent('env');
    expect(screen.getByTestId('provider-row-env')).toHaveTextContent('OpenAI');
    expect(screen.getByTestId('provider-row-env')).toHaveTextContent('Default model: gpt-4o-mini');
    expect(screen.getByText(/Runtime falls back to the backend environment/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('provider-activate-env'));

    expect(onUseEnvFallback).toHaveBeenCalledTimes(1);
  });
});
