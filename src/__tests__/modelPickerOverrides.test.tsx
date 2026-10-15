/**
 * The card composer's two session overrides moved behind an "Overrides"
 * disclosure, and `Model` became an alias dropdown (with a custom-model-id
 * escape hatch) rather than a free-text field.
 *
 * What's worth pinning down here is the state coupling, which is where this
 * kind of UI goes wrong:
 *
 *   - a card that HAS an override must not hide it behind a collapsed
 *     section, or an existing setting becomes invisible to whoever opens
 *     the card;
 *   - picking "Custom model id…" must reveal an EMPTY input. The picker
 *     tracks that in state instead of deriving it from `value`, because at
 *     the moment of the click `value` is still the previous selection.
 */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { ModelPicker } from '@/components/common/ModelPicker';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

// Radix menu internals still touch Pointer Events and scrolling after a
// keyboard open, neither of which jsdom fully implements.
beforeAll(() => {
  Element.prototype.hasPointerCapture = jest.fn(() => false);
  Element.prototype.setPointerCapture = jest.fn();
  Element.prototype.releasePointerCapture = jest.fn();
  Element.prototype.scrollIntoView = jest.fn();
});


describe('ModelPicker', () => {
  it('offers the aliases and reports the chosen one, not free text', () => {
    const onChange = jest.fn();
    render(
      <ModelPicker value={null} onChange={onChange} inheritLabel="Uses the global default" />,
    );

    // Collapsed state shows the inherited label, and there is no text input
    // to type an arbitrary string into.
    expect(screen.getByRole('button', { name: /Uses the global default/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.keyDown(
      screen.getByRole('button', { name: /Uses the global default/ }),
      { key: 'ArrowDown' },
    );

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Sonnet/ }));
    expect(onChange).toHaveBeenCalledWith('sonnet');
  });

  it('reveals an empty text input for "Custom model id…" and clears the alias', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <ModelPicker value="opus" onChange={onChange} inheritLabel="Uses the global default" />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: /Opus/ }), {
      key: 'ArrowDown',
    });
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Custom model id/ }));

    // The alias is dropped rather than left behind as a pre-filled id.
    expect(onChange).toHaveBeenCalledWith(null);
    rerender(
      <ModelPicker value={null} onChange={onChange} inheritLabel="Uses the global default" />,
    );

    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: 'claude-opus-4-8' } });
    expect(onChange).toHaveBeenLastCalledWith('claude-opus-4-8');
  });

  it('shows a pinned full model id as the current selection', () => {
    render(
      <ModelPicker
        value="claude-opus-4-8"
        onChange={() => {}}
        inheritLabel="Uses the global default"
      />,
    );
    expect(
      screen.getByRole('button', { name: /claude-opus-4-8/ }),
    ).toBeInTheDocument();
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('claude-opus-4-8');
  });
});

describe('CardComposerDialog overrides disclosure', () => {
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

  it('hides the override fields on a card that has none', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'No overrides',
      prompt: 'p',
    });

    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

    expect(screen.getByRole('button', { name: /Overrides/ })).toBeInTheDocument();
    expect(screen.queryByText('Model')).not.toBeInTheDocument();
    expect(screen.queryByText('Working directory')).not.toBeInTheDocument();
  });

  it('starts expanded when the card already has an override', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Has a model override',
      prompt: 'p',
      sessionModel: 'haiku',
    });

    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Haiku/ })).toBeInTheDocument();
  });

  /**
   * A card with no override used to show the bare phrase "Uses the global
   * default", never saying which model that actually was — indistinguishable
   * from not knowing. The picker's own trigger button must name the
   * currently-effective model, without needing to open the menu to find out.
   */
  it('names the actual global default on a card with no override, not just the bare phrase', () => {
    useDocStore.setState({ defaultModel: 'sonnet' });
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'No override, real default configured',
      prompt: 'p',
    });

    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Overrides/ }));
    expect(
      screen.getByRole('button', { name: /Uses the global default \(Sonnet\)/ }),
    ).toBeInTheDocument();
  });

  it('falls back to naming the CLI default when no global default is configured either', () => {
    useDocStore.setState({ defaultModel: null });
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'No override, no global default',
      prompt: 'p',
    });

    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Overrides/ }));
    expect(
      screen.getByRole('button', {
        name: /Uses the global default \(your Claude Code CLI default\)/,
      }),
    ).toBeInTheDocument();
  });
});
