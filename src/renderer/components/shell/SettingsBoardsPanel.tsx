import type { Board } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { useDocStore } from '@/store/docStore';

const NO_BOARDS: Board[] = [];

/**
 * Every board in the document, including ones hidden from the sidebar.
 * Unarchive is the way back: archiving never deletes lists or cards.
 */
export function SettingsBoardsPanel() {
  const boards = useDocStore((s) => s.doc?.boards ?? NO_BOARDS);
  const unarchiveBoard = useDocStore((s) => s.unarchiveBoard);

  if (boards.length === 0) {
    return <p className="text-sm text-muted-foreground">No boards yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {boards.map((board) => (
        <li
          key={board.id}
          className="flex items-center gap-3 rounded-md border px-3 py-2"
        >
          <span className="min-w-0 flex-1 truncate text-sm">{board.name}</span>
          {board.archived ? (
            <>
              <span className="shrink-0 text-xs text-muted-foreground">
                Archived
              </span>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Unarchive ${board.name}`}
                onClick={() => unarchiveBoard(board.id)}
              >
                Unarchive
              </Button>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
