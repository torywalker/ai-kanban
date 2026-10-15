/**
 * Regression test for the FilterBar infinite-render-loop bug (final
 * whole-branch review, Fix 1).
 *
 * Every other test that touches AppShell either stops at the welcome
 * screen (App.test.tsx, via a `dataFilePath: null` settings stub) or
 * renders a bare, store-disconnected component (pasteAsCard.test.tsx). None
 * of them ever push the store all the way to `status: 'ready'` with a real
 * document, which is exactly the path that reaches FilterBar and its
 * `useDocStore` selector. That's why a crash-on-load bug survived 18 tasks
 * of task-scoped review: nothing ever loaded a board.
 *
 * This test seeds a realistic document (one board, one list, one card with
 * a tag -- tags matter, since the bug lived in tag-derivation code) and
 * boots `AppShell` all the way to the loaded board screen, then asserts:
 *   1. it renders without throwing, and
 *   2. `console.error` is never called with React's "Maximum update depth
 *      exceeded" (or similar) infinite-loop diagnostic.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { AppShell } from '@/components/shell/AppShell';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { EMPTY_USAGE_TOTALS } from '../shared/usage';

function seededDoc(): KanbanDoc {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    tags: {
      urgent: { color: '#d9534f', label: 'urgent' },
    },
    boards: [
      {
        id: 'brd_seed01',
        name: 'Prompts',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [
          {
            id: 'lst_seed01',
            name: 'Waiting',
            cards: [
              {
                id: 'crd_seed01',
                title: 'Summarize a doc',
                prompt: 'Summarize {{doc}} in three bullets.',
                tags: ['urgent'],
                notes: '',
                link: '',
                variables: {},
                copyCount: 0,
                lastCopiedAt: null,
                priority: 'critical',
                color: null,
                sessionTool: null,
                sessionRepo: null,
                sessionId: null,
                sessionModel: null,
                useWorktree: null,
                sessionWorktree: null,
                archived: false,
                attachments: [],
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
          { id: 'lst_seed02', name: 'In Flight', cards: [] },
          { id: 'lst_seed03', name: 'Done', cards: [] },
        ],
      },
    ],
  };
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
});

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

describe('AppShell with a loaded board', () => {
  it('renders the board, its list, and its tagged card without an infinite render loop or React errors', async () => {
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    render(<AppShell />);

    // Wait for the real load path (bootstrap -> openAt -> ready) to finish
    // and the board to actually render.
    expect(await screen.findByText('Summarize a doc')).toBeInTheDocument();
    expect(screen.getByText('Waiting')).toBeInTheDocument();
    // "urgent" renders both as a card tag badge and as a FilterBar filter
    // chip, so assert at least one instance rather than a unique match.
    expect(screen.getAllByText('urgent').length).toBeGreaterThan(0);

    // Give any runaway re-render loop a chance to manifest before we assert
    // on the console.error spy.
    await waitFor(() => {
      expect(screen.getByText('Summarize a doc')).toBeInTheDocument();
    });

    const messages = consoleErrorSpy.mock.calls
      .map((args) => args.map((a) => String(a)).join(' '))
      .join('\n');
    expect(messages).not.toMatch(/maximum update depth exceeded/i);
    expect(messages).not.toMatch(/too many re-renders/i);

    consoleErrorSpy.mockRestore();
  });
});
