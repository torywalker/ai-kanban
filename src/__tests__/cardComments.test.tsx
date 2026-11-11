/**
 * Card comments: the data model (older files must still open) and the
 * board-card count indicator.
 */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { CardSchema } from '@shared/schema';
import { PromptCard } from '@/components/card/PromptCard';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

const baseCard = {
  id: 'crd_1',
  title: 'T',
  prompt: 'P',
  tags: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const comment = (id: string, text: string) => ({
  id,
  text,
  createdAt: '2026-11-04T10:00:00.000Z',
});

describe('Card.comments schema', () => {
  it('parses a card without comments as an empty list', () => {
    expect(CardSchema.parse(baseCard).comments).toEqual([]);
  });

  it('falls back to an empty list when comments is malformed', () => {
    expect(
      CardSchema.parse({ ...baseCard, comments: 'oops' }).comments,
    ).toEqual([]);
  });
});

describe('card comments in the store and on the board', () => {
  let boardId: string;
  let listId: string;

  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    act(() => {
      useDocStore.getState().mutate((draft) => {
        draft.boards[0].lists[0].cards = [];
      });
    });
  });

  const addCardWithComments = (n: number) => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'C', prompt: 'p' });
    act(() => {
      useDocStore.getState().updateCard(boardId, listId, cardId, {
        comments: Array.from({ length: n }, (_, i) => comment(`c${i}`, 'x')),
      });
    });
    return cardId;
  };

  const renderCard = (cardId: string) =>
    render(
      <DragDropContext onDragEnd={() => {}}>
        <Droppable droppableId={listId} type="CARD">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps}>
              <PromptCard
                boardId={boardId}
                listId={listId}
                cardId={cardId}
                index={0}
              />
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>,
    );

  it('keeps comments when a card moves to another board', () => {
    const cardId = addCardWithComments(1);
    let otherBoard = '';
    let otherList = '';
    act(() => {
      otherBoard = useDocStore.getState().addBoard('Other');
    });
    otherList = useDocStore
      .getState()
      .doc!.boards.find((b) => b.id === otherBoard)!.lists[0].id;

    act(() => {
      useDocStore
        .getState()
        .moveCardToBoard(boardId, listId, cardId, otherBoard, otherList);
    });

    const moved = useDocStore
      .getState()
      .doc!.boards.find((b) => b.id === otherBoard)!
      .lists[0].cards.find((c) => c.id === cardId)!;
    expect(moved.comments).toHaveLength(1);
  });

  it('shows no comment count when there are no comments', () => {
    renderCard(addCardWithComments(0));
    expect(screen.queryByLabelText(/comments/)).toBeNull();
  });

  it('shows the comment count when there are comments', () => {
    renderCard(addCardWithComments(2));
    expect(screen.getByLabelText('2 comments')).toBeInTheDocument();
  });
});
