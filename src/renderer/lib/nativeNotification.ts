import { api } from '@/lib/api';
import { useDocStore } from '@/store/docStore';

function cardTitle(cardId: string): string {
  const { doc } = useDocStore.getState();
  const card = doc?.boards
    .flatMap((board) => board.lists)
    .flatMap((list) => list.cards)
    .find((candidate) => candidate.id === cardId);
  return card?.title.trim() || 'A Claude task';
}

/**
 * Requests a native notification through Electron's main process. The IPC
 * call is intentionally fire-and-forget so notification failures cannot
 * affect session state.
 */
export default function showTaskFinishedNotification(cardId: string): void {
  api.notifications.taskFinished(cardTitle(cardId)).catch(() => {
    // Notification delivery is best-effort and controlled by the OS.
  });
}
