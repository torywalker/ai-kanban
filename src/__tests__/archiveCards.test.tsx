import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { BoardView } from '@/components/board/BoardView';
import { ListColumn } from '@/components/board/ListColumn';
import { ListOptionsMenu } from '@/components/board/ListOptionsMenu';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { EMPTY_USAGE_TOTALS } from '../shared/usage';

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
}

function renderListColumn(boardId: string, listId: string) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="board" direction="horizontal" type="LIST">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ListColumn boardId={boardId} listId={listId} index={0} />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>,
  );
}

function renderListMenu(boardId: string, listId: string, listName: string) {
  return render(
    <ListOptionsMenu
      boardId={boardId}
      listId={listId}
      listName={listName}
    />,
  );
}

describe('archiving cards', () => {
  let boardId: string;
  let waitingId: string;
  let doneId: string;
  let waitingCard: string;
  let doneCard: string;

  beforeAll(() => {
    // Radix menus drive open/close off Pointer Events, which jsdom does not
    // implement. Without these the trigger's pointerdown handler throws.
    Element.prototype.hasPointerCapture = jest.fn(() => false);
    Element.prototype.setPointerCapture = jest.fn();
    Element.prototype.releasePointerCapture = jest.fn();
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(async () => {
    installElectronMock();
    useUiStore.setState({ showArchived: false });
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
      title: 'Keep me visible',
      prompt: 'live',
    });
    doneCard = useDocStore.getState().addCard(boardId, doneId, {
      title: 'Archive me',
      prompt: 'old',
    });
  });

  it('hides archived cards until the board reveal control is used', () => {
    useDocStore.getState().archiveCard(boardId, doneId, doneCard);
    render(<BoardView />);

    expect(screen.getByText('Keep me visible')).toBeInTheDocument();
    expect(screen.queryByText('Archive me')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show archived/i }));

    expect(screen.getByText('Archive me')).toBeInTheDocument();
  });

  it('asks the usage ledger only for unarchived card ids while archived cards are hidden', async () => {
    useDocStore.getState().archiveCard(boardId, doneId, doneCard);
    render(<BoardView />);

    await waitFor(() => {
      expect(window.electron.usage.boardTotals).toHaveBeenCalledWith([
        waitingCard,
      ]);
    });
  });

  it('includes archived card ids in the board total once they are revealed', async () => {
    useDocStore.getState().archiveCard(boardId, doneId, doneCard);
    render(<BoardView />);

    fireEvent.click(screen.getByRole('button', { name: /show archived/i }));

    await waitFor(() => {
      expect(window.electron.usage.boardTotals).toHaveBeenCalledWith(
        expect.arrayContaining([waitingCard, doneCard]),
      );
    });
  });

  it('archives a card from the edit dialog without deleting it', () => {
    const onOpenChange = jest.fn();
    render(
      <CardComposerDialog
        open
        onOpenChange={onOpenChange}
        boardId={boardId}
        listId={waitingId}
        cardId={waitingCard}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    const card = useDocStore
      .getState()
      .doc!.boards[0].lists[0].cards.find((c) => c.id === waitingCard);
    expect(card).toBeDefined();
    expect(card!.archived).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('archives every card in one column from the list menu, leaving other columns alone', () => {
    const extraWaiting = useDocStore.getState().addCard(boardId, waitingId, {
      title: 'Also waiting',
      prompt: 'live 2',
    });
    renderListMenu(boardId, waitingId, 'Waiting');

    const trigger = screen.getByRole('button', {
      name: /list options for waiting/i,
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive all cards' }));

    const waiting = useDocStore.getState().doc!.boards[0].lists[0].cards;
    const done = useDocStore.getState().doc!.boards[0].lists[2].cards;
    expect(waiting.find((c) => c.id === waitingCard)!.archived).toBe(true);
    expect(waiting.find((c) => c.id === extraWaiting)!.archived).toBe(true);
    expect(done.find((c) => c.id === doneCard)!.archived).toBe(false);
  });

  /**
   * A column left holding only archived cards is the state "Archive all
   * cards" produces, and it used to turn drag and drop off for the whole
   * column — including the drop target, so nothing could be moved back in.
   * `dragHandleProps` is null when a Draggable is disabled, so the absence
   * of that attribute is what the bug looked like in the DOM.
   */
  it('keeps cards draggable in a column holding hidden archived cards', () => {
    useDocStore.getState().archiveCard(boardId, waitingId, waitingCard);
    const stillVisible = useDocStore.getState().addCard(boardId, waitingId, {
      title: 'Still here',
      prompt: 'live 2',
    });

    const { container } = renderListColumn(boardId, waitingId);

    expect(screen.queryByText('Keep me visible')).not.toBeInTheDocument();
    expect(
      container.querySelector(
        `[data-rfd-drag-handle-draggable-id="${stillVisible}"]`,
      ),
    ).not.toBeNull();
  });
});
