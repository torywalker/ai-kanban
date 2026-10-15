/**
 * TDD tests for the Cmd/Ctrl+"?" "show keyboard shortcuts" shortcut and its
 * ShortcutsHelpDialog. The keydown handler mirrors the existing Cmd+N guard
 * (AppShell.tsx): suppressed while typing in an input/textarea/
 * contenteditable element, and suppressed while another dialog (e.g. the
 * command palette) is already open, rather than stacking a second dialog on
 * top. Checked against `event.key === '?'` directly (not a separate
 * `shiftKey` check) so the binding reads as "Cmd + ?", matching what the key
 * actually reports once Shift+/ produces the '?' character.
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { ShortcutsHelpDialog } from '@/components/shell/ShortcutsHelpDialog';
import { useUiStore } from '@/store/uiStore';
import { SHORTCUTS } from '@/lib/shortcuts';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { EMPTY_USAGE_TOTALS } from '../shared/usage';

// cmdk (the command palette's underlying list component) observes element
// size via ResizeObserver, which jsdom does not implement -- mirrors the
// existing stub in quickAddCard.test.tsx.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// AppShell only mounts CommandPalette/ShortcutsHelpDialog once it's past the
// welcome screen (see the early `status.kind === 'welcome'` return in
// AppShell.tsx), so these tests need a seeded board -- mirrors
// quickAddCard.test.tsx's `seededDoc()`.
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
        lists: [{ id: 'lst_left', name: 'Backlog', cards: [] }],
      },
    ],
  };
}

// The two shapes the same physical keystroke arrives in. macOS does NOT
// report '?' while Command is held: Chromium reads `key` from NSEvent's
// `characters`, which macOS computes with the Shift transformation dropped
// for Command-modified events -- the same reason Cmd+Shift+P arrives as 'p'.
// So ⌘? reaches the renderer as key='/' on code='Slash', and a handler that
// only looks at `key === '?'` never fires on the platform this app ships on.
// `KeyboardEventInit` is a DOM lib type this project's ESLint env does not
// know about, so the fields these tests actually set are spelled out here.
type KeystrokeInit = {
  key: string;
  code: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
};

const CMD_QUESTION_KEYSTROKES: [string, KeystrokeInit][] = [
  [
    'macOS, where Cmd+Shift+/ reports "/"',
    { key: '/', code: 'Slash', metaKey: true, shiftKey: true },
  ],
  [
    'Windows/Linux, where Ctrl+Shift+/ reports "?"',
    { key: '?', code: 'Slash', ctrlKey: true, shiftKey: true },
  ],
];

function dispatchCmdQuestion(
  target: HTMLElement,
  init: KeystrokeInit = CMD_QUESTION_KEYSTROKES[0][1],
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    ...init,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

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
  global.ResizeObserver = ResizeObserverStub;
});

describe('ShortcutsHelpDialog', () => {
  it('lists every registered shortcut with its description when open', () => {
    render(<ShortcutsHelpDialog open onOpenChange={() => {}} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    SHORTCUTS.forEach((shortcut) => {
      expect(screen.getByText(shortcut.description)).toBeInTheDocument();
    });
  });

  it('renders no dialog when closed', () => {
    render(<ShortcutsHelpDialog open={false} onOpenChange={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('AppShell keydown handler: Cmd/Ctrl+? opens the shortcuts help dialog', () => {
  beforeEach(() => {
    // `shortcutsHelpOpen`/`paletteOpen` live in the module-level uiStore
    // singleton, not component state, so they persist across tests within
    // this file (unlike `quickAddOpen`, which is local `useState` and resets
    // on every render) -- reset explicitly so one test's dialog being left
    // open can't masquerade as the next test's guard working correctly.
    useUiStore.setState({ shortcutsHelpOpen: false, paletteOpen: false });
    const doc = seededDoc();
    Object.defineProperty(window, 'electron', {
      writable: true,
      configurable: true,
      value: {
        settings: {
          read: jest.fn().mockResolvedValue({
            dataFilePath: '/tmp/seeded-kanban.json',
            recentFiles: [],
            activeBoardId: doc.boards[0].id,
          }),
          write: jest.fn().mockResolvedValue({}),
        },
        data: {
          read: jest.fn().mockResolvedValue({
            ok: true,
            value: JSON.stringify(doc),
          }),
          write: jest.fn().mockResolvedValue({ ok: true, value: null }),
          move: jest.fn(),
          pickOpen: jest.fn(),
          pickSave: jest.fn(),
          reveal: jest.fn(),
          defaultPath: jest.fn().mockResolvedValue('/tmp/seeded-kanban.json'),
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
  });

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    [
      'contenteditable div',
      () => {
        const div = document.createElement('div');
        div.setAttribute('contenteditable', 'true');
        return div;
      },
    ],
  ])(
    'ignores Cmd/Ctrl+? when the target is a %s',
    async (_label, makeTarget) => {
      render(<AppShell />);
      await screen.findByText('Backlog');

      const target = makeTarget();
      document.body.appendChild(target);

      const event = dispatchCmdQuestion(target);
      expect(event.defaultPrevented).toBe(false);
      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();

      document.body.removeChild(target);
    },
  );

  it.each(CMD_QUESTION_KEYSTROKES)(
    'opens the dialog and prevents default when pressed outside any input field on %s',
    async (_label, init) => {
      render(<AppShell />);
      await screen.findByText('Backlog');

      const plain = document.createElement('div');
      document.body.appendChild(plain);

      const event = dispatchCmdQuestion(plain, init);
      expect(event.defaultPrevented).toBe(true);
      expect(await screen.findByText('Keyboard Shortcuts')).toBeInTheDocument();

      document.body.removeChild(plain);
    },
  );

  it('does not stack on top of an already-open dialog (e.g. the command palette)', async () => {
    render(<AppShell />);
    await screen.findByText('Backlog');

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    act(() => {
      plain.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'k',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      await screen.findByPlaceholderText('Search all prompts'),
    ).toBeInTheDocument();

    dispatchCmdQuestion(plain);
    expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();

    document.body.removeChild(plain);
  });
});
