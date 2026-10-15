/**
 * "Move data file…" writes the current board to whatever path the user
 * picks. If that path already holds an unrelated existing file, moving
 * there must not silently destroy it — the same class of bug fixed for
 * the welcome screen's "Use default location"/"Choose a location…"
 * buttons (see welcomeScreen.test.tsx). This checks the added
 * verification step: `api.data.exists` is checked before moving, and a
 * confirmation is required before an existing file is overwritten.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { SettingsDialog } from '../renderer/components/shell/SettingsDialog';
import { useDocStore } from '../renderer/store/docStore';

jest.mock('../renderer/store/persistence', () => ({
  writeNow: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

function installElectronMock() {
  const move = jest.fn().mockResolvedValue({ ok: true, value: null });
  const exists = jest.fn();
  const pickSave = jest.fn().mockResolvedValue('/Users/me/target.json');
  const settingsWrite = jest.fn().mockResolvedValue({});
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({ recentFiles: [] }),
        write: settingsWrite,
      },
      data: {
        move,
        exists,
        pickSave,
        reveal: jest.fn(),
      },
    },
  });
  return { move, exists, pickSave, settingsWrite };
}

describe('SettingsDialog "Move data file…" verifies the target first', () => {
  let move: jest.Mock;
  let exists: jest.Mock;
  let settingsWrite: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ move, exists, settingsWrite } = installElectronMock());
    useDocStore.setState({ filePath: '/Users/me/current.json' });
  });

  it('moves immediately when the target path has nothing at it', async () => {
    exists.mockResolvedValue(false);
    render(<SettingsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Move data file/ }));

    await waitFor(() =>
      expect(exists).toHaveBeenCalledWith('/Users/me/target.json'),
    );
    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        '/Users/me/current.json',
        '/Users/me/target.json',
      ),
    );
    expect(
      screen.queryByText('Replace existing file?'),
    ).not.toBeInTheDocument();
  });

  it('asks for confirmation instead of moving when the target already exists', async () => {
    exists.mockResolvedValue(true);
    render(<SettingsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Move data file/ }));

    await waitFor(() =>
      expect(exists).toHaveBeenCalledWith('/Users/me/target.json'),
    );
    expect(
      await screen.findByText('Replace existing file?'),
    ).toBeInTheDocument();
    // Must not have moved yet — the user hasn't confirmed anything.
    expect(move).not.toHaveBeenCalled();
  });

  it('only moves after the user explicitly confirms the overwrite', async () => {
    exists.mockResolvedValue(true);
    render(<SettingsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Move data file/ }));
    await screen.findByText('Replace existing file?');

    fireEvent.click(screen.getByRole('button', { name: 'Overwrite and move' }));

    await waitFor(() =>
      expect(move).toHaveBeenCalledWith(
        '/Users/me/current.json',
        '/Users/me/target.json',
      ),
    );
  });

  it('does not move at all when the confirmation is cancelled', async () => {
    exists.mockResolvedValue(true);
    render(<SettingsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Move data file/ }));
    await screen.findByText('Replace existing file?');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(
        screen.queryByText('Replace existing file?'),
      ).not.toBeInTheDocument(),
    );
    expect(move).not.toHaveBeenCalled();
  });

  it('adopts and persists the target when json moved but assets failed', async () => {
    exists.mockResolvedValue(false);
    move.mockResolvedValue({
      ok: false,
      error:
        'Data file moved to /Users/me/target.json, but images could not be moved.',
      jsonMoved: true,
    });
    render(<SettingsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Move data file/ }));

    await waitFor(() =>
      expect(useDocStore.getState().filePath).toBe('/Users/me/target.json'),
    );
    expect(settingsWrite).toHaveBeenCalledWith({
      dataFilePath: '/Users/me/target.json',
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/images/i));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps the source path on an ordinary move failure', async () => {
    exists.mockResolvedValue(false);
    move.mockResolvedValue({ ok: false, error: 'move failed' });
    render(<SettingsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /Move data file/ }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('move failed'),
    );
    expect(useDocStore.getState().filePath).toBe('/Users/me/current.json');
    expect(settingsWrite).not.toHaveBeenCalledWith({
      dataFilePath: '/Users/me/target.json',
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
