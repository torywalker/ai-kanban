/**
 * The brief's Step 8 verification (paste `Cmd+V` while focused on a list vs.
 * inside a text field) is interactive and out of reach here. This exercises
 * the same two guarantees at the component level: pasting over the list
 * background creates a card whose title is the first line (truncated to 60
 * chars) and whose prompt is the full clipboard text, while pasting into a
 * field inside the list (e.g. the composer's inputs) must not hijack the
 * paste into a new card.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { ListColumn } from '../renderer/components/board/ListColumn';
import { useDocStore } from '../renderer/store/docStore';
import { EMPTY_USAGE_TOTALS } from '../shared/usage';

// ListColumn renders a Draggable/Droppable internally, which requires a
// DragDropContext ancestor to mount without throwing. onDragEnd is a no-op
// here; drag behavior itself is covered by dragEnd.test.ts.
function renderListColumn(boardId: string, listId: string) {
  return render(
    <DragDropContext onDragEnd={() => {}}>
      <Droppable droppableId="board" direction="horizontal" type="LIST">
        {(provided) => (
          <div ref={provided.innerRef} {...provided.droppableProps}>
            <ListColumn boardId={boardId} listId={listId} index={0} />
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </DragDropContext>,
  );
}

function installElectronMock() {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: null,
          recentFiles: [],
          activeBoardId: null,
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest.fn(),
        write: jest.fn().mockResolvedValue({ ok: true, value: null }),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn(), read: jest.fn() },
      shell: { openExternal: jest.fn() },
      usage: { cardTotals: jest.fn().mockResolvedValue(EMPTY_USAGE_TOTALS) },
    },
  });
}

function makeClipboardData(text: string) {
  return { getData: () => text };
}

describe('ListColumn paste-to-create', () => {
  let boardId: string;
  let listId: string;

  beforeEach(async () => {
    installElectronMock();
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    // Clear the seed cards so card counts in assertions are unambiguous.
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists[0].cards = [];
    });
  });

  it('creates a card from clipboard text pasted over the list background', () => {
    renderListColumn(boardId, listId);

    const longFirstLine = 'a'.repeat(80);
    const text = `${longFirstLine}\nsecond line\nthird line`;

    const group = screen.getByRole('group', { name: /list:/i });
    fireEvent.paste(group, { clipboardData: makeClipboardData(text) });

    const cards = useDocStore.getState().doc!.boards[0].lists[0].cards;
    expect(cards).toHaveLength(1);
    expect(cards[0].prompt).toBe(text);
    // 60 chars total: 57 kept + '...'
    expect(cards[0].title).toBe(`${'a'.repeat(57)}...`);
    expect(cards[0].title.length).toBe(60);
  });

  it('does not create a card when pasting into a field inside the list', () => {
    renderListColumn(boardId, listId);

    const addPromptButton = screen.getByRole('button', {
      name: /add prompt/i,
    });
    fireEvent.click(addPromptButton);

    const titleInput = screen.getByLabelText(/title/i);
    fireEvent.paste(titleInput, {
      clipboardData: makeClipboardData('first line\nsecond line'),
    });

    const cards = useDocStore.getState().doc!.boards[0].lists[0].cards;
    expect(cards).toHaveLength(0);
  });
});
