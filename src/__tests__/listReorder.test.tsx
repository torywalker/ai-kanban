/**
 * Lists can be created, but they used to be stuck at the end of the board.
 * The column header's drag handle wrapped the rename button — a nested
 * button — so dragging a list never actually started. Reordering is now a
 * dedicated handle plus Move left/right in the list menu.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { ListColumn } from '@/components/board/ListColumn';
import { ListOptionsMenu } from '@/components/board/ListOptionsMenu';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { installElectronMock } from '../testUtils/electronMock';

function renderListColumn(boardId: string, listId: string, index: number) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="board" direction="horizontal" type="LIST">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ListColumn boardId={boardId} listId={listId} index={index} />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>,
  );
}

function openListMenu(listName: string) {
  const trigger = screen.getByRole('button', {
    name: `List options for ${listName}`,
  });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
}

describe('reordering lists', () => {
  let boardId: string;
  let firstId: string;
  let secondId: string;
  let thirdId: string;

  beforeEach(async () => {
    installElectronMock();
    useUiStore.setState({ filter: { text: '', tags: [] } });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists = [];
    });
    firstId = useDocStore.getState().addList(boardId, 'First');
    secondId = useDocStore.getState().addList(boardId, 'Second');
    thirdId = useDocStore.getState().addList(boardId, 'Third');
  });

  const listIds = () =>
    useDocStore.getState().doc!.boards[0].lists.map((list) => list.id);

  it('exposes a reorder handle that is not the rename button', () => {
    renderListColumn(boardId, secondId, 1);

    const handle = screen.getByRole('button', { name: 'Reorder list Second' });
    const rename = screen.getByRole('button', {
      name: 'Rename list name for Second',
    });
    expect(handle).not.toBe(rename);
    expect(handle).toHaveAttribute(
      'data-rfd-drag-handle-draggable-id',
      secondId,
    );
  });

  it('moves a list right from the options menu', () => {
    render(
      <ListOptionsMenu boardId={boardId} listId={firstId} listName="First" />,
    );
    openListMenu('First');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move right' }));

    expect(listIds()).toEqual([secondId, firstId, thirdId]);
  });

  it('moves a list left from the options menu', () => {
    render(
      <ListOptionsMenu boardId={boardId} listId={thirdId} listName="Third" />,
    );
    openListMenu('Third');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move left' }));

    expect(listIds()).toEqual([firstId, thirdId, secondId]);
  });

  it('disables Move left on the first list', () => {
    render(
      <ListOptionsMenu boardId={boardId} listId={firstId} listName="First" />,
    );
    openListMenu('First');
    expect(screen.getByRole('menuitem', { name: 'Move left' })).toHaveAttribute(
      'data-disabled',
    );
    expect(
      screen.getByRole('menuitem', { name: 'Move right' }),
    ).not.toHaveAttribute('data-disabled');
  });

  it('disables Move right on the last list', () => {
    render(
      <ListOptionsMenu boardId={boardId} listId={thirdId} listName="Third" />,
    );
    openListMenu('Third');
    expect(
      screen.getByRole('menuitem', { name: 'Move right' }),
    ).toHaveAttribute('data-disabled');
    expect(
      screen.getByRole('menuitem', { name: 'Move left' }),
    ).not.toHaveAttribute('data-disabled');
  });

  it('keeps the list draggable while a card filter is active', () => {
    useUiStore.setState({ filter: { text: 'anything', tags: [] } });

    renderListColumn(boardId, firstId, 0);

    expect(
      screen.getByRole('button', { name: 'Reorder list First' }),
    ).toHaveAttribute('data-rfd-drag-handle-draggable-id', firstId);
  });
});
