/**
 * The AI chat in the card modal was unreadable for any real conversation.
 * Two ceilings stacked against it:
 *
 *   1. `DialogContent` is capped at `sm:max-w-2xl` / `max-h-[85vh]`.
 *   2. The transcript feed itself is hard-capped at `max-h-64` (256px),
 *      with the dialog body as the single shared scroll region.
 *
 * Because of (2), growing the dialog alone buys the chat nothing — the
 * extra height goes to whitespace while the feed stays 256px tall. So the
 * expand toggle has to do both things: grow the modal AND hand the
 * reclaimed space to the feed by making the feed the scroller instead of
 * the body.
 *
 * These tests pin all three halves of that: the control itself, the
 * sizing, and the scroll handoff.
 */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CardViewDialog } from '@/components/card/CardViewDialog';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { installElectronMock } from '../testUtils/electronMock';

const REPO = '/tmp/some-repo';


describe('CardViewDialog: expanding the AI chat', () => {
  let boardId: string;
  let listId: string;
  let cardId: string;

  const seedSnapshot = () =>
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: 'sess_live',
      status: 'done',
      checklist: [{ id: 'tu_1', label: 'Read: a.py', done: true, seq: 0 }],
      messages: [],
      pendingApproval: null,
      lastError: null,
    });

  const renderDialog = (id: string = cardId) =>
    render(
      <CardViewDialog
        open
        onOpenChange={() => {}}
        boardId={boardId}
        listId={listId}
        cardId={id}
      />,
    );

  /** The Radix content element, which carries the dialog's sizing classes. */
  const dialogContent = () =>
    document.querySelector('[data-slot="dialog-content"]')!;

  /** The transcript feed: the list the conversation actually renders into. */
  const feed = () => screen.getByRole('list');

  /**
   * The dialog body — the flex column holding prompt, notes, transcript and
   * the reply row. Located by walking up from the transcript rather than by
   * a scroll-related class, since which element scrolls is the very thing
   * under test here.
   */
  const dialogBody = () => feed().closest('[data-slot="dialog-body"]')!;

  const expandButton = () => screen.getByRole('button', { name: 'Expand' });
  const collapseButton = () => screen.getByRole('button', { name: 'Collapse' });

  beforeEach(async () => {
    installElectronMock();
    useSessionStore.setState({ sessions: {} });
    useUiStore.setState({ cardDialogExpanded: {} });
    await useDocStore.getState().createAt('/tmp/kanban.json');
    const doc = useDocStore.getState().doc!;
    boardId = doc.boards[0].id;
    listId = doc.boards[0].lists[0].id;
    useDocStore.getState().mutate((draft) => {
      draft.boards[0].lists[0].cards = [];
    });
    useDocStore.getState().setBoardDefaultRepo(boardId, REPO);
    cardId = useDocStore.getState().addCard(boardId, listId, {
      title: 'Runnable card',
      prompt: 'Fix the thing.',
    });
  });

  describe('the toggle control', () => {
    it('offers an Expand control on a card with a live session', () => {
      act(() => seedSnapshot());
      renderDialog();

      expect(expandButton()).toBeInTheDocument();
    });

    it('becomes a Collapse control once expanded, so the change is reversible', () => {
      act(() => seedSnapshot());
      renderDialog();

      fireEvent.click(expandButton());

      expect(collapseButton()).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Expand' })).toBeNull();
    });

    it('returns to the Expand control when collapsed again', () => {
      act(() => seedSnapshot());
      renderDialog();

      fireEvent.click(expandButton());
      fireEvent.click(collapseButton());

      expect(expandButton()).toBeInTheDocument();
    });
  });

  describe('the dialog grows to make the room', () => {
    it('keeps the narrow 2xl cap while collapsed', () => {
      act(() => seedSnapshot());
      renderDialog();

      expect(dialogContent().className).toContain('sm:max-w-2xl');
      expect(dialogContent().className).toContain('max-h-[85vh]');
    });

    it('drops the 2xl cap for a near-fullscreen box when expanded', () => {
      act(() => seedSnapshot());
      renderDialog();

      fireEvent.click(expandButton());

      const { className } = dialogContent();
      expect(className).not.toContain('sm:max-w-2xl');
      expect(className).not.toContain('max-h-[85vh]');
      expect(className).toContain('sm:max-w-[92vw]');
      expect(className).toContain('h-[92vh]');
    });
  });

  /**
   * The heart of the fix. A taller dialog is worthless while the feed keeps
   * its own 256px ceiling — the space would land in the gap below the chat
   * instead of in the chat. Expanding therefore has to hand the scroll role
   * from the body to the feed.
   */
  describe('the reclaimed space goes to the chat, not to whitespace', () => {
    it('caps the feed at max-h-64 while collapsed, with the body scrolling', () => {
      act(() => seedSnapshot());
      renderDialog();

      expect(feed().className).toContain('max-h-64');
      expect(feed().className).not.toContain('flex-1');
      expect(dialogBody().className).toContain('overflow-y-auto');
    });

    it('lets the feed flex to fill the dialog when expanded', () => {
      act(() => seedSnapshot());
      renderDialog();

      fireEvent.click(expandButton());

      expect(feed().className).not.toContain('max-h-64');
      expect(feed().className).toContain('flex-1');
      expect(feed().className).toContain('min-h-0');
      expect(feed().className).toContain('overflow-y-auto');
    });

    it('stops the body scrolling when expanded, so the feed is the scroller', () => {
      act(() => seedSnapshot());
      renderDialog();

      fireEvent.click(expandButton());

      expect(dialogBody().className).toContain('overflow-hidden');
      expect(dialogBody().className).not.toContain('overflow-y-auto');
    });

    /**
     * With no transcript there is nothing to hand the scroll role to, and
     * the body still holds a prompt that can overflow on its own. Handing
     * off unconditionally would make that prompt unreachable.
     */
    it('keeps the body scrollable when expanded with no session at all', () => {
      renderDialog();

      fireEvent.click(expandButton());

      const body = screen
        .getByText('Fix the thing.')
        .closest('[data-slot="dialog-body"]')!;
      expect(body.className).toContain('overflow-y-auto');
      expect(body.className).not.toContain('overflow-hidden');
    });
  });

  /**
   * The expand choice is keyed by cardId in `uiStore`, so each card's dialog
   * remembers its own state independently rather than sharing one flag
   * across every card.
   */
  describe('the choice is independent per card', () => {
    it('opens a different card collapsed, even though another card was expanded', () => {
      act(() => seedSnapshot());
      const first = renderDialog();

      fireEvent.click(expandButton());
      first.unmount();

      const otherCardId = useDocStore
        .getState()
        .addCard(boardId, listId, { title: 'Another card', prompt: 'Do it.' });
      renderDialog(otherCardId);

      expect(expandButton()).toBeInTheDocument();
      expect(dialogContent().className).toContain('sm:max-w-2xl');
    });

    it('remembers a card is expanded when it is reopened, unaffected by other cards', () => {
      act(() => seedSnapshot());
      const first = renderDialog();

      fireEvent.click(expandButton());
      first.unmount();

      const otherCardId = useDocStore
        .getState()
        .addCard(boardId, listId, { title: 'Another card', prompt: 'Do it.' });
      const second = renderDialog(otherCardId);
      second.unmount();

      renderDialog();

      expect(collapseButton()).toBeInTheDocument();
      expect(dialogContent().className).toContain('sm:max-w-[92vw]');
    });
  });
});
