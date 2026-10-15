/**
 * Regression test for the final whole-branch review's C1: the reattach
 * effect never fired.
 *
 * AppShell's reattach effect used to read `useDocStore.getState().doc`
 * synchronously inside a `useEffect` with `[]` deps. At that moment
 * `bootstrap()` — fired by an earlier effect — is still awaiting IPC, so
 * `doc` was always null, the per-card walk iterated zero cards, and the `[]`
 * deps meant it never got a second chance. The entire "survives relaunch"
 * milestone was inert, and worse, the card would then offer a plain "Run"
 * that starts a SECOND concurrent session against a repo that already has
 * one running.
 *
 * The mocks below deliberately resolve on a LATER macrotask (`setTimeout`),
 * not synchronously: a synchronous mock would have let the old buggy code
 * pass, which is exactly how this survived nine task-scoped reviews.
 */
import '@testing-library/jest-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { EMPTY_USAGE_TOTALS } from '../shared/usage';

const CARD_WITH_SESSION = 'crd_live01';
const CARD_WITHOUT_SESSION = 'crd_idle01';
const PERSISTED_SESSION_ID = 'sess_from_last_launch';

function seededDoc(): KanbanDoc {
  const now = new Date().toISOString();
  const card = (id: string, title: string, sessionId: string | null) => ({
    id,
    title,
    prompt: 'Do the thing.',
    tags: [],
    notes: '',
    link: '',
    variables: {},
    copyCount: 0,
    lastCopiedAt: null,
    priority: null,
    color: null,
    sessionTool: sessionId ? ('claude' as const) : null,
    sessionRepo: '/tmp',
    sessionId,
    sessionModel: null,
    useWorktree: null,
    sessionWorktree: null,
    archived: false,
    attachments: [],
    createdAt: now,
    updatedAt: now,
  });

  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_seed01',
        name: 'Prompts',
        defaultRepo: '/tmp',
        archived: false,
        scratchpad: '',
        lists: [
          {
            id: 'lst_seed01',
            name: 'Waiting',
            cards: [
              card(
                CARD_WITH_SESSION,
                'Had a live session',
                PERSISTED_SESSION_ID,
              ),
              card(CARD_WITHOUT_SESSION, 'Never ran', null),
            ],
          },
          { id: 'lst_seed02', name: 'In Flight', cards: [] },
        ],
      },
    ],
  };
}

/**
 * Resolves on a later macrotask, so anything reading the store during the
 * mount pass genuinely sees `doc === null`.
 */
function laterResolved<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), 0);
  });
}

beforeAll(() => {
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
  const doc = seededDoc();
  useSessionStore.setState({ sessions: {} });
  useDocStore.setState({
    status: { kind: 'loading' },
    doc: null,
    filePath: null,
    activeBoardId: null,
    savedSnapshot: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
  });

  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn(() =>
          laterResolved({
            dataFilePath: '/tmp/seeded-kanban.json',
            recentFiles: [],
            activeBoardId: doc.boards[0].id,
          }),
        ),
        write: jest.fn(() => laterResolved({})),
      },
      data: {
        read: jest.fn(() =>
          laterResolved({ ok: true, value: JSON.stringify(doc) }),
        ),
        write: jest.fn(() => laterResolved({ ok: true, value: null })),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        pickFolder: jest.fn(),
        reveal: jest.fn(),
        defaultPath: jest.fn(() => laterResolved('/tmp/seeded-kanban.json')),
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

describe('C1: AppShell reattaches to live sessions once the document loads', () => {
  it('is genuinely racing an async bootstrap (no session call happens at mount)', () => {
    render(<AppShell />);
    // If this ever becomes non-empty synchronously, the mocks have stopped
    // reproducing the real async bootstrap and this whole file loses its
    // teeth.
    expect(useDocStore.getState().doc).toBeNull();
    expect(window.electron.session.getState).not.toHaveBeenCalled();
  });

  it('calls getState for every card that has a persisted session id', async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(window.electron.session.getState).toHaveBeenCalledWith(
        CARD_WITH_SESSION,
      );
    });
    expect(window.electron.session.getState).not.toHaveBeenCalledWith(
      CARD_WITHOUT_SESSION,
    );
  });

  it('applies the optimistic "Reconnecting" placeholder before the daemon answers', async () => {
    render(<AppShell />);

    await waitFor(() => {
      expect(
        useSessionStore.getState().sessions[CARD_WITH_SESSION],
      ).toBeDefined();
    });
    const snapshot = useSessionStore.getState().sessions[CARD_WITH_SESSION];
    expect(snapshot.sessionId).toBe(PERSISTED_SESSION_ID);
    // `interrupted`, not `failed`: nothing has actually gone wrong, this
    // daemon just doesn't have a live record for the card yet.
    expect(snapshot.status).toBe('interrupted');
    expect(snapshot.lastError).toMatch(/reconnect/i);
    expect(
      useSessionStore.getState().sessions[CARD_WITHOUT_SESSION],
    ).toBeUndefined();
  });

  it('walks the cards exactly once, not again on every later document change', async () => {
    render(<AppShell />);
    await waitFor(() => {
      expect(window.electron.session.getState).toHaveBeenCalledTimes(1);
    });
    // Wait for the board to actually be on screen, so the app is fully
    // settled before we mutate.
    expect(await screen.findByText('Had a live session')).toBeInTheDocument();

    const boardId = useDocStore.getState().doc!.boards[0].id;
    // Real document mutations, each producing a new `doc` reference — which
    // is exactly what the reattach effect now depends on. `act` flushes the
    // resulting re-render and effects.
    await act(async () => {
      useDocStore.getState().renameBoard(boardId, 'Renamed after load');
      useDocStore.getState().renameBoard(boardId, 'Renamed again');
    });
    await act(async () => {
      useDocStore
        .getState()
        .updateCard(
          boardId,
          useDocStore.getState().doc!.boards[0].lists[0].id,
          CARD_WITH_SESSION,
          { title: 'Edited title' },
        );
    });

    expect(useDocStore.getState().doc!.boards[0].name).toBe('Renamed again');
    expect(window.electron.session.getState).toHaveBeenCalledTimes(1);
  });

  /**
   * The "Reconnecting…" placeholder used to sit forever if the daemon (or
   * a fresh one with no memory of the card) never answered `getState` —
   * reading as "still in progress" indefinitely, with no way to tell it
   * had actually given up short of noticing the still-available "Run
   * again" button. A timeout resolves it to an honest failure message
   * instead, but must never clobber a real reply that arrives first.
   */
  describe('give-up timeout when the daemon never answers', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    /**
     * The bootstrap chain (`settings.read` -> `openAt` -> `data.read`, each
     * a `laterResolved` `setTimeout(0)`) is several macrotask hops deep
     * before the reattach effect ever fires. Advancing in small steps
     * until the placeholder actually lands is more robust than guessing
     * how many hops a single `advanceTimersByTimeAsync` call needs to
     * chase through.
     */
    async function flushUntilPlaceholderLands() {
      for (let i = 0; i < 20; i += 1) {
        if (useSessionStore.getState().sessions[CARD_WITH_SESSION]) return;
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await jest.advanceTimersByTimeAsync(10);
        });
      }
      throw new Error('placeholder never landed within the flush budget');
    }

    it('replaces the placeholder with an honest give-up message if nothing answers in time', async () => {
      render(<AppShell />);
      await flushUntilPlaceholderLands();

      expect(
        useSessionStore.getState().sessions[CARD_WITH_SESSION]?.lastError,
      ).toMatch(/reconnect/i);

      // getState's mock resolves but never triggers a real snapshot event
      // (no onSnapshot callback fires) — exactly the "daemon never
      // answered for this card" scenario.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(15_000);
      });

      const snapshot = useSessionStore.getState().sessions[CARD_WITH_SESSION];
      expect(snapshot.lastError).toMatch(/no record of the session/i);
      expect(snapshot.lastError).toMatch(/run again/i);
      // Nothing else about the snapshot should have changed — still
      // `interrupted`, never `failed`: a reply can still resume this.
      expect(snapshot.sessionId).toBe(PERSISTED_SESSION_ID);
      expect(snapshot.status).toBe('interrupted');
    });

    it('does not overwrite a real snapshot that arrived before the timeout', async () => {
      render(<AppShell />);
      await flushUntilPlaceholderLands();

      // A real snapshot arrives well before the give-up timeout fires —
      // the daemon survived and answered after all.
      await act(async () => {
        useSessionStore.getState().applySnapshot({
          cardId: CARD_WITH_SESSION,
          sessionId: PERSISTED_SESSION_ID,
          status: 'done',
          checklist: [],
          messages: [],
          pendingApproval: null,
          lastError: null,
        });
      });

      await act(async () => {
        await jest.advanceTimersByTimeAsync(15_000);
      });

      const snapshot = useSessionStore.getState().sessions[CARD_WITH_SESSION];
      expect(snapshot.status).toBe('done');
      expect(snapshot.lastError).toBeNull();
    });
  });
});
