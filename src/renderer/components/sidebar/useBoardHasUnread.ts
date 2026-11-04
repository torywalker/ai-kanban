import { useShallow } from 'zustand/react/shallow';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';

/** True when any card on the board has finished work the user hasn't opened yet. */
export function useBoardHasUnread(boardId: string): boolean {
  const cardIds = useDocStore(
    useShallow((s) => {
    const board = s.doc?.boards.find((b) => b.id === boardId);
    return board?.lists.flatMap((l) => l.cards.map((c) => c.id)) ?? [];
    }),
  );
  return useSessionStore((s) => cardIds.some((id) => s.unread[id] === true));
}
