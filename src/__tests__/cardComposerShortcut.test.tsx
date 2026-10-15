/**
 * Cmd/Ctrl+Enter is the fast path for saving a card without reaching for the
 * mouse -- it should work while creating a new card and while editing an
 * existing one, from any field inside the composer (title, prompt, etc, not
 * just a single "focus the button" trick), and it must not fire while an
 * IME composition is in progress (Enter there confirms the candidate, not
 * the shortcut).
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

describe('CardComposerDialog Cmd/Ctrl+Enter shortcut', () => {
  let boardId: string;
  let listId: string;

  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists[0].cards = [];
    });
  });

  it('saves a new card on Cmd+Enter from the title field', () => {
    const onOpenChange = jest.fn();
    render(
      <CardComposerDialog
        open
        onOpenChange={onOpenChange}
        boardId={boardId}
        listId={listId}
        cardId={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Ship the thing' },
    });
    fireEvent.keyDown(screen.getByLabelText('Title'), {
      key: 'Enter',
      metaKey: true,
    });

    const { cards } = useDocStore.getState().doc!.boards[0].lists[0];
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Ship the thing');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves an existing card on Ctrl+Enter from the prompt field', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Original title',
      prompt: 'Original prompt',
    });
    const onOpenChange = jest.fn();
    render(
      <CardComposerDialog
        open
        onOpenChange={onOpenChange}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'Updated prompt' },
    });
    fireEvent.keyDown(screen.getByLabelText('Prompt'), {
      key: 'Enter',
      ctrlKey: true,
    });

    const card = useDocStore
      .getState()
      .doc!.boards[0].lists[0].cards.find((c) => c.id === cardId);
    expect(card?.prompt).toBe('Updated prompt');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not save on bare Enter', () => {
    const onOpenChange = jest.fn();
    render(
      <CardComposerDialog
        open
        onOpenChange={onOpenChange}
        boardId={boardId}
        listId={listId}
        cardId={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Should not save yet' },
    });
    fireEvent.keyDown(screen.getByLabelText('Title'), { key: 'Enter' });

    expect(useDocStore.getState().doc!.boards[0].lists[0].cards).toHaveLength(
      0,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not save on Cmd+Enter while an IME composition is in progress', () => {
    const onOpenChange = jest.fn();
    render(
      <CardComposerDialog
        open
        onOpenChange={onOpenChange}
        boardId={boardId}
        listId={listId}
        cardId={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Composing…' },
    });
    fireEvent.keyDown(screen.getByLabelText('Title'), {
      key: 'Enter',
      metaKey: true,
      isComposing: true,
    });

    expect(useDocStore.getState().doc!.boards[0].lists[0].cards).toHaveLength(
      0,
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
