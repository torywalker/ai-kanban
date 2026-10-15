import { useState, type ReactNode } from 'react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useDocStore } from '@/store/docStore';

interface Props {
  boardId: string;
  children: ReactNode;
}

function deleteBody(cardCount: number): string {
  return cardCount === 0
    ? 'This board is empty.'
    : `${cardCount} prompt${cardCount === 1 ? '' : 's'} will be deleted. This cannot be undone after you quit.`;
}

/**
 * Right-click menu for a board row (expanded sidebar) or its letter button
 * (collapsed rail). Archive hides the board without removing it; delete
 * still asks first, matching the ⋯ menu on the expanded row.
 */
export function BoardContextMenu({ boardId, children }: Props) {
  const [confirming, setConfirming] = useState(false);
  const board = useDocStore(
    (s) => s.doc?.boards.find((b) => b.id === boardId) ?? null,
  );
  const archiveBoard = useDocStore((s) => s.archiveBoard);
  const deleteBoard = useDocStore((s) => s.deleteBoard);

  if (!board) return children;

  const cardCount = board.lists.reduce(
    (total, list) => total + list.cards.filter((card) => !card.archived).length,
    0,
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => archiveBoard(boardId)}>
            Archive board
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => setConfirming(true)}
          >
            Delete board
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete "${board.name}"?`}
        body={deleteBody(cardCount)}
        confirmLabel="Delete board"
        onConfirm={() => deleteBoard(boardId)}
      />
    </>
  );
}
