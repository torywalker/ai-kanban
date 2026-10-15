/**
 * The brief's Step 5 verification (watch ~/Documents/ai-kanban/kanban.json's
 * mtime across an app launch) requires clicking through the welcome screen,
 * which is out of reach in this non-interactive environment. This test
 * exercises the same guarantee at the unit level: `startPersistence` must
 * not write when the store settles into a state whose serialized doc
 * already matches `savedSnapshot` (the load/create path), must debounce a
 * real change into exactly one write, and must skip writing again once the
 * document returns to a snapshot-equal state.
 */
import { useDocStore } from '../renderer/store/docStore';
import {
  startPersistence,
  flushPersistence,
  writeNow,
} from '../renderer/store/persistence';

function installElectronMock() {
  const write = jest.fn().mockResolvedValue({ ok: true, value: null });
  const read = jest.fn();
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
        read,
        write,
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn(), read: jest.fn() },
      shell: { openExternal: jest.fn() },
    },
  });
  return { write, read };
}

describe('persistence', () => {
  let write: jest.Mock;
  let read: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    ({ write, read } = installElectronMock());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not write when a freshly created doc settles with a matching savedSnapshot', async () => {
    const stop = startPersistence();
    await useDocStore.getState().createAt('/tmp/kanban.json');

    // The subscriber may have scheduled a debounce timer synchronously;
    // let it run to prove it never actually calls data.write again.
    jest.advanceTimersByTime(1000);

    // createAt itself calls api.data.write once to seed the file. The
    // persistence subscriber must not add a second call on top of that.
    expect(write).toHaveBeenCalledTimes(1);
    stop();
  });

  it('debounces a real mutation into exactly one write, then goes quiet', async () => {
    const stop = startPersistence();
    await useDocStore.getState().createAt('/tmp/kanban.json');
    write.mockClear();

    useDocStore.getState().addBoard('Second board');

    // Not yet — still inside the debounce window.
    jest.advanceTimersByTime(400);
    expect(write).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(1);

    // A further tick with no new change must stay quiet.
    write.mockClear();
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();

    stop();
  });

  it('flushPersistence writes an in-flight debounced change immediately and is a no-op afterward', async () => {
    const stop = startPersistence();
    await useDocStore.getState().createAt('/tmp/kanban.json');
    write.mockClear();

    useDocStore.getState().addBoard('Third board');
    await flushPersistence();

    expect(write).toHaveBeenCalledTimes(1);

    write.mockClear();
    await flushPersistence();
    expect(write).not.toHaveBeenCalled();

    stop();
  });

  it('writeNow writes even when the doc already matches savedSnapshot ("Keep mine")', async () => {
    const stop = startPersistence();
    await useDocStore.getState().createAt('/tmp/kanban.json');
    write.mockClear();

    // The store believes disk already matches (savedSnapshot === contents),
    // which is exactly the case flushPersistence would skip. writeNow must
    // write anyway, because disk has demonstrably diverged externally.
    await writeNow();

    expect(write).toHaveBeenCalledTimes(1);

    stop();
  });

  it('writeNow cancels a pending debounced write and still writes once', async () => {
    const stop = startPersistence();
    await useDocStore.getState().createAt('/tmp/kanban.json');
    write.mockClear();

    useDocStore.getState().addBoard('Fourth board');
    // Still inside the debounce window when "Keep mine" is clicked.
    await writeNow();
    expect(write).toHaveBeenCalledTimes(1);

    write.mockClear();
    // The debounce timer must have been cleared by writeNow, or this would
    // fire a second, redundant write.
    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();

    stop();
  });

  it('reload re-reads the file at the current path via openAt', async () => {
    const stop = startPersistence();
    await useDocStore.getState().createAt('/tmp/kanban.json');

    const doc = useDocStore.getState().doc;
    const externallyEdited = JSON.stringify({
      ...doc,
      boards: doc!.boards.map((b, i) =>
        i === 0 ? { ...b, name: 'Edited Externally' } : b,
      ),
    });
    read.mockResolvedValueOnce({ ok: true, value: externallyEdited });

    await useDocStore.getState().reload();

    expect(read).toHaveBeenCalledWith('/tmp/kanban.json');
    expect(useDocStore.getState().doc?.boards[0].name).toBe(
      'Edited Externally',
    );
    // reload goes through openAt, so history resets same as any fresh load.
    expect(useDocStore.getState().canUndo).toBe(false);

    stop();
  });

  it('reload is a no-op when there is no open file', async () => {
    useDocStore.setState({ filePath: null });
    await expect(useDocStore.getState().reload()).resolves.toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  /**
   * Regression guard for a real data-loss bug: `openAt` on a path that
   * already holds a real, valid document must NEVER write to it — only
   * a genuinely empty path (read returns `value: null`) may fall through
   * to `createAt`'s seed-and-write. `WelcomeScreen`'s buttons all route
   * through `openAt` specifically so this guarantee protects every entry
   * point that could touch a path a user actually cares about.
   */
  it('openAt loads an existing valid file WITHOUT ever writing to it', async () => {
    const existingDoc = JSON.stringify({
      version: 1,
      boards: [
        {
          id: 'brd_real',
          name: 'My Real Board',
          defaultRepo: null,
          archived: false,
          scratchpad: '',
          lists: [{ id: 'lst_1', name: 'Waiting', cards: [] }],
        },
      ],
      tags: {},
    });
    read.mockResolvedValueOnce({ ok: true, value: existingDoc });

    await useDocStore.getState().openAt('/Users/me/existing-board.json');

    expect(useDocStore.getState().doc?.boards[0].name).toBe('My Real Board');
    expect(write).not.toHaveBeenCalled();
  });

  it('openAt only seeds (and writes) a path that genuinely has nothing at it', async () => {
    read.mockResolvedValueOnce({ ok: true, value: null });

    await useDocStore.getState().openAt('/Users/me/brand-new.json');

    expect(write).toHaveBeenCalledTimes(1);
    expect(useDocStore.getState().filePath).toBe('/Users/me/brand-new.json');
  });
});
