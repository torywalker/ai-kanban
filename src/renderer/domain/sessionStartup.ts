import type { SessionSnapshot, TranscriptMessage } from '@shared/daemonProtocol';

/**
 * Which "nothing has come back yet" notice the transcript should show, if
 * any. `starting` is the window before the SDK has reported a session id —
 * the daemon may still be spawning — and `awaiting-response` is the one
 * after, where the session is live but has produced no output.
 */
export type StartupNotice = 'starting' | 'awaiting-response';

/**
 * A live turn that has yet to produce anything is the one state the feed
 * cannot render on its own: `working` with an empty tail reads as a blank
 * panel, which is indistinguishable from a card that did nothing at all.
 *
 * Scoped to output that follows the newest user message, not to output
 * existing anywhere: on a reply the previous turn's answer is still in the
 * feed, and counting it would suppress the notice for exactly the wait it
 * exists to cover.
 */
export function startupNotice(snapshot: SessionSnapshot): StartupNotice | null {
  if (snapshot.status !== 'working') return null;

  const turnStartSeq = snapshot.messages.reduce(
    (latest, message) =>
      message.kind === 'user' ? Math.max(latest, message.seq) : latest,
    -1,
  );
  const answered =
    snapshot.messages.some(
      (message) => message.kind !== 'user' && message.seq > turnStartSeq,
    ) || snapshot.checklist.some((item) => item.seq > turnStartSeq);
  if (answered) return null;

  return snapshot.sessionId ? 'awaiting-response' : 'starting';
}

/**
 * The snapshot to write locally the instant a run is dispatched.
 *
 * `api.session.run` is fire-and-forget: the first snapshot the daemon
 * broadcasts cannot arrive until it has spawned, connected and entered the
 * SDK, and until then the card has no session entry at all — so the
 * transcript renders nothing and Run looks inert. Writing this one puts the
 * panel (and its startup notice) on screen immediately, exactly as
 * `reportFailure` and AppShell's reattach placeholder already synthesize
 * snapshots the daemon has not sent. Snapshot writes are whole-entry
 * replacements, so the daemon's own first broadcast overwrites this
 * wholesale — including correcting it back to a stale conversation if the
 * daemon refuses the turn.
 *
 * Deliberately carries no session id even when the card has one persisted:
 * `run` starts a fresh conversation rather than resuming, so borrowing the
 * old id would skip the `starting` phase on every Run again.
 */
export function pendingRunSnapshot(cardId: string): SessionSnapshot {
  return {
    cardId,
    sessionId: null,
    status: 'working',
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
    liveUsage: {},
  };
}

/**
 * The same idea for a reply, which keeps the conversation built up so far
 * and appends the user's text as a `user` entry — the daemon does exactly
 * this when the turn starts (`startTurnSnapshot`), and it is what marks the
 * boundary the startup notice measures "this turn's output" from. Without
 * the entry, the previous turn's answer reads as this turn's, and the wait
 * shows nothing.
 *
 * `seq` mirrors the daemon's shared counter so the entry sorts where the
 * daemon's own echo of it will land.
 */
export function pendingReplySnapshot(
  previous: SessionSnapshot,
  text: string,
): SessionSnapshot {
  const message: TranscriptMessage = {
    // Distinct from the daemon's `user:<uuid>` ids, so the echo that
    // replaces this one can never be mistaken for a second message.
    id: 'user:pending',
    kind: 'user',
    text,
    seq: previous.checklist.length + previous.messages.length,
  };
  return {
    ...previous,
    status: 'working',
    lastError: null,
    liveUsage: {},
    messages: [...previous.messages, message],
  };
}
