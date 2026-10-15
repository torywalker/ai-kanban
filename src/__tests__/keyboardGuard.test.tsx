/**
 * Committing the Task 16 reviewer's scratch-only jsdom test as a real,
 * checked-in test (final whole-branch review, Fix 7).
 *
 * AppShell's keydown handler intercepts Cmd+Z / Shift+Cmd+Z globally to
 * drive the app-level undo/redo store actions, but must NOT do so when the
 * event target is inside an `input`, `textarea`, or
 * `[contenteditable="true"]` element -- otherwise a user's native text-undo
 * (e.g. while editing a card title) would be hijacked by the app-level
 * history instead of the browser's own input undo.
 *
 * This test renders the real `AppShell` and dispatches real
 * `KeyboardEvent`s at different target elements, asserting:
 *   - targets inside input/textarea/contenteditable: neither `undo` nor
 *     `redo` is called, and the event's `defaultPrevented` stays `false`
 *     (so native input undo still fires).
 *   - targets elsewhere: `undo`/`redo` is called and `defaultPrevented`
 *     becomes `true`.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { useDocStore } from '@/store/docStore';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';

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
});

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
          sidebarCollapsed: false,
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

function dispatchCmdZ(
  target: HTMLElement,
  { shift = false }: { shift?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'z',
    metaKey: true,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchCmdB(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'b',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function dispatchCmdOptionArrow(
  target: HTMLElement,
  key: 'ArrowUp' | 'ArrowDown',
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function threeBoardDoc(): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_1',
        name: 'One',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [],
      },
      {
        id: 'brd_2',
        name: 'Two',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [],
      },
      {
        id: 'brd_3',
        name: 'Three',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [],
      },
    ],
  };
}

describe('AppShell keydown handler: input-field guard around app-level undo/redo', () => {
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
    'ignores Cmd+Z/Shift+Cmd+Z when the target is a %s, leaving native undo alone',
    async (_label, makeTarget) => {
      render(<AppShell />);
      // Let the bootstrap effect (async settings read -> welcome screen)
      // settle before dispatching keyboard events, so React state updates
      // from bootstrapping don't leak into this test as act() warnings.
      await screen.findByRole('button', { name: /use default location/i });
      const undoSpy = jest.spyOn(useDocStore.getState(), 'undo');
      const redoSpy = jest.spyOn(useDocStore.getState(), 'redo');

      const target = makeTarget();
      document.body.appendChild(target);

      const undoEvent = dispatchCmdZ(target);
      expect(undoSpy).not.toHaveBeenCalled();
      expect(undoEvent.defaultPrevented).toBe(false);

      const redoEvent = dispatchCmdZ(target, { shift: true });
      expect(redoSpy).not.toHaveBeenCalled();
      expect(redoEvent.defaultPrevented).toBe(false);

      document.body.removeChild(target);
      undoSpy.mockRestore();
      redoSpy.mockRestore();
    },
  );

  it('calls undo/redo and prevents default when the target is outside any input field', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: /use default location/i });
    const undoSpy = jest.spyOn(useDocStore.getState(), 'undo');
    const redoSpy = jest.spyOn(useDocStore.getState(), 'redo');

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    const undoEvent = dispatchCmdZ(plain);
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(undoEvent.defaultPrevented).toBe(true);

    const redoEvent = dispatchCmdZ(plain, { shift: true });
    expect(redoSpy).toHaveBeenCalledTimes(1);
    expect(redoEvent.defaultPrevented).toBe(true);

    document.body.removeChild(plain);
    undoSpy.mockRestore();
    redoSpy.mockRestore();
  });
});

describe('AppShell keydown handler: input-field guard around the sidebar-collapse shortcut', () => {
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
    'ignores Cmd/Ctrl+B when the target is a %s',
    async (_label, makeTarget) => {
      render(<AppShell />);
      await screen.findByRole('button', { name: /use default location/i });

      const target = makeTarget();
      document.body.appendChild(target);

      const before = useDocStore.getState().sidebarCollapsed;
      const event = dispatchCmdB(target);

      expect(useDocStore.getState().sidebarCollapsed).toBe(before);
      expect(event.defaultPrevented).toBe(false);

      document.body.removeChild(target);
    },
  );

  it('toggles the sidebar and prevents default when the target is outside any input field', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: /use default location/i });
    expect(useDocStore.getState().sidebarCollapsed).toBe(false);

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    const firstEvent = dispatchCmdB(plain);
    expect(useDocStore.getState().sidebarCollapsed).toBe(true);
    expect(firstEvent.defaultPrevented).toBe(true);

    const secondEvent = dispatchCmdB(plain);
    expect(useDocStore.getState().sidebarCollapsed).toBe(false);
    expect(secondEvent.defaultPrevented).toBe(true);

    document.body.removeChild(plain);
  });
});

describe('AppShell keydown handler: Cmd/Ctrl+Option+Up/Down cycles boards', () => {
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
    'ignores Cmd/Ctrl+Option+Up/Down when the target is a %s',
    async (_label, makeTarget) => {
      render(<AppShell />);
      await screen.findByRole('button', { name: /use default location/i });
      useDocStore.setState({ doc: threeBoardDoc(), activeBoardId: 'brd_1' });

      const target = makeTarget();
      document.body.appendChild(target);

      const event = dispatchCmdOptionArrow(target, 'ArrowDown');

      expect(useDocStore.getState().activeBoardId).toBe('brd_1');
      expect(event.defaultPrevented).toBe(false);

      document.body.removeChild(target);
    },
  );

  it('moves to the next board on Cmd/Ctrl+Option+Down and wraps from the last to the first', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: /use default location/i });
    useDocStore.setState({ doc: threeBoardDoc(), activeBoardId: 'brd_1' });

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    const firstEvent = dispatchCmdOptionArrow(plain, 'ArrowDown');
    expect(useDocStore.getState().activeBoardId).toBe('brd_2');
    expect(firstEvent.defaultPrevented).toBe(true);

    dispatchCmdOptionArrow(plain, 'ArrowDown');
    expect(useDocStore.getState().activeBoardId).toBe('brd_3');

    dispatchCmdOptionArrow(plain, 'ArrowDown');
    expect(useDocStore.getState().activeBoardId).toBe('brd_1');

    document.body.removeChild(plain);
  });

  it('moves to the previous board on Cmd/Ctrl+Option+Up and wraps from the first to the last', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: /use default location/i });
    useDocStore.setState({ doc: threeBoardDoc(), activeBoardId: 'brd_1' });

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    const event = dispatchCmdOptionArrow(plain, 'ArrowUp');
    expect(useDocStore.getState().activeBoardId).toBe('brd_3');
    expect(event.defaultPrevented).toBe(true);

    document.body.removeChild(plain);
  });

  it('does nothing when there are no boards', async () => {
    render(<AppShell />);
    await screen.findByRole('button', { name: /use default location/i });
    useDocStore.setState({
      doc: { version: CURRENT_VERSION, tags: {}, boards: [] },
      activeBoardId: null,
    });

    const plain = document.createElement('div');
    document.body.appendChild(plain);

    expect(() => dispatchCmdOptionArrow(plain, 'ArrowDown')).not.toThrow();
    expect(useDocStore.getState().activeBoardId).toBeNull();

    document.body.removeChild(plain);
  });
});
