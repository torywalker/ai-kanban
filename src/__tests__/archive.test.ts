import { boardUsageCardIds } from '../renderer/domain/archive';
import type { Board } from '../shared/schema';
import { useDocStore } from '../renderer/store/docStore';

function installElectronMock() {
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
        read: jest.fn(),
        write: jest.fn().mockResolvedValue({ ok: true, value: null }),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        pickFolder: jest.fn().mockResolvedValue(null),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn() },
      shell: { openExternal: jest.fn() },
    },
  });
}

function boardOf(lists: Board['lists']): Board {
  return {
    id: 'brd_1',
    name: 'Board',
    defaultRepo: null,
    archived: false,
    scratchpad: '',
    lists,
  };
}

function usageBoard() {
  return boardOf([
    {
      id: 'lst_a',
      name: 'Waiting',
      cards: [
        {
          id: 'crd_live',
          title: 'Live',
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
          archived: false,
          attachments: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'crd_done',
          title: 'Done',
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
          archived: true,
          attachments: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ]);
}

describe('boardUsageCardIds', () => {
  it('omits archived cards when they are hidden from the board', () => {
    expect(boardUsageCardIds(usageBoard(), false)).toEqual(['crd_live']);
  });

  it('includes archived cards when they are shown, so their spend is in the total', () => {
    expect(boardUsageCardIds(usageBoard(), true)).toEqual([
      'crd_live',
      'crd_done',
    ]);
  });
});

describe('docStore archive', () => {
  let boardId: string;
  let waitingId: string;
  let doneId: string;
  let waitingCard: string;
  let doneCard: string;

  beforeEach(async () => {
    installElectronMock();
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    waitingId = doc.boards[0].lists[0].id;
    doneId = doc.boards[0].lists[2].id;
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists.forEach((list) => {
        list.cards = [];
      });
    });
    waitingCard = useDocStore.getState().addCard(boardId, waitingId, {
      title: 'Waiting card',
      prompt: 'wait',
    });
    doneCard = useDocStore.getState().addCard(boardId, doneId, {
      title: 'Done card',
      prompt: 'done',
    });
  });

  it('new cards start unarchived', () => {
    const card = useDocStore
      .getState()
      .doc!.boards[0].lists[0].cards.find((c) => c.id === waitingCard)!;
    expect(card.archived).toBe(false);
  });

  it('archiveCard keeps the card in its list but marks it archived', () => {
    useDocStore.getState().archiveCard(boardId, waitingId, waitingCard);
    const list = useDocStore.getState().doc!.boards[0].lists[0];
    const card = list.cards.find((c) => c.id === waitingCard);
    expect(card).toBeDefined();
    expect(card!.archived).toBe(true);
  });

  it('unarchiveCard restores a card to the board', () => {
    useDocStore.getState().archiveCard(boardId, waitingId, waitingCard);
    useDocStore.getState().unarchiveCard(boardId, waitingId, waitingCard);
    expect(
      useDocStore
        .getState()
        .doc!.boards[0].lists[0].cards.find((c) => c.id === waitingCard)!
        .archived,
    ).toBe(false);
  });

  it('archiveAllCardsInList archives every card in that list only', () => {
    const extraWaiting = useDocStore.getState().addCard(boardId, waitingId, {
      title: 'Second waiting',
      prompt: 'wait 2',
    });

    useDocStore.getState().archiveAllCardsInList(boardId, waitingId);

    const waiting = useDocStore.getState().doc!.boards[0].lists[0].cards;
    const done = useDocStore.getState().doc!.boards[0].lists[2].cards;
    expect(waiting.find((c) => c.id === waitingCard)!.archived).toBe(true);
    expect(waiting.find((c) => c.id === extraWaiting)!.archived).toBe(true);
    expect(done.find((c) => c.id === doneCard)!.archived).toBe(false);
  });
});
