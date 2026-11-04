/**
 * The comments sidebar in the card view dialog: collapsed by default, a
 * newest-first status log the user adds to, edits and deletes.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { installElectronMock } from '../testUtils/electronMock';

const PLACEHOLDER = 'Add a comment…';

describe('CardViewDialog comments', () => {
  let boardId: string;
  let listId: string;

  const cardNow = (cardId: string) =>
    useDocStore
      .getState()
      .doc!.boards[0].lists[0].cards.find((c) => c.id === cardId)!;

  const addCard = (
    comments: { id: string; text: string; at: string }[] = [],
  ) => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Card', prompt: 'Do it.' });
    act(() => {
      useDocStore.getState().updateCard(boardId, listId, cardId, {
        comments: comments.map((c) => ({
          id: c.id,
          text: c.text,
          createdAt: c.at,
        })),
      });
    });
    return cardId;
  };

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

  const submit = (box: HTMLElement) =>
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });

  const openPanel = () =>
    fireEvent.click(screen.getByRole('button', { name: /^comments \(/i }));

  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
    useUiStore.setState({ commentsOpen: false });
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

  const older = {
    id: 'c1',
    text: 'older note',
    at: '2026-11-01T10:00:00.000Z',
  };
  const newer = {
    id: 'c2',
    text: 'newer note',
    at: '2026-11-03T10:00:00.000Z',
  };

  it('is collapsed by default and the toggle shows the count', () => {
    renderDialog(addCard([older, newer]));

    expect(
      screen.getByRole('button', { name: 'Comments (2)' }),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(PLACEHOLDER)).toBeNull();
  });

  it('lists comments newest first once opened', () => {
    renderDialog(addCard([older, newer]));
    openPanel();

    const a = screen.getByText('newer note');
    const b = screen.getByText('older note');
    expect(
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('adds a trimmed comment with Cmd+Enter and clears the box', () => {
    const cardId = addCard();
    renderDialog(cardId);
    openPanel();

    const box = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(box, { target: { value: '  waiting on deploy  ' } });
    submit(box);

    const [saved] = cardNow(cardId).comments;
    expect(saved.text).toBe('waiting on deploy');
    expect(saved.createdAt).toBeTruthy();
    expect(box).toHaveValue('');
  });

  it('does not add a blank comment', () => {
    const cardId = addCard();
    renderDialog(cardId);
    openPanel();

    const box = screen.getByPlaceholderText(PLACEHOLDER);
    fireEvent.change(box, { target: { value: '   \n ' } });
    submit(box);

    expect(cardNow(cardId).comments).toEqual([]);
  });

  it('saves an edit and marks the comment edited', () => {
    const cardId = addCard([older]);
    renderDialog(cardId);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
    const box = screen.getByDisplayValue('older note');
    fireEvent.change(box, { target: { value: 'revised' } });
    submit(box);

    const [saved] = cardNow(cardId).comments;
    expect(saved.text).toBe('revised');
    expect(saved.editedAt).toBeTruthy();
    expect(screen.getByText('edited')).toBeInTheDocument();
  });

  it('keeps the original when an edit is blanked', () => {
    const cardId = addCard([older]);
    renderDialog(cardId);
    openPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Edit comment' }));
    const box = screen.getByDisplayValue('older note');
    fireEvent.change(box, { target: { value: '  ' } });
    submit(box);

    expect(cardNow(cardId).comments[0].text).toBe('older note');
  });

  it('deletes a comment', () => {
    const cardId = addCard([older, newer]);
    renderDialog(cardId);
    openPanel();

    fireEvent.click(
      screen.getAllByRole('button', { name: 'Delete comment' })[0],
    );

    expect(cardNow(cardId).comments.map((c) => c.id)).toEqual(['c1']);
  });

  it('shares the open preference across cards', () => {
    useUiStore.setState({ commentsOpen: true });
    renderDialog(addCard());

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toBeInTheDocument();
  });

  it('drops the draft when switching cards', () => {
    const first = addCard([older]);
    const second = addCard([newer]);
    useUiStore.setState({ commentsOpen: true });
    const view = renderDialog(first);

    fireEvent.change(screen.getByPlaceholderText(PLACEHOLDER), {
      target: { value: 'half typed' },
    });
    view.rerender(
      <CardViewDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={second}
      />,
    );

    expect(screen.getByPlaceholderText(PLACEHOLDER)).toHaveValue('');
    expect(screen.getByText('newer note')).toBeInTheDocument();
  });
});
