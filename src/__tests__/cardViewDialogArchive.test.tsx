/**
 * View mode is where cards are opened to run/copy, so archive has to live
 * there too — burying it only in the edit composer meant a card could not
 * be archived without opening a second dialog. It sits to the left of Copy
 * (the other left-aligned footer action) and closes the view, same as the
 * composer, so an archived card disappears from the board immediately.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

describe('CardViewDialog archive', () => {
  let boardId: string;
  let listId: string;
  let cardId: string;

  const renderDialog = (onOpenChange = () => {}) =>
    render(
      <CardViewDialog
        open
        onOpenChange={onOpenChange}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

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
    cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Runnable card',
      prompt: 'Fix the thing.',
    });
  });

  it('places Archive immediately to the left of Copy', () => {
    renderDialog();

    const archive = screen.getByRole('button', { name: 'Archive' });
    const copy = screen.getByRole('button', { name: 'Copy' });
    expect(archive.compareDocumentPosition(copy)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('archives the card without deleting it and closes the dialog', () => {
    const onOpenChange = jest.fn();
    renderDialog(onOpenChange);

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    const card = useDocStore
      .getState()
      .doc!.boards[0].lists[0].cards.find((c) => c.id === cardId);
    expect(card).toBeDefined();
    expect(card!.archived).toBe(true);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers Unarchive when the card is already archived', () => {
    useDocStore.getState().archiveCard(boardId, listId, cardId);
    renderDialog();

    expect(screen.getByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Archive' }),
    ).not.toBeInTheDocument();
  });
});
