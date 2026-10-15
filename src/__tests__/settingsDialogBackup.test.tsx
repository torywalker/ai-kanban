/**
 * Settings' "Create Backup" duplicates the live data file beside itself.
 * It must flush unsaved edits first (same reason Move flushes), call the
 * backup IPC with the current path, and leave that path as the open file.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsDialog } from '../renderer/components/shell/SettingsDialog';
import { useDocStore } from '../renderer/store/docStore';
import { writeNow } from '../renderer/store/persistence';

jest.mock('../renderer/store/persistence', () => ({
  writeNow: jest.fn().mockResolvedValue(undefined),
}));

function installElectronMock() {
  const backup = jest.fn().mockResolvedValue({
    ok: true,
    value: '/Users/me/kanban-bak-2026-09-14T12-07-05.json',
  });
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({ recentFiles: [] }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        move: jest.fn(),
        exists: jest.fn(),
        pickSave: jest.fn(),
        reveal: jest.fn(),
        backup,
      },
    },
  });
  return { backup };
}

describe('SettingsDialog "Create Backup"', () => {
  let backup: jest.Mock;

  beforeEach(() => {
    ({ backup } = installElectronMock());
    useDocStore.setState({ filePath: '/Users/me/kanban.json' });
    (writeNow as jest.Mock).mockClear();
  });

  it('is offered next to the other data-file actions', () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Create Backup' }),
    ).toBeInTheDocument();
  });

  it('flushes then copies the open file, without switching to the backup', async () => {
    render(<SettingsDialog open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Backup' }));

    await waitFor(() => expect(writeNow).toHaveBeenCalled());
    await waitFor(() =>
      expect(backup).toHaveBeenCalledWith('/Users/me/kanban.json'),
    );
    expect(useDocStore.getState().filePath).toBe('/Users/me/kanban.json');
  });

  it('is disabled when no data file is open', () => {
    useDocStore.setState({ filePath: null });
    render(<SettingsDialog open onOpenChange={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Create Backup' }),
    ).toBeDisabled();
  });
});
