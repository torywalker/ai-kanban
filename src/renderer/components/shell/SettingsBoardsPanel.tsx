import type { Board } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { ShipConflictPromptEditor } from '@/components/shell/ShipConflictPromptEditor';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { useDocStore } from '@/store/docStore';

const NO_BOARDS: Board[] = [];

/**
 * Every board in the document, including ones hidden from the sidebar.
 * Unarchive is the way back: archiving never deletes lists or cards.
 */
export function SettingsBoardsPanel() {
  const boards = useDocStore((s) => s.doc?.boards ?? NO_BOARDS);
  const unarchiveBoard = useDocStore((s) => s.unarchiveBoard);
  const renameBoard = useDocStore((s) => s.renameBoard);

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
            <InlineEditableText
              value={board.name}
              label={`board name ${board.name}`}
              onCommit={(next) => renameBoard(board.id, next)}
              className="min-w-0 flex-1 text-sm font-medium"
            />
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
            // One entry per board setting; new settings go in this list.
            <div className="flex flex-col gap-1 border-t pt-2">
              <ShipConflictPromptEditor
                boardId={board.id}
                boardName={board.name}
                prompt={board.shipConflictPrompt}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
