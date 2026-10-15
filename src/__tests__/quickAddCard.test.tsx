/**
 * TDD tests for the Cmd/Ctrl+N "quick add card" shortcut: it should open
 * CardComposerDialog targeting the left-most column of the currently active
 * board, mirroring the existing Cmd+Z (undo/redo, AppShell.tsx) and Cmd+K
 * (command palette, CommandPalette.tsx) keydown handlers already wired up
 * the same way -- a renderer-level `window.addEventListener('keydown', ...)`
 * with the same input/textarea/contenteditable guard as Cmd+Z.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { useDocStore } from '@/store/docStore';
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
        lists: [
          { id: 'lst_left', name: 'Backlog', cards: [] },
          { id: 'lst_right', name: 'Doing', cards: [] },
        ],
      },
    ],
  };
}

// cmdk (the command palette's underlying list component) observes element
// size via ResizeObserver, which jsdom does not implement -- mirrors the
// existing stub in cardViewDialogTags.test.tsx.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function dispatchCmdN(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'n',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  // The real handler may call React's setQuickAddOpen synchronously, so this
  // dispatch is wrapped in act() the same way a fireEvent click would be.
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

describe('Cmd/Ctrl+N: quick-add card shortcut, board loaded', () => {
  beforeEach(() => {
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
          run: jest.fn().mockResolvedValue(undefined),
          reply: jest.fn().mockResolvedValue(undefined),
          approve: jest.fn().mockResolvedValue(undefined),
          stop: jest.fn().mockResolvedValue(undefined),
          getState: jest.fn().mockResolvedValue(undefined),
          onSnapshot: jest.fn().mockReturnValue(() => {}),
        },
        usage: {
          cardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
          boardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
        },
      },
    });
  });

  it('opens the create-card dialog and adds the new card to the left-most column', async () => {
    render(<AppShell />);
    await screen.findByText('Backlog');

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    const event = dispatchCmdN(plain);
    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByText('New prompt')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Quick card' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add prompt/i }));

    const doc = useDocStore.getState().doc as KanbanDoc;
    expect(doc.boards[0].lists[0].cards.map((c) => c.title)).toContain(
      'Quick card',
    );
    expect(doc.boards[0].lists[1].cards).toHaveLength(0);

    document.body.removeChild(plain);
  });

  it('ignores the shortcut while typing in an input, textarea, or contenteditable element', async () => {
    render(<AppShell />);
    await screen.findByText('Backlog');

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = dispatchCmdN(input);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByText('New prompt')).not.toBeInTheDocument();

    document.body.removeChild(input);
  });

  // Code-review finding (Important #1): ListColumn gives every column,
  // including the left-most one, its own independent CardComposerDialog
  // instance behind its "Add prompt" button. Before this test, Cmd+N had no
  // visibility into that column-local open state, so pressing it while a
  // column's own composer was already open stacked a SECOND, independent
  // create-mode dialog on top -- unlike the deliberately-accepted stacking
  // case (CardComposerDialog nested inside CardViewDialog for editing one
  // specific card), this is two sibling create dialogs for the same list,
  // which was never a considered trade-off.
  it('does not stack a second dialog when the left-most column already has its own composer open', async () => {
    render(<AppShell />);
    // Waited for by text rather than captured as a node reference: the
    // board's Draggable/Droppable columns (@hello-pangea/dnd) do an extra
    // registration pass shortly after first mount, which can replace this
    // subtree's DOM nodes. Re-querying fresh at each step (instead of
    // holding a `within(...)` scoped node across an `await`) avoids acting
    // on a detached node, whose click would never reach React's listeners.
    await screen.findByText('Backlog');

    // Backlog is `board.lists[0]` in the seeded doc, so its "Add prompt"
    // button is the first of the two rendered (one per column).
    fireEvent.click(screen.getAllByRole('button', { name: /add prompt/i })[0]);
    expect(await screen.findAllByText('New prompt')).toHaveLength(1);

    const plain = document.createElement('div');
    document.body.appendChild(plain);
    dispatchCmdN(plain);

    expect(screen.getAllByText('New prompt')).toHaveLength(1);

    document.body.removeChild(plain);
  });

  // Code-review finding (Important #2): the command-palette-open guard had
  // no test in either direction. Cmd+K opens CommandPalette's own Radix
  // dialog; Cmd+N pressed while it's open must not stack a create dialog on
  // top of it (and must leave the palette itself alone).
  it('ignores the shortcut while the command palette is open', async () => {
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

    dispatchCmdN(plain);
    expect(screen.queryByText('New prompt')).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Search all prompts'),
    ).toBeInTheDocument();

    document.body.removeChild(plain);
  });
});

describe('Cmd/Ctrl+N: active board with zero lists', () => {
  beforeEach(() => {
    const doc: KanbanDoc = {
      version: CURRENT_VERSION,
      tags: {},
      boards: [
        {
          id: 'brd_empty01',
          name: 'Empty board',
          defaultRepo: null,
          archived: false,
          scratchpad: '',
          lists: [],
        },
      ],
    };
    Object.defineProperty(window, 'electron', {
      writable: true,
      configurable: true,
      value: {
        settings: {
          read: jest.fn().mockResolvedValue({
            dataFilePath: '/tmp/empty-kanban.json',
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
          defaultPath: jest.fn().mockResolvedValue('/tmp/empty-kanban.json'),
          onChanged: jest.fn().mockReturnValue(() => {}),
        },
        clipboard: { write: jest.fn() },
        shell: { openExternal: jest.fn() },
        session: {
          run: jest.fn().mockResolvedValue(undefined),
          reply: jest.fn().mockResolvedValue(undefined),
          approve: jest.fn().mockResolvedValue(undefined),
          stop: jest.fn().mockResolvedValue(undefined),
          getState: jest.fn().mockResolvedValue(undefined),
          onSnapshot: jest.fn().mockReturnValue(() => {}),
        },
        usage: {
          cardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
          boardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS),
        },
      },
    });
  });

  it('does nothing (no crash, no dialog) when the active board has no columns to target', async () => {
    render(<AppShell />);
    await screen.findAllByText('Empty board');

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    expect(() => dispatchCmdN(plain)).not.toThrow();
    expect(screen.queryByText('New prompt')).not.toBeInTheDocument();

    document.body.removeChild(plain);
  });
});

describe('Cmd/Ctrl+N: no active board loaded (welcome screen)', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electron', {
      writable: true,
      configurable: true,
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

  it('does nothing (no crash, no dialog) when there is no active board', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: /use default location/i });

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    expect(() => dispatchCmdN(plain)).not.toThrow();
    expect(screen.queryByText('New prompt')).not.toBeInTheDocument();

    document.body.removeChild(plain);
  });
});
