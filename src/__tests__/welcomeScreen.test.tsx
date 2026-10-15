/**
 * Regression guard for a real data-loss bug: "Use default location" and
 * "Choose a location…" used to call `createAt` directly, which
 * unconditionally seeds and overwrites whatever is at that path — no
 * check for a real, pre-existing file. A user picking (or landing on,
 * via the default path) a file that already held their real board lost
 * it, silently replaced with a fresh empty seed doc. Both buttons must
 * go through `openAt` instead, which only ever seeds a path that
 * genuinely has nothing at it yet.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WelcomeScreen } from '../renderer/components/shell/WelcomeScreen';
import { useDocStore } from '../renderer/store/docStore';

function installElectronMock(defaultPath: string) {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      data: {
        defaultPath: jest.fn().mockResolvedValue(defaultPath),
        pickSave: jest.fn().mockResolvedValue('/Users/me/existing-board.json'),
        pickOpen: jest.fn().mockResolvedValue('/Users/me/existing-board.json'),
      },
    },
  });
}

describe('WelcomeScreen never bypasses the existing-file check', () => {
  let openAtSpy: jest.SpyInstance;
  let createAtSpy: jest.SpyInstance;

  beforeEach(() => {
    installElectronMock('/Users/me/Library/ai-kanban/kanban.json');
    openAtSpy = jest.spyOn(useDocStore.getState(), 'openAt').mockResolvedValue(undefined);
    createAtSpy = jest.spyOn(useDocStore.getState(), 'createAt').mockResolvedValue(undefined);
  });

  afterEach(() => {
    openAtSpy.mockRestore();
    createAtSpy.mockRestore();
  });

  it('"Use default location" calls openAt, never createAt directly', async () => {
    render(<WelcomeScreen />);
    const button = await screen.findByRole('button', { name: 'Use default location' });
    await waitFor(() => expect(button).not.toBeDisabled());

    fireEvent.click(button);

    await waitFor(() =>
      expect(openAtSpy).toHaveBeenCalledWith('/Users/me/Library/ai-kanban/kanban.json'),
    );
    expect(createAtSpy).not.toHaveBeenCalled();
  });

  it('"Choose a location…" calls openAt with the picked path, never createAt directly', async () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Choose a location/ }));

    await waitFor(() =>
      expect(openAtSpy).toHaveBeenCalledWith('/Users/me/existing-board.json'),
    );
    expect(createAtSpy).not.toHaveBeenCalled();
  });

  it('"Open an existing file…" calls openAt with the picked path', async () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Open an existing file/ }));

    await waitFor(() =>
      expect(openAtSpy).toHaveBeenCalledWith('/Users/me/existing-board.json'),
    );
    expect(createAtSpy).not.toHaveBeenCalled();
  });
});
