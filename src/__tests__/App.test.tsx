import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import App from '../renderer/App';

beforeAll(() => {
  // jsdom does not implement matchMedia; useTheme() (called from AppShell)
  // needs it to decide light/dark mode.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });

  Object.defineProperty(window, 'electron', {
    writable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: null,
          recentFiles: [],
          activeBoardId: null,
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest.fn(),
        write: jest.fn(),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn(), read: jest.fn() },
      shell: { openExternal: jest.fn() },
      session: {
        run: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        approve: jest.fn().mockResolvedValue(undefined),
        stop: jest.fn().mockResolvedValue(undefined),
        getState: jest.fn().mockResolvedValue(undefined),
        onSnapshot: jest.fn().mockReturnValue(() => {}),
      },
    },
  });
});

describe('App', () => {
  it('shows the welcome screen when no data file is configured', async () => {
    render(<App />);
    expect(
      await screen.findByRole('button', { name: /use default location/i }),
    ).toBeInTheDocument();
  });
});
