/**
 * `notes` was editable in the composer and visible on the expanded
 * PromptCard, but the view dialog never rendered it — opening a card to read
 * it was the one place the field went missing. It belongs directly below the
 * prompt, and only when there is something to show (most cards never get a
 * note, and an always-present empty block would push the transcript down).
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';


describe('CardViewDialog notes', () => {
  let boardId: string;
  let listId: string;

  const addCard = (notes: string) =>
    useDocStore.getState().addCard(boardId, listId, {
      title: 'Runnable card',
      prompt: 'Fix the thing.',
      notes,
    });

  const renderDialog = (cardId: string) =>
    render(
      <CardViewDialog
        open
        onOpenChange={() => {}}
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
  });

  it('renders the notes under a Notes heading in view mode', () => {
    renderDialog(addCard('Ran fine, but ask for tests next time.'));

    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(
      screen.getByText('Ran fine, but ask for tests next time.'),
    ).toBeInTheDocument();
  });

  it('places the notes below the prompt', () => {
    renderDialog(addCard('the note'));

    const prompt = screen.getByText('Fix the thing.');
    const notes = screen.getByText('the note');
    // 4 === DOCUMENT_POSITION_FOLLOWING: `notes` comes after `prompt`.
    expect(prompt.compareDocumentPosition(notes)).toBe(4);
  });

  it('shows no Notes block at all when the card has no notes', () => {
    renderDialog(addCard(''));

    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
  });

  it('preserves the line breaks the user typed', () => {
    renderDialog(addCard('first line\nsecond line'));

    expect(screen.getByText(/first line/)).toHaveClass('whitespace-pre-wrap');
  });
});
