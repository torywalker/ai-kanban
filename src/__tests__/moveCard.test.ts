import { CURRENT_VERSION, type KanbanDoc } from '../shared/schema';
import { moveCardToBoard } from '../renderer/domain/moveCard';

function card(id: string) {
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
    sessionTool: null,
    sessionRepo: null,
    sessionId: null,
    sessionModel: null,
    useWorktree: null,
    sessionWorktree: null,
    archived: false,
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
        lists: [{ id: 'lst_c', name: 'C', cards: [card('c4')] }],
      },
    ],
  };
}

describe('moveCardToBoard', () => {
  it('removes the card from its source list and appends it to the destination list', () => {
    const next = moveCardToBoard(
      doc(),
      'brd_1',
      'lst_a',
      'c2',
      'brd_2',
      'lst_c',
    );

    const source = next.boards[0].lists[0];
    const destination = next.boards[1].lists[0];

    expect(source.cards.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(destination.cards.map((c) => c.id)).toEqual(['c4', 'c2']);
  });

  it('bumps updatedAt on the moved card', () => {
    const before = doc();
    const next = moveCardToBoard(
      before,
      'brd_1',
      'lst_a',
      'c2',
      'brd_2',
      'lst_c',
    );
    const moved = next.boards[1].lists[0].cards.find((c) => c.id === 'c2');

    expect(moved?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('leaves other cards on the source and destination lists untouched', () => {
    const next = moveCardToBoard(
      doc(),
      'brd_1',
      'lst_a',
      'c2',
      'brd_2',
      'lst_c',
    );

    expect(next.boards[0].lists[0].cards[0].updatedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(next.boards[1].lists[0].cards[0].updatedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('supports moving to a different list on the same board', () => {
    const next = moveCardToBoard(
      doc(),
      'brd_1',
      'lst_a',
      'c1',
      'brd_1',
      'lst_b',
    );

    expect(next.boards[0].lists[0].cards.map((c) => c.id)).toEqual([
      'c2',
      'c3',
    ]);
    expect(next.boards[0].lists[1].cards.map((c) => c.id)).toEqual(['c1']);
  });

  it('returns the same doc reference when the card does not exist', () => {
    const original = doc();
    const next = moveCardToBoard(
      original,
      'brd_1',
      'lst_a',
      'missing',
      'brd_2',
      'lst_c',
    );

    expect(next).toBe(original);
  });

  it('returns the same doc reference when the source list does not exist', () => {
    const original = doc();
    const next = moveCardToBoard(
      original,
      'brd_1',
      'missing_list',
      'c1',
      'brd_2',
      'lst_c',
    );

    expect(next).toBe(original);
  });

  it('returns the same doc reference when the destination board does not exist', () => {
    const original = doc();
    const next = moveCardToBoard(
      original,
      'brd_1',
      'lst_a',
      'c1',
      'missing_board',
      'lst_c',
    );

    expect(next).toBe(original);
  });

  it('returns the same doc reference when the destination list does not exist', () => {
    const original = doc();
    const next = moveCardToBoard(
      original,
      'brd_1',
      'lst_a',
      'c1',
      'brd_2',
      'missing_list',
    );

    expect(next).toBe(original);
  });
});
