/**
 * Two cards sharing an ID corrupt drag-and-drop: the drag library and React
 * both key cards by ID, so a duplicate renders as gaps, overlaps, and ghost
 * copies mid-drag. A file already carrying duplicates must load clean, and
 * the store must never create a new one.
 */
import fixture from './fixtures/kanban-v1.json';
import { parseDoc, type KanbanDoc } from '../shared/schema';
import { useDocStore } from '../renderer/store/docStore';

function docWithCards(
  waiting: Record<string, unknown>[],
  inFlight: Record<string, unknown>[],
): unknown {
  const doc = JSON.parse(JSON.stringify(fixture));
  doc.boards[0].lists[0].cards = waiting;
  doc.boards[0].lists[1].cards = inFlight;
  return doc;
}

function card(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: id,
    prompt: '',
    tags: [],
    createdAt: '2026-10-30T00:00:00.000Z',
    updatedAt: '2026-10-30T00:00:00.000Z',
    ...extra,
  };
}

function cardIds(doc: KanbanDoc): string[][] {
  return doc.boards[0].lists.map((list) => list.cards.map((c) => c.id));
}

describe('duplicate card IDs on load', () => {
  it('keeps the first copy of a card that appears twice in one list', () => {
    const result = parseDoc(
      docWithCards(
        [
          card('crd_a', { priority: 'high' }),
          card('crd_b'),
          card('crd_a', { title: 'stray copy' }),
        ],
        [],
      ),
    );
    if (!result.ok) throw new Error(result.error);
    expect(cardIds(result.doc)).toEqual([['crd_a', 'crd_b'], []]);
    expect(result.doc.boards[0].lists[0].cards[0].priority).toBe('high');
  });

  it('prefers the live copy over an archived one, across lists', () => {
    const result = parseDoc(
      docWithCards(
        [card('crd_a', { archived: true })],
        [card('crd_b'), card('crd_a')],
      ),
    );
    if (!result.ok) throw new Error(result.error);
    expect(cardIds(result.doc)).toEqual([[], ['crd_b', 'crd_a']]);
    expect(result.doc.boards[0].lists[1].cards[1].archived).toBe(false);
  });

  it('leaves a document without duplicates untouched', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    expect(cardIds(result.doc)).toEqual([['crd_g7h8i9'], []]);
  });
});

describe('addCard with an ID that already exists', () => {
  it('does not add a second card with the same ID', () => {
    const parsed = parseDoc(fixture);
    if (!parsed.ok) throw new Error(parsed.error);
    useDocStore.setState({ doc: parsed.doc, past: [], future: [] });

    useDocStore
      .getState()
      .addCard('brd_a1b2c3', 'lst_j0k1l2', { id: 'crd_g7h8i9', title: 'x', prompt: '' });

    const doc = useDocStore.getState().doc as KanbanDoc;
    expect(cardIds(doc)).toEqual([['crd_g7h8i9'], []]);
  });
});
