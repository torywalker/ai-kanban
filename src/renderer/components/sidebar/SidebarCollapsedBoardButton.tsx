import { useDocStore } from '@/store/docStore';
import { selectBoardName } from '@/store/selectors';
import { Button } from '@/components/ui/button';
import { BoardContextMenu } from './BoardContextMenu';

interface Props {
  boardId: string;
}

/**
 * Compact stand-in for a board row when the sidebar is collapsed to its
 * narrow rail: a single letter rather than the full name, so several boards
 * can still be switched between without expanding back out.
 */
export function SidebarCollapsedBoardButton({ boardId }: Props) {
  const name = useDocStore(selectBoardName(boardId));
  const isActive = useDocStore((s) => s.activeBoardId === boardId);
  const setActiveBoard = useDocStore((s) => s.setActiveBoard);
  // `.charAt(0)` grabs a single UTF-16 code unit, which splits any board
  // name starting with an emoji outside the Basic Multilingual Plane (e.g.
  // 🧠, 🤖) into a lone surrogate half -- rendered as a broken
  // replacement-character glyph. Iterating the string spreads by Unicode
  // code point instead, so the first "character" is always the whole
  // emoji (or the whole plain letter, unaffected either way).
  const initial = [...name.trim()][0]?.toUpperCase() ?? '';

  return (
    <BoardContextMenu boardId={boardId}>
      <Button
        size="icon-sm"
        variant={isActive ? 'secondary' : 'ghost'}
        aria-label={`Switch to board: ${name}`}
        aria-pressed={isActive}
        title={name}
        onClick={() => setActiveBoard(boardId)}
      >
        {initial}
      </Button>
    </BoardContextMenu>
  );
}
