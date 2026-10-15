import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreHorizontal } from 'lucide-react';
import { useDocStore } from '@/store/docStore';

interface Props {
  boardId: string;
  listId: string;
  listName: string;
}

export function ListOptionsMenu({ boardId, listId, listName }: Props) {
  const deleteList = useDocStore((s) => s.deleteList);
  const archiveAllCardsInList = useDocStore((s) => s.archiveAllCardsInList);
  const moveList = useDocStore((s) => s.moveList);
  const lists =
    useDocStore(
      (s) => s.doc?.boards.find((board) => board.id === boardId)?.lists,
    ) ?? [];
  const index = lists.findIndex((list) => list.id === listId);
  const canMoveLeft = index > 0;
  const canMoveRight = index >= 0 && index < lists.length - 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`List options for ${listName}`}
        >
          <MoreHorizontal className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={!canMoveLeft}
          onSelect={() => moveList(boardId, listId, index - 1)}
        >
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canMoveRight}
          onSelect={() => moveList(boardId, listId, index + 1)}
        >
          Move right
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => archiveAllCardsInList(boardId, listId)}
        >
          Archive all cards
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => deleteList(boardId, listId)}>
          Delete list
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
