import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { isOverdue } from '@/domain/dueDate';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { PromptCard } from '@/components/card/PromptCard';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

describe('isOverdue', () => {
  const today = new Date(2026, 9, 16); // 2026-10-16

  it('is false with no due date', () => {
    expect(isOverdue(null, today)).toBe(false);
  });

  it('is false on the due date itself', () => {
    expect(isOverdue('2026-10-16', today)).toBe(false);
  });

  it('is false for a future due date', () => {
    expect(isOverdue('2026-10-17', today)).toBe(false);
  });

  it('is true the day after the due date', () => {
    expect(isOverdue('2026-10-15', today)).toBe(true);
  });
});

describe('setting a due date through the composer', () => {
  let boardId: string;
  let listId: string;

  const cardsNow = () => useDocStore.getState().doc!.boards[0].lists[0].cards;

  beforeEach(async () => {
    installElectronMock();
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

  const renderComposer = (cardId: string | null) =>
    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

  it('defaults a new card to no due date', () => {
    renderComposer(null);
    fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));
    expect(cardsNow()[0].dueDate).toBeNull();
  });

  it('stores the chosen due date on a brand new card', () => {
    renderComposer(null);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'With a deadline' },
    });
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));

    expect(cardsNow()[0].dueDate).toBe('2026-11-01');
  });

  it('updates the due date on an existing card', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Plain', prompt: 'p' });

    renderComposer(cardId);
    fireEvent.change(screen.getByLabelText('Due date'), {
      target: { value: '2026-12-25' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(cardsNow()[0].dueDate).toBe('2026-12-25');
  });

  it('clears the due date back to none', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Plain',
      prompt: 'p',
      dueDate: '2026-12-25',
    });

    renderComposer(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(cardsNow()[0].dueDate).toBeNull();
  });
});

describe('an overdue card on the board', () => {
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

  it('gets a red outline once the due date has passed', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Late',
      prompt: 'p',
      dueDate: '2000-01-01',
    });

    const { container } = renderCard(cardId);

    expect(container.querySelector('.border-destructive')).not.toBeNull();
    expect(screen.getByText(/Overdue/)).toBeInTheDocument();
  });

  it('is not flagged while the due date is still ahead', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'On track',
      prompt: 'p',
      dueDate: '2999-01-01',
    });

    const { container } = renderCard(cardId);

    expect(container.querySelector('.border-destructive')).toBeNull();
    expect(screen.getByText(/Due/)).toBeInTheDocument();
  });

  it('is not flagged when the card has no due date', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'No deadline', prompt: 'p' });

    const { container } = renderCard(cardId);

    expect(container.querySelector('.border-destructive')).toBeNull();
  });

  it('stays unflagged once an overdue card is archived', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Done late',
      prompt: 'p',
      dueDate: '2000-01-01',
    });
    useDocStore.getState().archiveCard(boardId, listId, cardId);

    const { container } = renderCard(cardId);

    expect(container.querySelector('.border-destructive')).toBeNull();
  });
});
