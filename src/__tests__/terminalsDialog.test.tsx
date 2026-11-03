/**
 * The terminals dialog: per-board tabs of plain login shells. Shells live in
 * the daemon, so these tests drive the bridge mock and the doc store.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TerminalsDialog } from '@/components/terminals/TerminalsDialog';
import { useDocStore } from '@/store/docStore';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { Terminal } from '../../.erb/mocks/xterm';

function board(id: string, terminals: { id: string; name: string }[]) {
  return {
    id,
    name: id,
    defaultRepo: id === 'brd_a' ? '/repo' : '/other',
    archived: false,
    scratchpad: '',
    terminals,
    lists: [],
  };
}

function load(boards: ReturnType<typeof board>[], activeBoardId = 'brd_a') {
  const doc: KanbanDoc = { version: CURRENT_VERSION, tags: {}, boards };
  useDocStore.setState({
    status: { kind: 'ready' },
    doc,
    filePath: '/tmp/t.json',
    activeBoardId,
    savedSnapshot: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
  });
}

let shellState: (id: string, alive: boolean, busy: boolean) => void;
let terminal: Record<string, jest.Mock>;

function install() {
  terminal = {
    startShell: jest.fn().mockResolvedValue(undefined),
    input: jest.fn(),
    resize: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
    attach: jest.fn().mockResolvedValue(undefined),
    onData: jest.fn(() => () => {}),
    onReplay: jest.fn(() => () => {}),
    onShellState: jest.fn((cb) => {
      shellState = cb;
      return () => {};
    }),
  };
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: { terminal, platform: 'darwin' },
  });
}

function key(init: {
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    ...init,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const TWO = [
  { id: 'trm_1', name: 'Terminal 1' },
  { id: 'trm_2', name: 'Terminal 2' },
];

function tabNames(): string[] {
  return screen
    .getAllByRole('tab', { hidden: true })
    .map((tab) => tab.textContent ?? '');
}

beforeAll(() => {
  global.ResizeObserver = jest.fn().mockImplementation(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  }));
});

beforeEach(() => {
  Terminal.instances = [];
  install();
  load([board('brd_a', TWO), board('brd_b', [{ id: 'trm_9', name: 'Other' }])]);
});

describe('TerminalsDialog', () => {
  it('starts a shell for every tab with the board repo as cwd', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);

    expect(terminal.startShell).toHaveBeenCalledWith({
      id: 'trm_1',
      cwd: '/repo',
      cols: 80,
      rows: 24,
    });
    expect(terminal.startShell).toHaveBeenCalledWith({
      id: 'trm_2',
      cwd: '/repo',
      cols: 80,
      rows: 24,
    });
    expect(terminal.attach).toHaveBeenCalledWith('trm_1');
    expect(terminal.attach).not.toHaveBeenCalledWith('trm_2');
  });

  it('an empty board gets Terminal 1 created on open', () => {
    load([board('brd_a', [])]);
    render(<TerminalsDialog open onOpenChange={() => {}} />);

    expect(useDocStore.getState().doc?.boards[0].terminals).toHaveLength(1);
    expect(tabNames()).toEqual(['Terminal 1']);
    expect(terminal.startShell).toHaveBeenCalledTimes(1);
  });

  it('⌘T while open adds and activates a new tab', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);

    const event = key({ key: 't', metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(tabNames()).toEqual(['Terminal 1', 'Terminal 2', 'Terminal 3']);
    const newId = useDocStore.getState().doc!.boards[0].terminals[2].id;
    expect(terminal.startShell).toHaveBeenCalledWith(
      expect.objectContaining({ id: newId }),
    );
    expect(terminal.attach).toHaveBeenLastCalledWith(newId);
  });

  it('⌘1 and ⌘2 switch tabs', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);

    key({ key: '2', metaKey: true });
    expect(terminal.attach).toHaveBeenLastCalledWith('trm_2');
    expect(screen.getByRole('tab', { name: 'Terminal 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    key({ key: '1', metaKey: true });
    expect(terminal.attach).toHaveBeenLastCalledWith('trm_1');
  });

  it('double-click rename commits on Enter, cancels on Esc, rejects blank', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);
    const names = () =>
      useDocStore.getState().doc!.boards[0].terminals.map((t) => t.name);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Terminal 1' }));
    let input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Build' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(names()).toEqual(['Build', 'Terminal 2']);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Build' }));
    input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Nope' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(names()).toEqual(['Build', 'Terminal 2']);

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Build' }));
    input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(names()).toEqual(['Build', 'Terminal 2']);
  });

  it('closing an idle tab closes immediately and calls terminal.close', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 2' }));

    expect(tabNames()).toEqual(['Terminal 1']);
    expect(terminal.close).toHaveBeenCalledWith('trm_2');
  });

  it('closing a busy tab asks first, and declining leaves it', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);
    act(() => shellState('trm_2', true, true));

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 2' }));
    expect(terminal.close).not.toHaveBeenCalled();
    expect(tabNames()).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(tabNames()).toHaveLength(2);
    expect(terminal.close).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close terminal' }));
    expect(tabNames()).toEqual(['Terminal 1']);
    expect(terminal.close).toHaveBeenCalledWith('trm_2');
  });

  it('⌘W hides the dialog and keeps the tabs and shells', () => {
    const onOpenChange = jest.fn();
    render(<TerminalsDialog open onOpenChange={onOpenChange} />);

    const event = key({ key: 'w', metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(terminal.close).not.toHaveBeenCalled();
  });

  it('Escape does not close the dialog', () => {
    const onOpenChange = jest.fn();
    render(<TerminalsDialog open onOpenChange={onOpenChange} />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('clicking the overlay hides it', async () => {
    const onOpenChange = jest.fn();
    render(<TerminalsDialog open onOpenChange={onOpenChange} />);
    // Radix arms its outside-click listener on the next tick.
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shellState alive:false respawns an existing tab, but not a closed one', () => {
    jest.useFakeTimers();
    render(<TerminalsDialog open onOpenChange={() => {}} />);
    terminal.startShell.mockClear();
    act(() => {
      jest.advanceTimersByTime(1500);
    });

    act(() => shellState('trm_2', false, false));
    jest.useRealTimers();
    expect(terminal.startShell).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'trm_2' }),
    );

    terminal.startShell.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 2' }));
    act(() => shellState('trm_2', false, false));
    expect(terminal.startShell).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'trm_2' }),
    );
  });

  it('closing the last tab leaves a fresh Terminal 1 and closes the old shell', () => {
    load([board('brd_a', [{ id: 'trm_1', name: 'Terminal 1' }])]);
    render(<TerminalsDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 1' }));

    expect(tabNames()).toEqual(['Terminal 1']);
    expect(useDocStore.getState().doc!.boards[0].terminals[0].id).not.toBe(
      'trm_1',
    );
    expect(terminal.close).toHaveBeenCalledWith('trm_1');
  });

  it('⌘9 past the last tab is swallowed', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);
    const event = key({ key: '9', metaKey: true });
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not respawn a shell that died at once, but does after a second', () => {
    jest.useFakeTimers();
    try {
      render(<TerminalsDialog open onOpenChange={() => {}} />);
      terminal.startShell.mockClear();

      act(() => shellState('trm_2', false, false));
      expect(terminal.startShell).not.toHaveBeenCalledWith(
        expect.objectContaining({ id: 'trm_2' }),
      );

      act(() => {
        jest.advanceTimersByTime(1500);
      });
      act(() => shellState('trm_2', false, false));
      expect(terminal.startShell).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'trm_2' }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('switching the active board swaps the tabs and starts the new shells', () => {
    render(<TerminalsDialog open onOpenChange={() => {}} />);
    terminal.startShell.mockClear();

    act(() => {
      useDocStore.setState({ activeBoardId: 'brd_b' });
    });

    expect(tabNames()).toEqual(['Other']);
    expect(terminal.startShell).toHaveBeenCalledWith({
      id: 'trm_9',
      cwd: '/other',
      cols: 80,
      rows: 24,
    });
  });

  it('tolerates a bridge without shell support', () => {
    Object.defineProperty(window, 'electron', {
      writable: true,
      configurable: true,
      value: {
        terminal: {
          attach: jest.fn().mockResolvedValue(undefined),
          resize: jest.fn(),
          onData: jest.fn(() => () => {}),
          onReplay: jest.fn(() => () => {}),
        },
      },
    });
    expect(() =>
      render(<TerminalsDialog open onOpenChange={() => {}} />),
    ).not.toThrow();
  });
});
