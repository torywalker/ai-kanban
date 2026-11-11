import { useState, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useConfirm } from '@/components/common/useConfirm';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { CardComposerDialog } from './CardComposerDialog';
import { MoveCardToBoardDialog } from './MoveCardToBoardDialog';

interface Props {
  boardId: string;
  listId: string;
  cardId: string;
  cardTitle: string;
  children: ReactNode;
}

/**
 * Shared actions a menu item's `onSelect` can reach for. Today that's
 * opening the move dialog and toggling archive state; a future item that
 * needs its own modal (e.g. "Duplicate") would add another opener here
 * rather than each item owning private state.
 */
interface CardMenuActions {
  archived: boolean;
  paused: boolean;
  openEditDialog: () => void;
  togglePaused: () => void;
  markUnread: () => void;
  openMoveDialog: () => void;
  toggleArchived: () => void;
}

interface CardMenuItemConfig {
  id: string;
  label: (actions: CardMenuActions) => string;
  onSelect: (actions: CardMenuActions) => void;
}

/**
 * The card right-click menu's contents. Adding a future option — Duplicate,
 * Delete, etc. — is one more entry in this array; nothing else about how
 * the menu is built or wired into `PromptCard` needs to change.
 */
const CARD_CONTEXT_MENU_ITEMS: CardMenuItemConfig[] = [
  {
    id: 'edit',
    label: () => 'Edit',
    onSelect: (actions) => actions.openEditDialog(),
  },
  {
    id: 'pause',
    label: (actions) => (actions.paused ? 'Resume' : 'Pause'),
    onSelect: (actions) => actions.togglePaused(),
  },
  {
    id: 'mark-unread',
    label: () => 'Mark unread',
    onSelect: (actions) => actions.markUnread(),
  },
  {
    id: 'move-to-board',
    label: () => 'Move to board…',
    onSelect: (actions) => actions.openMoveDialog(),
  },
  {
    id: 'archive',
    label: (actions) => (actions.archived ? 'Unarchive' : 'Archive'),
    onSelect: (actions) => actions.toggleArchived(),
  },
];

/**
 * Wraps a card's rendered content (`children`) so right-clicking it opens
 * an extensible menu instead of doing nothing. `asChild` on the trigger
 * means this adds only a `contextmenu` listener — it doesn't add a wrapper
 * element, so it composes cleanly around `PromptCard`'s own
 * `Draggable`-provided root div.
 */
export function CardContextMenu({
  boardId,
  listId,
  cardId,
  cardTitle,
  children,
}: Props) {
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const { confirm, dialog: archiveDialog } = useConfirm();
  const card = useDocStore((s) =>
    s.doc?.boards
      .find((b) => b.id === boardId)
      ?.lists.find((l) => l.id === listId)
      ?.cards.find((c) => c.id === cardId),
  );
  const archived = card?.archived ?? false;
  const paused = card?.paused === true;
  const updateCard = useDocStore((s) => s.updateCard);
  const markUnread = useSessionStore((s) => s.markUnread);
  const archiveCard = useDocStore((s) => s.archiveCard);
  const unarchiveCard = useDocStore((s) => s.unarchiveCard);

  const actions: CardMenuActions = {
    archived,
    paused,
    openEditDialog: () => setEditOpen(true),
    togglePaused: () =>
      updateCard(boardId, listId, cardId, { paused: !paused }),
    markUnread: () => markUnread(cardId),
    openMoveDialog: () => setMoveDialogOpen(true),
    toggleArchived: () => {
      if (archived) {
        unarchiveCard(boardId, listId, cardId);
        return;
      }
      confirm({
        title: `Archive "${cardTitle}"?`,
        body: 'The card is hidden from the board. You can restore it from the archived view.',
        confirmLabel: 'Archive',
        onConfirm: () => archiveCard(boardId, listId, cardId),
      });
    },
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          {CARD_CONTEXT_MENU_ITEMS.map((item) => (
            <ContextMenuItem
              key={item.id}
              onSelect={() => item.onSelect(actions)}
            >
              {item.label(actions)}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>

      {archiveDialog}
      <CardComposerDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />
      <MoveCardToBoardDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        cardId={cardId}
        cardTitle={cardTitle}
        fromBoardId={boardId}
        fromListId={listId}
      />
    </>
  );
}
