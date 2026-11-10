/**
 * The floating quick-add window reuses CardComposerDialog, with a board
 * picker that does not throw away the prompt when the destination changes.
 * Saving goes through onCreate so the panel does not write its own copy of
 * the document.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { useDocStore } from '@/store/docStore';

const choices = [
  { id: 'brd_prompts', name: 'Prompts', listId: 'lst_backlog' },
  { id: 'brd_bugs', name: 'Bugs', listId: 'lst_bugs' },
];

beforeEach(async () => {
  Object.defineProperty(window, 'electron', {
    writable: true,
    configurable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: null,
          recentFiles: [],
          activeBoardId: null,
          approvalMode: 'ask',
          defaultModel: null,
          useWorktrees: false,
          slashSnippets: [],
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest.fn(),
        write: jest.fn().mockResolvedValue({ ok: true, value: null }),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        pickFolder: jest.fn().mockResolvedValue(null),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      attachments: {
        add: jest.fn(),
        remove: jest.fn().mockResolvedValue({ ok: true, value: null }),
        preview: jest.fn().mockResolvedValue({ ok: false, error: 'missing' }),
        pick: jest.fn().mockResolvedValue({
          ok: true,
          value: { added: [], skippedCap: false, errors: [] },
        }),
        pasteFromClipboard: jest.fn().mockResolvedValue({
          ok: true,
          value: null,
        }),
      },
      clipboard: { write: jest.fn() },
      shell: { openExternal: jest.fn() },
      session: {
        stop: jest.fn().mockResolvedValue(undefined),
        onSnapshot: jest.fn().mockReturnValue(() => {}),
      },
      git: {
        removeWorktree: jest.fn().mockResolvedValue({ ok: true, value: null }),
        shipCancel: jest.fn().mockResolvedValue({ ok: true, value: null }),
      },
    },
  });
  await useDocStore.getState().createAt('/tmp/kanban.json');
});

describe('CardComposerDialog board picker', () => {
  it('shows the current board and keeps the prompt when the board changes', () => {
    const onBoardChange = jest.fn();
    const { rerender } = render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId="brd_prompts"
        listId="lst_backlog"
        cardId={null}
        boardChoices={choices}
        onBoardChange={onBoardChange}
      />,
    );

    expect(screen.getByRole('combobox', { name: 'Board' })).toHaveTextContent(
      'Prompts',
    );
    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'do not lose this' },
    });

    rerender(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId="brd_bugs"
        listId="lst_bugs"
        cardId={null}
        boardChoices={choices}
        onBoardChange={onBoardChange}
      />,
    );

    expect(screen.getByLabelText('Prompt')).toHaveValue('do not lose this');
    expect(screen.getByRole('combobox', { name: 'Board' })).toHaveTextContent(
      'Bugs',
    );
  });

  it('saves through onCreate instead of the local document', async () => {
    const onCreate = jest.fn().mockResolvedValue(true);
    const onOpenChange = jest.fn();
    const before = useDocStore.getState().doc!.boards[0].lists[0].cards.length;
    render(
      <CardComposerDialog
        open
        onOpenChange={onOpenChange}
        boardId="brd_prompts"
        listId="lst_backlog"
        cardId={null}
        boardChoices={choices}
        onBoardChange={() => {}}
        onCreate={onCreate}
      />,
    );

    fireEvent.change(screen.getByLabelText('Prompt'), {
      target: { value: 'from the panel' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'from the panel' }),
    );
    expect(useDocStore.getState().doc!.boards[0].lists[0].cards.length).toBe(
      before,
    );
    await Promise.resolve();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
