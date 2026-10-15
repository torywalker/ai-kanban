/**
 * Card colors: a purely visual, optional label used to make a card stand
 * out in a crowded list.
 */
import { readFileSync } from 'fs';
import path from 'path';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CARD_COLOR_VALUES } from '@shared/schema';
import { CARD_COLOR_LABEL } from '@/domain/cardColor';
import { CardColorPicker } from '@/components/card/CardColorPicker';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { PromptCard } from '@/components/card/PromptCard';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { installElectronMock } from '../testUtils/electronMock';

describe('CardColorPicker', () => {
  it('offers every color in the palette', () => {
    render(<CardColorPicker value={null} onChange={() => {}} />);
    CARD_COLOR_VALUES.forEach((color) => {
      expect(
        screen.getByRole('button', { name: CARD_COLOR_LABEL[color] }),
      ).toBeInTheDocument();
    });
  });

  it('reports the color that was clicked', () => {
    const onChange = jest.fn();
    render(<CardColorPicker value={null} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Violet' }));

    expect(onChange).toHaveBeenCalledWith('violet');
  });

  it('marks only the selected color as pressed', () => {
    render(<CardColorPicker value="teal" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Red' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clears the color when the selected one is clicked again', () => {
    // Color is optional, so re-clicking the active swatch is the only way
    // back to an untinted card — same affordance PriorityPicker gives.
    const onChange = jest.fn();
    render(<CardColorPicker value="teal" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Teal' }));

    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('setting a card color through the composer', () => {
  let boardId: string;
  let listId: string;

  const cardsNow = () => useDocStore.getState().doc!.boards[0].lists[0].cards;

  beforeEach(async () => {
    installElectronMock();
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

  const renderComposer = (cardId: string | null) =>
    render(
      <CardComposerDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

  it('stores the chosen color on a brand new card', () => {
    renderComposer(null);

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Tinted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Violet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));

    expect(cardsNow()[0].color).toBe('violet');
  });

  it('defaults a new card to no color', () => {
    renderComposer(null);
    fireEvent.click(screen.getByRole('button', { name: 'Add prompt' }));
    expect(cardsNow()[0].color).toBeNull();
  });

  it('recolors an existing card on save', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Plain', prompt: 'p' });

    renderComposer(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Amber' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(cardsNow()[0].color).toBe('amber');
  });

  it('shows the card’s current color as pressed when reopened', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Plain', prompt: 'p', color: 'pink' });

    renderComposer(cardId);

    expect(screen.getByRole('button', { name: 'Pink' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('clears the color back to none', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Plain', prompt: 'p', color: 'pink' });

    renderComposer(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Pink' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(cardsNow()[0].color).toBeNull();
  });
});

describe('a colored card on the board', () => {
  let boardId: string;
  let listId: string;

  beforeEach(async () => {
    installElectronMock();
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

  // PromptCard renders a Draggable, which needs a Droppable inside a
  // DragDropContext to mount at all.
  const renderCard = (cardId: string) =>
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

  /**
   * The tint itself lives in CSS: globals.css keys the tint/edge custom
   * properties off `data-card-color`. jsdom applies no stylesheet, so what
   * is verifiable here is the hook the stylesheet needs — and that an
   * uncolored card carries no hook at all, so it keeps the plain
   * `--card` background.
   */
  it('marks the card element with its color', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Tinted card',
      prompt: 'p',
      color: 'violet',
    });

    const { container } = renderCard(cardId);

    expect(
      container.querySelector('[data-card-color="violet"]'),
    ).not.toBeNull();
  });

  it('leaves an uncolored card unmarked', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Plain card', prompt: 'p' });

    const { container } = renderCard(cardId);

    expect(container.querySelector('[data-card-color]')).toBeNull();
  });
});

/**
 * The tint is the whole point of the feature and it lives entirely in CSS,
 * which jsdom never applies (the jest moduleNameMapper swaps stylesheets
 * for identity-obj-proxy). So the stylesheet is checked as text: every
 * color must be fully defined in BOTH themes, because a color that exists
 * in light and not dark is a card that silently loses its tint the moment
 * the OS flips to dark mode.
 */
describe('the card color palette in globals.css', () => {
  const css = readFileSync(
    path.join(__dirname, '../renderer/globals.css'),
    'utf8',
  );

  const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`no ${selector} block in globals.css`);
    const end = css.indexOf('\n}', start);
    return css.slice(start, end);
  };

  it.each(CARD_COLOR_VALUES)('defines %s for the light theme', (color) => {
    const root = block(':root');
    expect(root).toContain(`--card-${color}-tint:`);
    expect(root).toContain(`--card-${color}-edge:`);
    expect(root).toContain(`--card-${color}-dot:`);
  });

  it.each(CARD_COLOR_VALUES)('defines %s for the dark theme', (color) => {
    const dark = block('.dark');
    expect(dark).toContain(`--card-${color}-tint:`);
    expect(dark).toContain(`--card-${color}-edge:`);
    expect(dark).toContain(`--card-${color}-dot:`);
  });

  it.each(CARD_COLOR_VALUES)(
    'maps %s onto the tint variables PromptCard reads',
    (color) => {
      // PromptCard reads the theme-neutral `--card-tint`/`--card-edge`; the
      // per-color values are aliased onto them by attribute selector so the
      // card markup never names a color.
      const alias = block(`[data-card-color='${color}']`);
      expect(alias).toContain(`--card-tint: var(--card-${color}-tint)`);
      expect(alias).toContain(`--card-edge: var(--card-${color}-edge)`);
    },
  );
});

describe('recoloring from the card view dialog', () => {
  let boardId: string;
  let listId: string;

  const colorNow = () =>
    useDocStore.getState().doc!.boards[0].lists[0].cards[0].color;

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

  const openDialog = (cardId: string) =>
    render(
      <CardViewDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />,
    );

  it('writes the color straight to the card, without entering edit mode', () => {
    const cardId = useDocStore
      .getState()
      .addCard(boardId, listId, { title: 'Read me', prompt: 'p' });

    openDialog(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Card color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));

    expect(colorNow()).toBe('green');
  });

  it('clears the color from the same control', () => {
    const cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Read me',
      prompt: 'p',
      color: 'green',
    });

    openDialog(cardId);
    fireEvent.click(screen.getByRole('button', { name: 'Card color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));

    expect(colorNow()).toBeNull();
  });
});
