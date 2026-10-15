/**
 * Slash commands are edited in Settings and expand in the card prompt on
 * the keystroke that finishes the name.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { SettingsDialog } from '@/components/shell/SettingsDialog';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';
import { selectTab } from '../testUtils/tabs';

describe('slash snippets', () => {
  beforeEach(() => {
    installElectronMock();
    useDocStore.setState({ slashSnippets: [] });
  });

  it('adds and deletes a command from Settings', async () => {
    await useDocStore.getState().createAt('/tmp/kanban.json');
    render(<SettingsDialog open onOpenChange={() => {}} />);
    selectTab('Snippets');

    fireEvent.change(screen.getByLabelText('Command'), {
      target: { value: '/grill-me' },
    });
    fireEvent.change(screen.getByLabelText('Expands to'), {
      target: { value: 'Use the /grill-me skill to ask questions' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add command' }));

    expect(screen.getByText('/grill-me')).toBeInTheDocument();
    expect(useDocStore.getState().slashSnippets[0]).toMatchObject({
      trigger: 'grill-me',
      expansion: 'Use the /grill-me skill to ask questions',
    });
    expect(window.electron.settings.write).toHaveBeenCalledWith({
      slashSnippets: useDocStore.getState().slashSnippets,
    });

    const savedId = useDocStore.getState().slashSnippets[0].id;
    fireEvent.click(screen.getByRole('button', { name: 'Edit /grill-me' }));
    const editor = screen.getByRole('listitem');
    fireEvent.change(within(editor).getByLabelText('Command'), {
      target: { value: 'grill' },
    });
    fireEvent.change(within(editor).getByLabelText('Expands to'), {
      target: { value: 'Ask harder questions' },
    });
    fireEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    expect(useDocStore.getState().slashSnippets).toEqual([
      {
        id: savedId,
        trigger: 'grill',
        expansion: 'Ask harder questions',
      },
    ]);
    expect(screen.getByText('/grill')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete /grill' }));
    expect(screen.getByText('No commands yet.')).toBeInTheDocument();
    expect(useDocStore.getState().slashSnippets).toEqual([]);
  });

  it('expands the command in the prompt as it is typed', async () => {
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    useDocStore.setState({
      slashSnippets: [
        {
          id: 'snp_grill',
          trigger: 'grill-me',
          expansion: 'Use the /grill-me skill to ask questions',
        },
      ],
    });

    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={doc.boards[0].id}
        listId={doc.boards[0].lists[0].id}
        cardId={null}
      />,
    );

    const prompt = screen.getByLabelText('Prompt');
    fireEvent.change(prompt, {
      target: {
        value: 'Please /grill',
        selectionStart: 'Please /grill'.length,
      },
    });
    expect(prompt).toHaveValue('Please /grill');

    const typed = 'Please /grill-me';
    fireEvent.change(prompt, {
      target: { value: typed, selectionStart: typed.length },
    });
    expect(prompt).toHaveValue(
      'Please Use the /grill-me skill to ask questions',
    );
  });

  it('shows and filters suggestions after a slash', async () => {
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    useDocStore.setState({
      slashSnippets: [
        {
          id: 'snp_grill',
          trigger: 'grill-me',
          expansion: 'Ask challenging questions',
        },
        {
          id: 'snp_summary',
          trigger: 'summarize',
          expansion: 'Summarize the result',
        },
      ],
    });
    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={doc.boards[0].id}
        listId={doc.boards[0].lists[0].id}
        cardId={null}
      />,
    );
    const prompt = screen.getByLabelText('Prompt');

    fireEvent.change(prompt, {
      target: { value: '/', selectionStart: 1 },
    });
    expect(
      screen.getByRole('listbox', { name: 'Slash command suggestions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /\/grill-me/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /\/summarize/ }),
    ).toBeInTheDocument();

    fireEvent.change(prompt, {
      target: { value: '/gr', selectionStart: 3 },
    });
    expect(
      screen.getByRole('option', { name: /\/grill-me/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /\/summarize/ }),
    ).not.toBeInTheDocument();
  });

  it('selects a partial command from the suggestion list', async () => {
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    useDocStore.setState({
      slashSnippets: [
        {
          id: 'snp_grill',
          trigger: 'grill-me',
          expansion: 'Ask challenging questions',
        },
      ],
    });
    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={doc.boards[0].id}
        listId={doc.boards[0].lists[0].id}
        cardId={null}
      />,
    );
    const prompt = screen.getByLabelText('Prompt');
    fireEvent.change(prompt, {
      target: { value: 'Please /gr', selectionStart: 'Please /gr'.length },
    });

    fireEvent.click(screen.getByRole('option', { name: /\/grill-me/ }));

    expect(prompt).toHaveValue('Please Ask challenging questions');
    expect(
      screen.queryByRole('listbox', { name: 'Slash command suggestions' }),
    ).not.toBeInTheDocument();
  });

  it('selects suggestions with arrow keys and Enter', async () => {
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    useDocStore.setState({
      slashSnippets: [
        {
          id: 'snp_grill',
          trigger: 'grill-me',
          expansion: 'Ask challenging questions',
        },
        {
          id: 'snp_summary',
          trigger: 'summarize',
          expansion: 'Summarize the result',
        },
      ],
    });
    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={doc.boards[0].id}
        listId={doc.boards[0].lists[0].id}
        cardId={null}
      />,
    );
    const prompt = screen.getByLabelText('Prompt');
    fireEvent.change(prompt, {
      target: { value: '/', selectionStart: 1 },
    });

    fireEvent.keyDown(prompt, { key: 'ArrowDown' });
    fireEvent.keyDown(prompt, { key: 'Enter' });

    expect(prompt).toHaveValue('Summarize the result');
  });
});
