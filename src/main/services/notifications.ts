import { Notification } from 'electron';

// Electron may garbage-collect a Notification with no live reference, which
// silently drops its click handler. Hold each one until it is dismissed.
const live = new Set<Notification>();

// Mirrors the renderer's mute toggle (the top-right bell). Main fires some
// notifications on its own (build status), so it must know about mute too.
let muted = false;
export function setNotificationsMuted(value: boolean): void {
  muted = value;
}

/**
 * Shows an OS-level completion alert. Notification support and delivery are
 * best-effort: a denied OS permission must never affect the completed task.
 */
export default function showTaskFinishedNotification(
  cardTitle: string,
  onClick?: () => void,
): void {
  try {
    if (muted || !Notification.isSupported()) return;
    const notification = new Notification({
      title: 'Claude task finished',
      body: cardTitle,
    });
    live.add(notification);
    const release = () => live.delete(notification);
    notification.on('close', release);
    notification.on('click', () => {
      release();
      onClick?.();
    });
    notification.show();
  } catch {
    // Native notifications may be unavailable or denied by the OS.
  }
}

/** Build-status alert; best-effort for the same reasons as above. */
export function showBuildNotification(title: string, body: string): void {
  try {
    if (muted || !Notification.isSupported()) return;
    new Notification({ title, body }).show();
  } catch {
    // Native notifications may be unavailable or denied by the OS.
  }
}
