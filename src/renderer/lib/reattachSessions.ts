import { useSessionStore } from '@/store/sessionStore';
import { api } from '@/lib/api';

/** Shown while waiting for the daemon's real answer, and matched on later
 * to tell whether the give-up timeout below is still the last word for a
 * card, or a real reply already replaced it. */
const RECONNECTING_PLACEHOLDER = 'Reconnecting to session…';

/**
 * Asks the daemon for the real state of every given card, having first
 * applied an optimistic `interrupted` placeholder for each — the same walk
 * AppShell's reattach effect runs once at launch (see its own comments for
 * the full rationale), now also usable on demand: SettingsDialog's "Restart
 * Daemon" action calls this right after the daemon comes back up, so cards
 * reconnect immediately instead of only on the next app relaunch.
 *
 * Returns a cleanup function that cancels the pending 15s give-up timers —
 * callers that no longer care about the outcome (e.g. an unmounting effect)
 * should call it, but it is optional: a caller that fires this from an
 * event handler rather than an effect can simply ignore the return value.
 */
export function reattachSessions(
  cards: { cardId: string; sessionId: string }[],
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];

  cards.forEach(({ cardId, sessionId }) => {
    // Optimistic placeholder, applied BEFORE asking the daemon: if the
    // daemon (or a freshly-spawned one with no memory of past sessions)
    // never answers this getState call, this is what stays on screen.
    // `interrupted`, not `failed` — this daemon simply has no live record
    // of the card yet; nothing has actually gone wrong, and a reply can
    // still resume the real conversation even if this daemon never answers
    // at all. A real `snapshot` event arriving afterwards fully replaces
    // this (`applySnapshot` is always a whole-entry replace, never a
    // merge), so a daemon that DID survive corrects it immediately.
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId,
      status: 'interrupted',
      checklist: [],
      messages: [],
      pendingApproval: null,
      lastError: RECONNECTING_PLACEHOLDER,
    });
    // Mark BEFORE issuing the query: the reply reports whatever the
    // daemon's record already was (possibly `done` from long before this
    // call), not something that just happened, so it must not be treated
    // as a live transition off the placeholder above (see `markReattaching`
    // in sessionStore.ts for why this exists at all — without it, every
    // already-finished card would chime again on every reattach).
    useSessionStore.getState().markReattaching(cardId);
    void api.session.getState(cardId);
    // A daemon that never answers for this card leaves the placeholder
    // above sitting forever — it reads as "in progress" indefinitely, never
    // as "gave up," even though nothing is actually still happening. This
    // waits comfortably longer than a real daemon cold-start measured
    // elsewhere in this app's own history (`sessionDaemonClient.ts`'s
    // `connectWithRetry`) before concluding the attempt isn't going to
    // resolve on its own — checking the CURRENT snapshot at fire time, not
    // blindly overwriting, so a real reply that arrived in the meantime is
    // never clobbered. Status stays `interrupted`: a reply can still resume
    // the underlying conversation even after this timeout fires.
    timers.push(
      setTimeout(() => {
        const current = useSessionStore.getState().sessions[cardId];
        if (current?.lastError === RECONNECTING_PLACEHOLDER) {
          useSessionStore.getState().applySnapshot({
            ...current,
            lastError:
              'This daemon has no record of the session from before the app closed. Reply to continue the conversation, or click Run again to start fresh.',
          });
        }
      }, 15_000),
    );
  });

  return () => timers.forEach(clearTimeout);
}
