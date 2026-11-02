import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { EmbeddingStatus, UpdateLocalEmbeddingConfigDto } from '@kalio/types';
import { LocalEmbeddingConfigCard } from './LocalEmbeddingConfigCard';

const INITIAL_FORM: UpdateLocalEmbeddingConfigDto = {
  enabled: true,
  model: 'Xenova/multilingual-e5-small',
  dimensions: 384,
  backend: 'cpu',
};

const LOCAL_STATUS: EmbeddingStatus = {
  provider: 'local-transformers',
  source: 'local',
  model: 'Xenova/multilingual-e5-small',
  dimensions: 384,
  baseUrlMasked: '(local cache)',
  configured: true,
  backend: 'cpu',
  cacheDir: './data/embeddings-cache',
  profileId: 'local-transformers-xenova-multilingual-e5-small-384-cpu',
  modelParameters: '118M',
};

function renderHarness() {
  const saveMock = vi.fn();
  const useLocalMock = vi.fn();
  const testLocalMock = vi.fn();
  const installLocalMock = vi.fn();
  const reindexAllMock = vi.fn();

  function Harness() {
    const [form, setForm] = useState<UpdateLocalEmbeddingConfigDto>(INITIAL_FORM);
    const [dirty, setDirty] = useState(false);

    return (
      <LocalEmbeddingConfigCard
        form={form}
        dirty={dirty}
        syncing={null}
        reindexResult={null}
        status={LOCAL_STATUS}
        localTestState="idle"
        localTestMessage={null}
        localConfigWarning={null}
        localAvailability={{ status: 'missing', installed: false, model: 'Xenova/multilingual-e5-small', dimensions: 384, backend: 'cpu', message: 'Model not installed yet.' }}
        onChange={setForm}
        onDirtyChange={setDirty}
        onSave={() => saveMock(form)}
        onInstall={installLocalMock}
        onTest={testLocalMock}
        onUseLocal={useLocalMock}
        onReindexAll={reindexAllMock}
      />
    );
  }

  return {
    ...render(<Harness />),
    saveMock,
    useLocalMock,
    installLocalMock,
    testLocalMock,
    reindexAllMock,
  };
}

describe('LocalEmbeddingConfigCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enables saving after a local setting change and carries the selected model dimensions', async () => {
    const user = userEvent.setup();
    const { saveMock } = renderHarness();

    const saveButton = screen.getByTestId('embedding-local-save');
    const enabledToggle = screen.getByTestId('embedding-local-enabled');
    const modelSelect = screen.getByTestId('embedding-local-model');

    expect(saveButton).toBeDisabled();

    await user.click(enabledToggle);
    await user.selectOptions(modelSelect, 'Xenova/multilingual-e5-base');

    expect(saveButton).toBeEnabled();
    expect(enabledToggle).not.toBeChecked();

    await user.click(saveButton);

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
        enabled: false,
        model: 'Xenova/multilingual-e5-base',
        dimensions: 768,
        backend: 'cpu',
      }));
    });
  });

  it('offers CPU-ready Gemma 2 text embeddings with the matching 768 dimensions', async () => {
    const user = userEvent.setup();
    const { saveMock } = renderHarness();
    const modelSelect = screen.getByTestId('embedding-local-model');

    await user.selectOptions(modelSelect, 'onnx-community/embeddinggemma-2-ONNX');
    await user.click(screen.getByTestId('embedding-local-save'));

    await waitFor(() => {
      expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({
        model: 'onnx-community/embeddinggemma-2-ONNX',
        dimensions: 768,
        backend: 'cpu',
      }));
    });
    expect(modelSelect).toHaveTextContent('270M · 175 MB q4 text model');
  });

  it('shows install state and keeps local testing disabled until the model is ready', async () => {
    renderHarness();

    expect(screen.getByTestId('embedding-local-install-btn')).toHaveTextContent('Install model');
    expect(screen.getByTestId('embedding-local-test-btn')).toBeDisabled();
    expect(screen.getByTestId('embedding-local-availability-message')).toHaveTextContent('Model not installed yet.');
  });

  it('turns a tokenizer initialization exception into a recovery instruction', () => {
    render(<LocalEmbeddingConfigCard
      form={INITIAL_FORM}
      dirty={false}
      syncing={null}
      reindexResult={null}
      status={LOCAL_STATUS}
      localTestState="idle"
      localTestMessage={null}
      localConfigWarning={null}
      localAvailability={{
        status: 'error', installed: false, model: INITIAL_FORM.model,
        dimensions: 384, backend: 'cpu', message: "Cannot read properties of undefined (reading 'tokenizer_class')",
      }}
      onChange={vi.fn()}
      onDirtyChange={vi.fn()}
      onSave={vi.fn()}
      onInstall={vi.fn()}
      onTest={vi.fn()}
      onUseLocal={vi.fn()}
      onReindexAll={vi.fn()}
    />);

    expect(screen.getByTestId('embedding-local-availability-message')).toHaveTextContent(
      'The saved model could not be loaded because its tokenizer metadata is unavailable. Reinstall it or choose another local model.',
    );
    expect(screen.getByTestId('embedding-local-availability-message')).not.toHaveTextContent('tokenizer_class');
    expect(screen.getByTestId('embedding-local-install-btn')).toHaveTextContent('Install model');
    expect(screen.getByTestId('embedding-local-test-btn')).toBeDisabled();
  });
});
