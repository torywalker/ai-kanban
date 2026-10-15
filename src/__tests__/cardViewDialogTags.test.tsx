/**
 * Tagging from the card view dialog — the same write-through popover
 * pattern as priority and color, applied to the existing TagPicker.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('setting tags from the card view dialog', () => {
  let boardId: string;
  let listId: string;

  const tagsNow = () =>
    useDocStore.getState().doc!.boards[0].lists[0].cards[0].tags;

  beforeEach(async () => {
    global.ResizeObserver = ResizeObserverStub;
    Element.prototype.scrollIntoView = jest.fn();
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

  it('writes a new tag straight to the card, without entering edit mode', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Read me', prompt: 'p' });

    openDialog(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.change(screen.getByPlaceholderText('Find or create a tag'), {
      target: { value: 'urgent' },
    });
    fireEvent.click(screen.getByRole('option', { name: /Create “urgent”/ }));

    expect(tagsNow()).toEqual(['urgent']);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('adds an existing board tag from the same control', () => {
    act(() => {
      useDocStore.getState().ensureTag('bug');
    });
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Read me', prompt: 'p' });

    openDialog(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    fireEvent.click(screen.getByRole('option', { name: /bug/i }));

    expect(tagsNow()).toEqual(['bug']);
  });

  it('removes a tag from the badge without entering edit mode', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Read me',
      prompt: 'p',
      tags: ['bug'],
    });

    openDialog(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag bug' }));

    expect(tagsNow()).toEqual([]);
  });
});
