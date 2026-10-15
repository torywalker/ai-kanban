/**
 * Each board keeps its own scratchpad. Typing updates that board immediately,
 * the file write waits on the existing persistence debounce, and the note
 * is not an undo checkpoint.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { BoardView } from '@/components/board/BoardView';
import { ScratchpadDialog } from '@/components/board/ScratchpadDialog';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { startPersistence } from '@/store/persistence';
import { CURRENT_VERSION, serializeDoc, type KanbanDoc } from '@shared/schema';
import { EMPTY_USAGE_TOTALS } from '../shared/usage';

function docWith(scratchpads: string[]): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: scratchpads.map((scratchpad, index) => ({
      id: `brd_${index}`,
      name: index === 0 ? 'Prompts' : 'Other',
      defaultRepo: null,
      archived: false,
      scratchpad,
      lists: [{ id: `lst_${index}`, name: 'Waiting', cards: [] }],
    })),
  };
}

function installElectronMock(doc: KanbanDoc) {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: '/tmp/scratch.json',
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
        defaultPath: jest.fn().mockResolvedValue('/tmp/scratch.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn(), read: jest.fn() },
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

function load(doc: KanbanDoc) {
  useDocStore.setState({
    status: { kind: 'ready' },
    doc,
    filePath: '/tmp/scratch.json',
    activeBoardId: doc.boards[0].id,
    savedSnapshot: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
  });
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
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

describe('board scratchpad', () => {
  beforeEach(() => {
    useUiStore.setState({
      scratchpadOpen: false,
      shortcutsHelpOpen: false,
      paletteOpen: false,
    });
    installElectronMock(docWith(['']));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps each board’s text and writes the file only after a pause', async () => {
    const doc = docWith(['', '']);
    load(doc);
    useDocStore.setState({ savedSnapshot: serializeDoc(doc) });
    const stop = startPersistence();
    const write = window.electron.data.write as jest.Mock;
    write.mockClear();
    jest.useFakeTimers();
    render(<ScratchpadDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Scratchpad' }), {
      target: { value: 'note one' },
    });

    expect(useDocStore.getState().doc?.boards[0].scratchpad).toBe('note one');
    expect(useDocStore.getState().doc?.boards[1].scratchpad).toBe('');
    expect(useDocStore.getState().canUndo).toBe(false);
    expect(write).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(400);
    });
    expect(write).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(200);
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0][1])).toContain('note one');
    stop();
  });

  it('shows the other board’s own text when that board becomes active', () => {
    load(docWith(['alpha', 'beta']));
    render(<ScratchpadDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue(
      'alpha',
    );

    act(() => {
      useDocStore.getState().setActiveBoard('brd_1');
    });

    expect(screen.getByRole('textbox', { name: 'Scratchpad' })).toHaveValue(
      'beta',
    );
    expect(useDocStore.getState().doc?.boards[0].scratchpad).toBe('alpha');
  });

  it('opens from the board button', () => {
    load(docWith(['']));
    render(<BoardView />);
    expect(screen.getByRole('button', { name: 'Show archived' })).toHaveClass(
      'border',
      'cursor-pointer',
    );
    expect(screen.getByRole('button', { name: 'Scratchpad' })).toHaveClass(
      'border',
      'cursor-pointer',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scratchpad' }));
    const box = screen.getByRole('textbox', { name: 'Scratchpad' });
    expect(box).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveClass('h-[85vh]', 'sm:max-w-6xl');
    expect(box).toHaveClass('flex-1');
    expect(
      screen.getByText('Notes for Prompts. Saved as you type.'),
    ).toBeInTheDocument();
  });

  it('keeps a scratchpad typed after the last undo checkpoint', async () => {
    await useDocStore.getState().createAt('/tmp/scratch.json');
    const boardId = useDocStore.getState().activeBoardId as string;
    useDocStore.getState().renameBoard(boardId, 'Renamed');
    useDocStore.getState().setBoardScratchpad(boardId, 'keep me');
    const history = useDocStore.getState().past.length;

    useDocStore.getState().setBoardScratchpad(boardId, 'keep me still');
    expect(useDocStore.getState().past.length).toBe(history);

    useDocStore.getState().undo();
    const board = useDocStore.getState().doc?.boards[0];
    expect(board?.name).not.toBe('Renamed');
    expect(board?.scratchpad).toBe('keep me still');
  });
});

describe('Cmd/Ctrl+Shift+P opens the scratchpad', () => {
  beforeEach(() => {
    useUiStore.setState({
      scratchpadOpen: false,
      shortcutsHelpOpen: false,
      paletteOpen: false,
      settingsOpen: false,
    });
    installElectronMock(docWith(['']));
  });

  it('opens on the macOS keystroke, where Shift is dropped from event.key', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: 'Scratchpad' });

    const target = document.createElement('div');
    document.body.appendChild(target);
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          code: 'KeyP',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      screen.getByRole('textbox', { name: 'Scratchpad' }),
    ).toBeInTheDocument();
    document.body.removeChild(target);
  });

  it('does not open from a plain Cmd+P or while typing in a field', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: 'Scratchpad' });

    const plain = document.createElement('div');
    document.body.appendChild(plain);
    act(() => {
      plain.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      screen.queryByRole('textbox', { name: 'Scratchpad' }),
    ).not.toBeInTheDocument();

    const field = document.createElement('textarea');
    document.body.appendChild(field);
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'p',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      screen.queryByRole('textbox', { name: 'Scratchpad' }),
    ).not.toBeInTheDocument();
    document.body.removeChild(plain);
    document.body.removeChild(field);
  });
});

describe('Cmd/Ctrl+Shift+S opens settings', () => {
  beforeEach(() => {
    useUiStore.setState({
      scratchpadOpen: false,
      shortcutsHelpOpen: false,
      paletteOpen: false,
      settingsOpen: false,
    });
    installElectronMock(docWith(['']));
  });

  it('opens on the macOS keystroke, where Shift is dropped from event.key', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: 'Scratchpad' });

    const target = document.createElement('div');
    document.body.appendChild(target);
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(
      screen.getByRole('heading', { name: 'Settings' }),
    ).toBeInTheDocument();
    document.body.removeChild(target);
  });

  it('does not open from a plain Cmd+S or while typing in a field', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: 'Scratchpad' });

    const plain = document.createElement('div');
    document.body.appendChild(plain);
    act(() => {
      plain.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      screen.queryByRole('heading', { name: 'Settings' }),
    ).not.toBeInTheDocument();

    const field = document.createElement('textarea');
    document.body.appendChild(field);
    act(() => {
      field.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          metaKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(
      screen.queryByRole('heading', { name: 'Settings' }),
    ).not.toBeInTheDocument();
    document.body.removeChild(plain);
    document.body.removeChild(field);
  });
});
