import { produce } from 'immer';
import type { DropResult } from '@hello-pangea/dnd';
import type { Board, Card, KanbanDoc } from '@shared/schema';

export const DND_TYPES = {
  board: 'BOARD',
  list: 'LIST',
  card: 'CARD',
} as const;

/**
 * The list a card was actually moved INTO by this drop, or `undefined` when
 * the drop wasn't a card changing lists (a list/board reorder, a drop
 * outside any droppable, or a same-list reorder). Callers that only care
 * about a card landing in a new column — e.g. triggering a celebration
 * effect — can use this without duplicating `applyDragEnd`'s own checks.
 */
export function cardDropDestinationList(
  board: Board,
  result: DropResult,
): Board['lists'][number] | undefined {
  const { type, source, destination } = result;
  if (type !== DND_TYPES.card) return undefined;
  if (!destination) return undefined;
  if (destination.droppableId === source.droppableId) return undefined;
  return board.lists.find((list) => list.id === destination.droppableId);
}

export interface DragOptions {
  /** Whether archived cards are currently rendered. See `visibleIndices`. */
  showArchived?: boolean;
}

/**
 * The positions in `cards` that the board actually renders, in render order.
 *
 * The library reports source/destination indices in terms of the Draggables
 * it can see, so with archived cards hidden those indices are positions in
 * this array rather than in `cards` itself.
 */
function visibleIndices(cards: Card[], showArchived: boolean): number[] {
  const indices: number[] = [];
  cards.forEach((card, index) => {
    if (showArchived || !card.archived) indices.push(index);
  });
  return indices;
}

/**
 * Sidebar rows are the unarchived boards only, so a board drag's indices
 * are positions in that shorter list. Archived boards stay in `doc.boards`
 * and must not be what those indices point at.
 */
function visibleBoardIndices(boards: Board[]): number[] {
  const indices: number[] = [];
  boards.forEach((board, index) => {
    if (!board.archived) indices.push(index);
  });
  return indices;
}

export function applyDragEnd(
  doc: KanbanDoc,
  result: DropResult,
  activeBoardId: string | null,
  options: DragOptions = {},
): KanbanDoc {
  const { type, source, destination } = result;
  const showArchived = options.showArchived ?? false;

  // Dropped outside any droppable.
  if (!destination) return doc;

  // Dropped exactly where it started.
  if (
    source.droppableId === destination.droppableId &&
    source.index === destination.index
  ) {
    return doc;
  }

  return produce(doc, (draft) => {
    if (type === DND_TYPES.board) {
      // Reorder the visible boards inside the slots they already occupy,
      // so an archived board sitting between them stays put.
      const slots = visibleBoardIndices(draft.boards);
      if (slots[source.index] === undefined) return;
      const visible = slots.map((index) => draft.boards[index]);
      const [moved] = visible.splice(source.index, 1);
      if (!moved) return;
      visible.splice(destination.index, 0, moved);
      slots.forEach((slot, index) => {
        draft.boards[slot] = visible[index];
      });
      return;
    }

    const board = draft.boards.find((b) => b.id === activeBoardId);
    if (!board) return;

    if (type === DND_TYPES.list) {
      const [moved] = board.lists.splice(source.index, 1);
      if (moved) board.lists.splice(destination.index, 0, moved);
      return;
    }

    const from = board.lists.find((l) => l.id === source.droppableId);
    const to = board.lists.find((l) => l.id === destination.droppableId);
    if (!from || !to) return;

    const fromIndex = visibleIndices(from.cards, showArchived)[source.index];
    if (fromIndex === undefined) return;

    // Remove first, then insert at the destination. The library reports
    // destination.index relative to the list AFTER removal, so this order is
    // required for same-list moves to land correctly.
    const [moved] = from.cards.splice(fromIndex, 1);
    if (!moved) return;

    // Past the last visible card means the end of the list, which puts the
    // card after any trailing archived ones rather than in front of them.
    const toIndex =
      visibleIndices(to.cards, showArchived)[destination.index] ??
      to.cards.length;
    to.cards.splice(toIndex, 0, moved);
  });
}
