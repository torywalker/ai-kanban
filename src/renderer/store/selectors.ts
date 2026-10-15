import type { Board, List } from '@shared/schema';
import type { useDocStore } from './docStore';

type State = ReturnType<typeof useDocStore.getState>;

export const selectActiveBoard = (state: State): Board | null => {
  const board =
    state.doc?.boards.find((b) => b.id === state.activeBoardId) ?? null;
  // An archived board stays in the document, but the board view should
  // show the empty state rather than a board the sidebar no longer lists.
  if (!board || board.archived) return null;
  return board;
};

const NO_BOARD_IDS: string[] = [];

export const selectBoardIds = (state: State): string[] =>
  state.doc?.boards.map((b) => b.id) ?? NO_BOARD_IDS;

/**
 * Boards the sidebar, board switcher, and move dialog actually offer.
 * String ids, so `useShallow` can keep the snapshot stable. Subscribe with
 * `useShallow` — a bare hook would see a new array on every read.
 */
export const selectVisibleBoardIds = (state: State): string[] => {
  if (!state.doc) return NO_BOARD_IDS;
  const ids = state.doc.boards.filter((b) => !b.archived).map((b) => b.id);
  return ids.length === 0 ? NO_BOARD_IDS : ids;
};

export const selectBoardName =
  (boardId: string) =>
  (state: State): string =>
    state.doc?.boards.find((b) => b.id === boardId)?.name ?? '';

export const selectList =
  (boardId: string, listId: string) =>
  (state: State): List | null =>
    state.doc?.boards
      .find((b) => b.id === boardId)
      ?.lists.find((l) => l.id === listId) ?? null;

/**
 * A missing board has to hand back the same array every time. `useShallow`
 * (and React's `useSyncExternalStore`) treats a freshly allocated result as
 * a store change and re-renders until it hits "Maximum update depth".
 */
const NO_LISTS: List[] = [];

/**
 * Every list on a board, in board order. The array is the one already stored
 * on the board — not a mapped copy — for the same reason `NO_LISTS` is a
 * constant: a picker that subscribed to `{ id, name }` objects allocated on
 * each read looped on every card as soon as a second board existed.
 */
export const selectBoardLists =
  (boardId: string) =>
  (state: State): List[] =>
    state.doc?.boards.find((b) => b.id === boardId)?.lists ?? NO_LISTS;

/**
 * Every card, across every board and list, that has ever had a session
 * started on it — the same walk AppShell's reattach effect used to do
 * inline, now shared with the manual "Restart Daemon" action in
 * SettingsDialog so both can hand the result to `reattachSessions`.
 */
export const selectSessionCardIds = (
  state: State,
): { cardId: string; sessionId: string }[] => {
  const result: { cardId: string; sessionId: string }[] = [];
  state.doc?.boards.forEach((board) =>
    board.lists.forEach((list) =>
      list.cards.forEach((card) => {
        if (card.sessionId) {
          result.push({ cardId: card.id, sessionId: card.sessionId });
        }
      }),
    ),
  );
  return result;
};
