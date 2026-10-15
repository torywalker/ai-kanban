import { useState, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { MoveCardToBoardDialog } from './MoveCardToBoardDialog';

interface Props {
  boardId: string;
  listId: string;
  cardId: string;
  cardTitle: string;
  children: ReactNode;
}

/**
 * Shared actions a menu item's `onSelect` can reach for. Today that's just
 * opening the move dialog; a future item that needs its own modal (e.g.
 * "Duplicate") would add another opener here rather than each item owning
 * private state.
 */
interface CardMenuActions {
  openMoveDialog: () => void;
}

interface CardMenuItemConfig {
  id: string;
  label: string;
  onSelect: (actions: CardMenuActions) => void;
}

/**
 * The card right-click menu's contents. Adding a future option — Duplicate,
 * Archive, Delete, etc. — is one more entry in this array; nothing else
 * about how the menu is built or wired into `PromptCard` needs to change.
 */
const CARD_CONTEXT_MENU_ITEMS: CardMenuItemConfig[] = [
  {
    id: 'move-to-board',
    label: 'Move to board…',
    onSelect: (actions) => actions.openMoveDialog(),
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

  const actions: CardMenuActions = {
    openMoveDialog: () => setMoveDialogOpen(true),
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
              {item.label}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>

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
