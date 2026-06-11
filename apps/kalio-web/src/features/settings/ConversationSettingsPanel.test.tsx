import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationSettingsPanel } from './ConversationSettingsPanel';

const { apiGetMock, apiPutMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPutMock: vi.fn(),
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    get: apiGetMock,
    put: apiPutMock,
  },
}));

describe('ConversationSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockResolvedValue({
      data: {
        autoRenameEnabled: true,
        renameEveryReplies: 4,
      },
    });
    apiPutMock.mockResolvedValue({ data: null });
  });

  it('loads persisted settings and saves toggle and cadence changes', async () => {
    render(<ConversationSettingsPanel />);

    const toggle = screen.getByTestId('conversation-title-auto-rename-toggle');
    const slider = screen.getByTestId('conversation-title-rename-every-slider');

    await waitFor(() => {
      expect(toggle).toBeChecked();
      expect(slider).toHaveValue('4');
    });

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(apiPutMock).toHaveBeenCalledWith(
        '/api/credentials/settings/conversation-title',
        { autoRenameEnabled: false },
      );
    });

    fireEvent.change(slider, { target: { value: '6' } });
    await waitFor(() => {
      expect(apiPutMock).toHaveBeenCalledWith(
        '/api/credentials/settings/conversation-title',
        { renameEveryReplies: 6 },
      );
    });
  });

  it('falls back to defaults when loading the settings fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiGetMock.mockRejectedValueOnce(new Error('load failed'));

    render(<ConversationSettingsPanel />);

    const toggle = await screen.findByTestId('conversation-title-auto-rename-toggle');
    const slider = screen.getByTestId('conversation-title-rename-every-slider');

    await waitFor(() => expect(consoleError).toHaveBeenCalledWith(
      '[ConversationSettingsPanel] load failed',
      expect.any(Error),
    ));
    expect(toggle).not.toBeChecked();
    expect(slider).toHaveValue('3');
    consoleError.mockRestore();
  });

  it('restores the previous state when saving fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiPutMock.mockRejectedValueOnce(new Error('save failed'));

    render(<ConversationSettingsPanel />);

    const toggle = await screen.findByTestId('conversation-title-auto-rename-toggle');
    const slider = screen.getByTestId('conversation-title-rename-every-slider');

    expect(toggle).toBeChecked();
    expect(slider).toHaveValue('4');

    fireEvent.click(toggle);

    await waitFor(() => expect(apiPutMock).toHaveBeenCalledWith(
      '/api/credentials/settings/conversation-title',
      { autoRenameEnabled: false },
    ));
    await waitFor(() => expect(screen.getByTestId('conversation-title-auto-rename-toggle')).toBeChecked());
    expect(screen.getByTestId('conversation-title-rename-every-slider')).toHaveValue('4');
    expect(consoleError).toHaveBeenCalledWith(
      '[ConversationSettingsPanel] save failed',
      expect.any(Error),
    );
    consoleError.mockRestore();
  });
});
