/**
 * A column's drop zone has two jobs that pull against each other: stay out
 * of the way when the column is empty (otherwise every empty column carries
 * a permanent block of dead space), and be a big enough target to drop a
 * card onto. It resolves them over time rather than picking one — collapsed
 * at rest, opened up while a card is actually in flight.
 */
import '@testing-library/jest-dom';
import { render } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { ListColumn } from '@/components/board/ListColumn';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { installElectronMock } from '../testUtils/electronMock';

function renderListColumn(
  boardId: string,
  listId: string,
  cardDragActive = false,
) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="board" direction="horizontal" type="LIST">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ListColumn
              boardId={boardId}
              listId={listId}
              index={0}
              cardDragActive={cardDragActive}
            />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>,
  );
}

const dropZone = (container: HTMLElement) =>
  container.querySelector('[data-slot="list-drop-zone"]');

describe('a column’s card drop zone', () => {
  let boardId: string;
  let listId: string;

  beforeEach(async () => {
    installElectronMock();
    useUiStore.setState({ showArchived: false });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists.forEach((list) => {
        list.cards = [];
      });
    });
  });

  it('stays collapsed while nothing is being dragged', () => {
    const { container } = renderListColumn(boardId, listId);
    expect(dropZone(container)).toHaveAttribute('data-expanded', 'false');
  });

  it('opens up while a card is in flight, so an empty column can be aimed at', () => {
    const { container } = renderListColumn(boardId, listId, true);
    expect(dropZone(container)).toHaveAttribute('data-expanded', 'true');
  });

  it('stays collapsed for a list drag, which needs no card-sized target', () => {
    // `cardDragActive` is false for a list drag: only a card lift should
    // grow every column's drop zone.
    const { container } = renderListColumn(boardId, listId, false);
    expect(dropZone(container)).toHaveAttribute('data-expanded', 'false');
  });
});
