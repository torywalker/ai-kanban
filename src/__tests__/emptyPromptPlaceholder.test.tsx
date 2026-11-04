/**
 * A card's prompt can legitimately be empty — the composer saves an empty
 * prompt and only defaults the title — and both surfaces that show the prompt
 * rendered that empty string straight into a `<pre>`. The result read as a
 * broken view: a slab of space where text obviously belonged, with nothing to
 * say whether the prompt was missing or the app had failed to load it. Both
 * surfaces now share PromptBody, which substitutes a placeholder.
 */
import '@testing-library/jest-dom';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  EMPTY_PROMPT_PLACEHOLDER,
  PromptBody,
} from '@/components/card/PromptBody';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { PromptCard } from '@/components/card/PromptCard';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';


describe('PromptBody', () => {
  it('renders the prompt verbatim when there is one', () => {
    render(<PromptBody prompt="Fix the thing." />);

    expect(screen.getByText('Fix the thing.')).toBeInTheDocument();
    expect(
      screen.queryByText(EMPTY_PROMPT_PLACEHOLDER),
    ).not.toBeInTheDocument();
  });

  it('substitutes the placeholder for an empty prompt', () => {
    render(<PromptBody prompt="" />);

    expect(screen.getByText(EMPTY_PROMPT_PLACEHOLDER)).toBeInTheDocument();
  });

  // Whitespace-only is the same absence of a prompt as '' — a prompt of
  // three blank lines looks exactly as broken as none at all.
  it('treats a whitespace-only prompt as empty', () => {
    render(<PromptBody prompt={'  \n\t '} />);

    expect(screen.getByText(EMPTY_PROMPT_PLACEHOLDER)).toBeInTheDocument();
  });

  // The placeholder is prose about a missing value, not the value: it must
  // not inherit the call site's monospace prompt styling.
  it('styles the placeholder as muted prose, overriding call-site classes', () => {
    render(<PromptBody prompt="" className="text-foreground" />);

    const placeholder = screen.getByText(EMPTY_PROMPT_PLACEHOLDER);
    expect(placeholder).toHaveClass('italic', 'text-muted-foreground');
    expect(placeholder).not.toHaveClass('font-mono', 'text-foreground');
  });

  it('keeps real prompt text monospaced and wrapping', () => {
    render(<PromptBody prompt={'first line\nsecond line'} />);

    const body = screen.getByText(/first line/);
    expect(body).toHaveClass('font-mono', 'whitespace-pre-wrap');
    expect(body).not.toHaveClass('italic');
  });
});

describe('a card with no prompt', () => {
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

  const addEmptyCard = () =>
    useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Untitled prompt', prompt: '' });

  it('shows the placeholder in the view dialog', () => {
    render(
      <CardViewDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={addEmptyCard()}
      />,
    );

    expect(screen.getByText(EMPTY_PROMPT_PLACEHOLDER)).toBeInTheDocument();
  });

  it('shows the placeholder on the expanded board card', () => {
    const cardId = addEmptyCard();

    // PromptCard renders a Draggable, which needs a Droppable inside a
    // DragDropContext to mount at all.
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

    fireEvent.click(screen.getByLabelText('Expand prompt'));

    expect(screen.getByText(EMPTY_PROMPT_PLACEHOLDER)).toBeInTheDocument();
  });
});
