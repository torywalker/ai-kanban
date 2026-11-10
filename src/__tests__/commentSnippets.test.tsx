/**
 * Comment shortcuts are a separate library from the prompt ones, but expand
 * the same way in the card's comment box.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommentsPanel } from '@/components/card/CommentsPanel';
import { CommentItem } from '@/components/card/CommentItem';
import { useDocStore } from '@/store/docStore';
import { installElectronMock } from '../testUtils/electronMock';

describe('comment snippets', () => {
  beforeEach(() => {
    installElectronMock();
    useDocStore.setState({ slashSnippets: [], commentSnippets: [] });
  });

  it('keeps the two libraries apart', () => {
    useDocStore.getState().addCommentSnippet('lgtm', 'Looks good to me');
    expect(useDocStore.getState().commentSnippets).toHaveLength(1);
    expect(useDocStore.getState().slashSnippets).toEqual([]);
  });

  it('expands a comment command, and ignores prompt commands', () => {
    useDocStore.getState().addCommentSnippet('lgtm', 'Looks good to me');
    useDocStore.getState().addSlashSnippet('grill-me', 'Grill me');
    render(
      <CommentsPanel
        boardId="b"
        listId="l"
        cardId="c"
        autoFocus={false}
        className=""
      />,
    );
    const box = screen.getByPlaceholderText('Add a comment…');
    fireEvent.change(box, { target: { value: '/lgtm', selectionStart: 5 } });
    expect(box).toHaveValue('Looks good to me');
    fireEvent.change(box, {
      target: { value: '/grill-me', selectionStart: 9 },
    });
    expect(box).toHaveValue('/grill-me');
  });
});

describe('comment snippets while editing', () => {
  it('expand in the edit box', () => {
    installElectronMock();
    useDocStore.setState({
      commentSnippets: [{ id: 's1', trigger: 'lgtm', expansion: 'Looks good' }],
    });
    render(
      <ul>
        <CommentItem
          comment={{ id: 'c1', text: 'x', createdAt: new Date().toISOString() }}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </ul>,
    );
    fireEvent.click(screen.getByLabelText('Edit comment'));
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: '/lgtm', selectionStart: 5 } });
    expect(box).toHaveValue('Looks good');
  });
});
