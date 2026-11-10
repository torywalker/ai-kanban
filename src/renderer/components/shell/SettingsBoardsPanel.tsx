import type { Board } from '@shared/schema';
import { BoardSettingsRow } from '@/components/shell/BoardSettingsRow';
import { useDocStore } from '@/store/docStore';

const NO_BOARDS: Board[] = [];

/**
 * Every board in the document, including ones hidden from the sidebar.
 * Unarchive is the way back: archiving never deletes lists or cards.
 */
export function SettingsBoardsPanel() {
  const boards = useDocStore((s) => s.doc?.boards ?? NO_BOARDS);

  if (boards.length === 0) {
    return <p className="text-sm text-muted-foreground">No boards yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {boards.map((board) => (
        <li key={board.id}>
          <BoardSettingsRow board={board} />
        </li>
      ))}
    </ul>
  );
}
