import { useState } from 'react';
import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useDocStore } from '@/store/docStore';
import { cn } from '@/lib/utils';
import { BoardContextMenu } from './BoardContextMenu';

interface Props {
  boardId: string;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
}

export function SidebarBoardItem({ boardId, dragHandleProps }: Props) {
  const [confirming, setConfirming] = useState(false);
  const board = useDocStore(
    (s) => s.doc?.boards.find((b) => b.id === boardId) ?? null,
  );
  const isActive = useDocStore((s) => s.activeBoardId === boardId);
  const setActiveBoard = useDocStore((s) => s.setActiveBoard);
  const renameBoard = useDocStore((s) => s.renameBoard);
  const deleteBoard = useDocStore((s) => s.deleteBoard);
  const archiveBoard = useDocStore((s) => s.archiveBoard);

  if (!board) return null;

  const cardCount = board.lists.reduce(
    (total, list) => total + list.cards.filter((card) => !card.archived).length,
    0,
  );

  return (
    <BoardContextMenu boardId={boardId}>
      <div
        {...dragHandleProps}
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm',
          isActive ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
        )}
      >
        <div className="min-w-0 flex-1">
          <InlineEditableText
            value={board.name}
            label={`Board: ${board.name}`}
            editOn="doubleClick"
            onActivate={() => setActiveBoard(boardId)}
            onCommit={(next) => renameBoard(boardId, next)}
            className="w-full"
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Board options for ${board.name}`}
            className="opacity-0 transition-opacity group-hover:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => archiveBoard(boardId)}>
              Archive board
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirming(true)}
            >
              Delete board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete "${board.name}"?`}
          body={
            cardCount === 0
              ? 'This board is empty.'
              : `${cardCount} prompt${cardCount === 1 ? '' : 's'} will be deleted. This cannot be undone after you quit.`
          }
          confirmLabel="Delete board"
          onConfirm={() => deleteBoard(boardId)}
        />
      </div>
    </BoardContextMenu>
  );
}
