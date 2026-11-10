import type { Board } from '@shared/schema';
import { SHIP_CONFLICT_PROMPT } from '@shared/worktree';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';

const NO_BOARDS: Board[] = [];

/**
 * Every board in the document, including ones hidden from the sidebar.
 * Unarchive is the way back: archiving never deletes lists or cards.
 */
export function SettingsBoardsPanel() {
  const boards = useDocStore((s) => s.doc?.boards ?? NO_BOARDS);
  const unarchiveBoard = useDocStore((s) => s.unarchiveBoard);
  const setShipConflictPrompt = useDocStore(
    (s) => s.setBoardShipConflictPrompt,
  );

  if (boards.length === 0) {
    return <p className="text-sm text-muted-foreground">No boards yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {boards.map((board) => (
        <li
          key={board.id}
          className="flex flex-col gap-2 rounded-md border px-3 py-2"
        >
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">
              {board.name}
            </span>
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
          </div>
          {board.archived ? null : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={`ship-conflict-${board.id}`}
                  className="text-xs text-muted-foreground"
                >
                  Ship merge-conflict prompt
                </label>
                {board.shipConflictPrompt ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Reset ${board.name} conflict prompt`}
                    onClick={() => setShipConflictPrompt(board.id, '')}
                  >
                    Reset to default
                  </Button>
                ) : null}
              </div>
              <Textarea
                id={`ship-conflict-${board.id}`}
                rows={5}
                value={board.shipConflictPrompt ?? SHIP_CONFLICT_PROMPT}
                onChange={(e) =>
                  setShipConflictPrompt(board.id, e.target.value)
                }
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
