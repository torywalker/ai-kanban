import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import {
  QUICK_ADD_ACCELERATOR,
  defaultQuickAddBoardId,
  insertNewCard,
  quickAddBoards,
  quickAddWindowOptions,
} from '@shared/quickAdd';

function doc(): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_archived',
        name: 'Old',
        archived: true,
        defaultRepo: null,
        scratchpad: '',
        lists: [{ id: 'lst_old', name: 'Backlog', cards: [] }],
      },
      {
        id: 'brd_empty',
        name: 'Empty',
        archived: false,
        defaultRepo: null,
        scratchpad: '',
        lists: [],
      },
      {
        id: 'brd_prompts',
        name: 'Prompts',
        archived: false,
        defaultRepo: null,
        scratchpad: '',
        lists: [
          { id: 'lst_backlog', name: 'Backlog', cards: [] },
          { id: 'lst_doing', name: 'Doing', cards: [] },
        ],
      },
      {
        id: 'brd_bugs',
        name: 'Bugs',
        archived: false,
        defaultRepo: null,
        scratchpad: '',
        lists: [{ id: 'lst_bugs', name: 'Inbox', cards: [] }],
      },
    ],
  };
}

describe('quick add targets', () => {
  it('offers visible boards that have a column, defaulting to the selected one', () => {
    const boards = quickAddBoards(doc());
    expect(boards.map((board) => board.name)).toEqual(['Prompts', 'Bugs']);
    expect(boards[0].listId).toBe('lst_backlog');
    expect(defaultQuickAddBoardId(boards, 'brd_bugs')).toBe('brd_bugs');
  });

  it('falls back to the first usable board when the selection is hidden or gone', () => {
    const boards = quickAddBoards(doc());
    expect(defaultQuickAddBoardId(boards, 'brd_archived')).toBe('brd_prompts');
    expect(defaultQuickAddBoardId(boards, null)).toBe('brd_prompts');
  });

  it('inserts the card on the chosen board’s first column and registers a new tag', () => {
    const result = insertNewCard(
      doc(),
      'brd_bugs',
      'lst_bugs',
      {
        id: 'crd_new',
        title: '  ',
        prompt: 'look here',
        tags: ['Needs review'],
      },
      '2026-10-29T00:00:00.000Z',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const list = result.doc.boards[3].lists[0];
    expect(list.cards).toHaveLength(1);
    expect(list.cards[0].id).toBe('crd_new');
    expect(list.cards[0].title).toBe('Untitled prompt');
    expect(list.cards[0].prompt).toBe('look here');
    expect(list.cards[0].tags).toEqual(['needs-review']);
    expect(result.doc.tags['needs-review']).toEqual({
      color: '#4f8ef7',
      label: 'needs-review',
    });
    expect(doc().boards[3].lists[0].cards).toHaveLength(0);
  });
});

describe('quick add window', () => {
  it('uses a floating panel shortcut that does not belong to the main window', () => {
    expect(QUICK_ADD_ACCELERATOR).toBe('CommandOrControl+Alt+N');
    const options = quickAddWindowOptions('darwin');
    expect(options.alwaysOnTop).toBe(true);
    expect(options.alwaysOnTopLevel).toBe('floating');
    expect(options.type).toBe('panel');
    expect(options.parent).toBeNull();
    expect(options.show).toBe(false);
    expect(quickAddWindowOptions('win32').type).toBeUndefined();
  });
});
