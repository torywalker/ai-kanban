/**
 * Cmd+T opens the terminals dialog from the app shell, with the same guards
 * as the scratchpad shortcut.
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { useUiStore } from '@/store/uiStore';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { EMPTY_USAGE_TOTALS } from '../shared/usage';

function seededDoc(): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_seed01',
        name: 'Prompts',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        terminals: [{ id: 'trm_1', name: 'Terminal 1' }],
        lists: [{ id: 'lst_left', name: 'Backlog', cards: [] }],
      },
    ],
  };
}

function install(doc: KanbanDoc, activeBoardId: string | null) {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: '/tmp/t.json',
          recentFiles: [],
          activeBoardId,
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest
          .fn()
          .mockResolvedValue({ ok: true, value: JSON.stringify(doc) }),
        write: jest.fn().mockResolvedValue({ ok: true, value: null }),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/t.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn() },
      shell: { openExternal: jest.fn() },
      session: {
        run: jest.fn(),
        reply: jest.fn(),
        approve: jest.fn(),
        stop: jest.fn(),
        getState: jest.fn(),
        onSnapshot: jest.fn().mockReturnValue(() => {}),
      },
      usage: {
        cardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
        boardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
      },
    },
  });
}

function cmdT(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 't',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })),
  });
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
});

beforeEach(() => {
  useUiStore.setState({
    terminalsOpen: false,
    shortcutsHelpOpen: false,
    paletteOpen: false,
  });
});

describe('Cmd+T', () => {
  it('opens the dialog when no dialog is open', async () => {
    install(seededDoc(), 'brd_seed01');
    render(<AppShell />);
    await screen.findByText('Backlog');

    const event = cmdT(document.body);

    expect(event.defaultPrevented).toBe(true);
    expect(useUiStore.getState().terminalsOpen).toBe(true);
  });

  it('does nothing while another dialog is open', async () => {
    install(seededDoc(), 'brd_seed01');
    render(<AppShell />);
    await screen.findByText('Backlog');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);

    cmdT(document.body);

    expect(useUiStore.getState().terminalsOpen).toBe(false);
    dialog.remove();
  });

  it('does nothing while typing in an input', async () => {
    install(seededDoc(), 'brd_seed01');
    render(<AppShell />);
    await screen.findByText('Backlog');
    const input = document.createElement('input');
    document.body.appendChild(input);

    cmdT(input);

    expect(useUiStore.getState().terminalsOpen).toBe(false);
    input.remove();
  });

  it('does nothing with no active board', async () => {
    install({ version: CURRENT_VERSION, tags: {}, boards: [] }, null);
    render(<AppShell />);
    await act(async () => {});

    cmdT(document.body);

    expect(useUiStore.getState().terminalsOpen).toBe(false);
  });
});
