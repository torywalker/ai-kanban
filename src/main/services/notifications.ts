import { Notification } from 'electron';

/**
 * Shows an OS-level completion alert. Notification support and delivery are
 * best-effort: a denied OS permission must never affect the completed task.
 */
export default function showTaskFinishedNotification(cardTitle: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({
      title: 'Claude task finished',
      body: cardTitle,
    }).show();
  } catch {
    // Native notifications may be unavailable or denied by the OS.
  }
}
