import type { DropResult } from '@hello-pangea/dnd';
import { CURRENT_VERSION, type KanbanDoc } from '../shared/schema';
import {
  applyDragEnd,
  cardDropDestinationList,
  DND_TYPES,
} from '../renderer/domain/dragEnd';

function card(id: string, archived = false) {
  return {
    id,
    title: id,
    prompt: '',
    tags: [],
    notes: '',
    link: '',
    variables: {},
    copyCount: 0,
    lastCopiedAt: null,
    priority: null,
    color: null,
    dueDate: null,
    sessionTool: null,
    sessionRepo: null,
    sessionId: null,
    sessionModel: null,
    useWorktree: null,
    sessionWorktree: null,
    archived,
    attachments: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function doc(): KanbanDoc {
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
        lists: [
          {
            id: 'lst_a',
            name: 'A',
            cards: [card('c1'), card('c2'), card('c3')],
          },
          { id: 'lst_b', name: 'B', cards: [] },
        ],
      },
      {
        id: 'brd_2',
        name: 'Two',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [],
      },
    ],
  };
}

function drop(over: Partial<DropResult>): DropResult {
  return {
    draggableId: 'c1',
    type: DND_TYPES.card,
    reason: 'DROP',
    mode: 'FLUID',
    source: { droppableId: 'lst_a', index: 0 },
    destination: { droppableId: 'lst_a', index: 0 },
    combine: null,
    ...over,
  } as DropResult;
}

const titles = (d: KanbanDoc, listIndex: number) =>
  d.boards[0].lists[listIndex].cards.map((c) => c.id);

describe('applyDragEnd', () => {
  it('moves a card down within the same list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c1',
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_a', index: 2 },
      }),
      'brd_1',
    );
    // Not ['c2','c1','c3'] — that is the off-by-one an insert-before-remove
    // implementation produces.
    expect(titles(next, 0)).toEqual(['c2', 'c3', 'c1']);
  });

  it('moves a card up within the same list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c3',
        source: { droppableId: 'lst_a', index: 2 },
        destination: { droppableId: 'lst_a', index: 0 },
      }),
      'brd_1',
    );
    expect(titles(next, 0)).toEqual(['c3', 'c1', 'c2']);
  });

  it('moves a card to the front of another list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c2',
        source: { droppableId: 'lst_a', index: 1 },
        destination: { droppableId: 'lst_b', index: 0 },
      }),
      'brd_1',
    );
    expect(titles(next, 0)).toEqual(['c1', 'c3']);
    expect(titles(next, 1)).toEqual(['c2']);
  });

  it('moves a card into an empty list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c1',
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_b', index: 0 },
      }),
      'brd_1',
    );
    expect(titles(next, 1)).toEqual(['c1']);
  });

  it('reorders lists', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'lst_a',
        type: DND_TYPES.list,
        source: { droppableId: 'board', index: 0 },
        destination: { droppableId: 'board', index: 1 },
      }),
      'brd_1',
    );
    expect(next.boards[0].lists.map((l) => l.id)).toEqual(['lst_b', 'lst_a']);
  });

  it('reorders visible boards without moving an archived board between them', () => {
    const original = doc();
    original.boards.splice(1, 0, {
      id: 'brd_hidden',
      name: 'Hidden',
      defaultRepo: null,
      archived: true,
      scratchpad: '',
      lists: [],
    });
    const next = applyDragEnd(
      original,
      drop({
        draggableId: 'brd_1',
        type: DND_TYPES.board,
        source: { droppableId: 'sidebar', index: 0 },
        destination: { droppableId: 'sidebar', index: 1 },
      }),
      null,
    );
    // Sidebar showed One, then Two. Dragging One to the end leaves
    // Two, One, and the archived board stays in the slot between them.
    expect(next.boards.map((b) => b.id)).toEqual([
      'brd_2',
      'brd_hidden',
      'brd_1',
    ]);
  });

  it('reorders boards', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'brd_1',
        type: DND_TYPES.board,
        source: { droppableId: 'sidebar', index: 0 },
        destination: { droppableId: 'sidebar', index: 1 },
      }),
      null,
    );
    expect(next.boards.map((b) => b.id)).toEqual(['brd_2', 'brd_1']);
  });

  it('returns the identical document when dropped outside a target', () => {
    const original = doc();
    const next = applyDragEnd(original, drop({ destination: null }), 'brd_1');
    expect(next).toBe(original);
  });

  it('returns the identical document when dropped where it started', () => {
    const original = doc();
    const next = applyDragEnd(
      original,
      drop({
        source: { droppableId: 'lst_a', index: 1 },
        destination: { droppableId: 'lst_a', index: 1 },
      }),
      'brd_1',
    );
    expect(next).toBe(original);
  });
});

/**
 * Archived cards stay in `list.cards` but are not rendered, so the indices
 * the library reports are positions among the VISIBLE cards. Without this
 * translation an archived card sitting before the drop point silently
 * shifts the move by one, and a column whose cards are all archived — the
 * state "Archive all cards" leaves behind — cannot be dropped into at all.
 */
describe('applyDragEnd with archived cards hidden', () => {
  const archivedDoc = (): KanbanDoc => ({
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_1',
        name: 'One',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [
          {
            id: 'lst_a',
            name: 'A',
            // Visible: [c1, c2]
            cards: [card('gone', true), card('c1'), card('c2')],
          },
          // Visible: [] — every card archived, as "Archive all cards" leaves it.
          { id: 'lst_b', name: 'B', cards: [card('old', true)] },
        ],
      },
    ],
  });

  it('drops into a column whose every card is archived', () => {
    const next = applyDragEnd(
      archivedDoc(),
      drop({
        draggableId: 'c1',
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_b', index: 0 },
      }),
      'brd_1',
    );

    expect(titles(next, 0)).toEqual(['gone', 'c2']);
    expect(titles(next, 1)).toEqual(['old', 'c1']);
  });

  it('reads the source index as a position among visible cards', () => {
    // Visible index 1 is c2, not the archived card's neighbour.
    const next = applyDragEnd(
      archivedDoc(),
      drop({
        draggableId: 'c2',
        source: { droppableId: 'lst_a', index: 1 },
        destination: { droppableId: 'lst_b', index: 0 },
      }),
      'brd_1',
    );

    expect(titles(next, 0)).toEqual(['gone', 'c1']);
    expect(titles(next, 1)).toEqual(['old', 'c2']);
  });

  it('reorders within a list that has a hidden card before the drop point', () => {
    const next = applyDragEnd(
      archivedDoc(),
      drop({
        draggableId: 'c2',
        source: { droppableId: 'lst_a', index: 1 },
        destination: { droppableId: 'lst_a', index: 0 },
      }),
      'brd_1',
    );

    expect(titles(next, 0)).toEqual(['gone', 'c2', 'c1']);
  });

  it('uses raw indices once archived cards are revealed', () => {
    const next = applyDragEnd(
      archivedDoc(),
      drop({
        draggableId: 'gone',
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_a', index: 2 },
      }),
      'brd_1',
      { showArchived: true },
    );

    expect(titles(next, 0)).toEqual(['c1', 'c2', 'gone']);
  });
});

describe('cardDropDestinationList', () => {
  const board = () => doc().boards[0];

  it('returns the destination list when a card moves to another list', () => {
    const result = cardDropDestinationList(
      board(),
      drop({
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_b', index: 0 },
      }),
    );
    expect(result?.id).toBe('lst_b');
  });

  it('returns undefined for a same-list reorder', () => {
    const result = cardDropDestinationList(
      board(),
      drop({
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_a', index: 2 },
      }),
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when dropped outside any droppable', () => {
    const result = cardDropDestinationList(
      board(),
      drop({ destination: null }),
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined for a list reorder (not a card move)', () => {
    const result = cardDropDestinationList(
      board(),
      drop({
        draggableId: 'lst_a',
        type: DND_TYPES.list,
        source: { droppableId: 'board', index: 0 },
        destination: { droppableId: 'board', index: 1 },
      }),
    );
    expect(result).toBeUndefined();
  });
});
