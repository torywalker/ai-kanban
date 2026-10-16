import { selectSessionCardIds } from '@/store/selectors';
import type { useDocStore } from '@/store/docStore';
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';

type State = ReturnType<typeof useDocStore.getState>;

function card(id: string, sessionId: string | null) {
  const now = new Date().toISOString();
  return {
    id,
    title: id,
    prompt: 'Do the thing.',
    tags: [],
    notes: '',
    link: '',
    variables: {},
    copyCount: 0,
    lastCopiedAt: null,
    priority: null,
    color: null,
    dueDate: null,
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
  };
}

function docWith(cards: ReturnType<typeof card>[][]): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd1',
        name: 'Board',
        defaultRepo: '/tmp',
        archived: false,
        scratchpad: '',
        lists: cards.map((listCards, i) => ({
          id: `lst${i}`,
          name: `List ${i}`,
          cards: listCards,
        })),
      },
    ],
  };
}

describe('selectSessionCardIds', () => {
  it('returns cardId/sessionId pairs for every card with a sessionId, across every board and list', () => {
    const doc = docWith([
      [card('crd_a', 'sess_a'), card('crd_b', null)],
      [card('crd_c', 'sess_c')],
    ]);

    const state = { doc } as State;

    expect(selectSessionCardIds(state)).toEqual([
      { cardId: 'crd_a', sessionId: 'sess_a' },
      { cardId: 'crd_c', sessionId: 'sess_c' },
    ]);
  });

  it('returns an empty array when there is no document loaded yet', () => {
    const state = { doc: null } as State;

    expect(selectSessionCardIds(state)).toEqual([]);
  });
});
