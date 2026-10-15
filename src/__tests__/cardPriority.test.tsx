/**
 * Priority selection from the card view dialog — the same write-through
 * popover pattern as recoloring from the view dialog (cardColor.test.tsx),
 * applied to the existing PriorityPicker instead of CardColorPicker.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { PromptCard } from '@/components/card/PromptCard';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

describe('setting priority from the card view dialog', () => {
  let boardId: string;
  let listId: string;

  const priorityNow = () =>
    useDocStore.getState().doc!.boards[0].lists[0].cards[0].priority;

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

  const openDialog = (cardId: string) =>
    render(
      <CardViewDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

  const renderBoardCard = (cardId: string) =>
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

  it('writes the priority straight to the card, without entering edit mode', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Read me', prompt: 'p' });

    openDialog(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    fireEvent.click(screen.getByRole('button', { name: /High/ }));

    expect(priorityNow()).toBe('high');
  });

  it('clears the priority from the same control', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Read me',
      prompt: 'p',
      priority: 'high',
    });

    openDialog(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    fireEvent.click(screen.getByRole('button', { name: /High/ }));

    expect(priorityNow()).toBeNull();
  });

  it('shows an outline priority flag on a board card with no priority', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Unprioritized', prompt: 'p' });

    renderBoardCard(cardId);

    const button = screen.getByRole('button', {
      name: 'Priority for Unprioritized',
    });
    expect(button).toBeInTheDocument();
    expect(button.querySelector('svg')).toHaveAttribute('fill', 'none');
  });

  it('sets priority directly from the outline flag on a board card', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Unprioritized', prompt: 'p' });

    renderBoardCard(cardId);
    fireEvent.click(
      screen.getByRole('button', { name: 'Priority for Unprioritized' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /High/ }));

    expect(priorityNow()).toBe('high');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('updates priority directly from a filled flag on a board card', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Prioritized',
      prompt: 'p',
      priority: 'high',
    });

    renderBoardCard(cardId);
    fireEvent.click(
      screen.getByRole('button', { name: 'Priority for Prioritized' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Low/ }));

    expect(priorityNow()).toBe('low');
  });
});
