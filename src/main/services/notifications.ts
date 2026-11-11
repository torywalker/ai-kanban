import { Notification } from 'electron';

/**
 * Shows an OS-level completion alert. Notification support and delivery are
 * best-effort: a denied OS permission must never affect the completed task.
 */
export default function showTaskFinishedNotification(
  cardTitle: string,
  onClick?: () => void,
): void {
  try {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Claude task finished',
      body: cardTitle,
    });
    if (onClick) notification.on('click', onClick);
    notification.show();
  } catch {
    // Native notifications may be unavailable or denied by the OS.
  }
}

/** Build-status alert; best-effort for the same reasons as above. */
export function showBuildNotification(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch {
    // Native notifications may be unavailable or denied by the OS.
  }
}
