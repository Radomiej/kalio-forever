import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { RAAppGroup } from '@kalio/types';
import { RAAppGroupCard, type RAAppGroupCardProps } from './RAAppGroupCard';

function makeGroup(): RAAppGroup {
  return {
    slug: 'my-app',
    name: 'My App',
    source: 'user',
    current: {
      version: '1.2.0',
      status: 'current',
      zipPath: '/tmp/current.zip',
      createdAt: 10,
      meta: { id: 'my-app', name: 'My App', version: '1.2.0', description: 'Test app' },
    },
    history: [
      {
        version: '1.1.0',
        status: 'archived',
        zipPath: '/tmp/history-1.1.0.zip',
        createdAt: 9,
        meta: { id: 'my-app', name: 'My App', version: '1.1.0' },
      },
    ],
  };
}

describe('RAAppGroupCard', () => {
  it('exposes download actions for current and archived releases', () => {
    const onDownloadVersion = vi.fn();
    const DownloadableRAAppGroupCard = RAAppGroupCard as unknown as ComponentType<
      RAAppGroupCardProps & {
        onDownloadVersion: (slug: string, version: string) => void;
      }
    >;

    render(
      <DownloadableRAAppGroupCard
        group={makeGroup()}
        onRun={() => undefined}
        onDelete={() => undefined}
        onApprove={async () => undefined}
        onDiscardDraft={async () => undefined}
        onRollback={async () => undefined}
        onDownloadVersion={onDownloadVersion}
      />,
    );

    fireEvent.click(screen.getByTestId('raapp-download-current-my-app'));
    fireEvent.click(screen.getByText('History (1)'));
    fireEvent.click(screen.getByTestId('raapp-download-history-my-app-1.1.0'));

    expect(onDownloadVersion).toHaveBeenCalledTimes(2);
    expect(onDownloadVersion).toHaveBeenNthCalledWith(1, 'my-app', '1.2.0');
    expect(onDownloadVersion).toHaveBeenNthCalledWith(2, 'my-app', '1.1.0');
  });

  it('does not delete a group when the confirmation dialog is cancelled', () => {
    const onDelete = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <RAAppGroupCard
        group={makeGroup()}
        onRun={() => undefined}
        onDelete={onDelete}
        onApprove={async () => undefined}
        onDiscardDraft={async () => undefined}
        onRollback={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('raapp-delete-my-app'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes a group after confirmation', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <RAAppGroupCard
        group={makeGroup()}
        onRun={() => undefined}
        onDelete={onDelete}
        onApprove={async () => undefined}
        onDiscardDraft={async () => undefined}
        onRollback={async () => undefined}
      />,
    );

    fireEvent.click(screen.getByTestId('raapp-delete-my-app'));

    expect(onDelete).toHaveBeenCalledWith('my-app');
  });
});