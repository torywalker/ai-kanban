import { randomUUID } from 'crypto';
import type {
  SessionSnapshot,
  TranscriptImageRef,
  TranscriptMessage,
} from '@shared/daemonProtocol';

/**
 * Pure decision helpers for the daemon's per-card turn lifecycle, extracted
 * from `index.ts` for the same reason `approvalDecisions.ts` was: the
 * surrounding handler code can only be exercised with a live SDK
 * subprocess and a real unix socket, while the decisions themselves are
 * plain data transforms that deserve real tests.
 */

export const TURN_IN_PROGRESS_ERROR =
  'A turn is already in progress for this card.';

export const HYDRATED_MID_TURN_ERROR =
  'The previous session was interrupted mid-turn. Reply to continue, or click Run again to start fresh.';

export const STOPPED_BY_USER_ERROR = 'Stopped by user';

/** The per-card turn bookkeeping the daemon tracks alongside a snapshot. */
export interface TurnFlags {
  /**
   * True from just before a turn enters the SDK until that turn finishes,
   * fails, or is stopped.
   */
  turnActive: boolean;
  /**
   * True once the user has stopped the card's session. The aborted turn may
   * still be winding down and yielding messages; those writes must not
   * overwrite the explicit terminal "Stopped by user" state.
   */
  stopped: boolean;
}

/**
 * Whether a `run`/`reply` may start a new turn for this card.
 *
 * Starting a second turn while one is still streaming corrupts state two
 * ways: two concurrent `query()` calls interleave checklist/status updates
 * into the same snapshot slot (the newer one's `result` can flip status to
 * `done` while the older is still working), and replacing the map entry
 * orphans the previous turn's `pendingApprovalResolve`, so an SDK
 * subprocess waiting on a tool approval hangs forever inside a daemon that
 * nothing supervises.
 */
export function canStartTurn(flags: TurnFlags | null | undefined): boolean {
  return flags?.turnActive !== true;
}

/**
 * The snapshot to show when a `run`/`reply` is refused because a turn is
 * already live. Deliberately touches ONLY `lastError` — the in-flight turn's
 * own status, checklist and pending approval must be left exactly as they
 * are.
 */
export function rejectTurnSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  return { ...snapshot, lastError: TURN_IN_PROGRESS_ERROR };
}

/**
 * Appends the user's own reply text to the transcript as a `user`-kind
 * message, using the same shared counter `deriveSessionUpdate.ts` draws its
 * `seq` values from (checklist length + messages length) — so the user's
 * message and the agent's subsequent tool calls/text interleave in the same
 * chronological feed the View dialog renders, instead of the text simply
 * vanishing from the UI the moment it's sent (it was never recorded
 * anywhere before this, client or server side).
 *
 * Any images the reply carried are stamped on as path-free references so
 * the View dialog can show thumbnails on that turn. Set only when there
 * are some: an absent key (rather than an empty array) is what keeps
 * snapshots cached by earlier builds indistinguishable from new ones.
 */
function appendUserMessage(
  snapshot: SessionSnapshot,
  text: string,
  images?: TranscriptImageRef[],
): SessionSnapshot {
  const message: TranscriptMessage = {
    id: `user:${randomUUID()}`,
    kind: 'user',
    text,
    seq: snapshot.checklist.length + snapshot.messages.length,
  };
  if (images && images.length > 0) message.images = images;
  return { ...snapshot, messages: [...snapshot.messages, message] };
}

/**
 * The snapshot a turn starts from.
 *
 * A `reply` continues the existing conversation, so it keeps the checklist
 * and transcript built up so far, and records the reply text itself as a
 * `user`-kind transcript message (this is also what gets it persisted —
 * every snapshot change is written to the disk cache). A genuinely new
 * `run` ("Run again" on a card that already finished or failed) must NOT
 * carry anything forward: carrying the previous snapshot forward wholesale
 * showed a stale checklist/transcript from the prior run, and could even
 * resurrect a `pendingApproval` box belonging to a session that had already
 * ended. A fresh run's own prompt is not recorded as a transcript message —
 * it's already shown persistently in the card's prompt field above the
 * transcript, so doing so would just duplicate it.
 */
export function startTurnSnapshot(
  previous: SessionSnapshot,
  kind: 'run' | 'reply',
  replyText?: string,
  replyImages?: TranscriptImageRef[],
): SessionSnapshot {
  // `liveUsage: {}` on BOTH paths: the live figure is scoped to the turn in
  // flight, so a reply must start its own count from zero rather than
  // inheriting the previous turn's — those tokens are already in the ledger.
  const base = {
    ...previous,
    status: 'working' as const,
    lastError: null,
    liveUsage: {},
  };
  if (kind === 'run')
    return { ...base, checklist: [], messages: [], pendingApproval: null };
  return replyText ? appendUserMessage(base, replyText, replyImages) : base;
}

/**
 * A snapshot hydrated from the disk cache onto a fresh daemon has no live
 * turn behind it, no matter what its own `status` says — if it was cached
 * mid-turn (`working`/`waiting`), the turn it belonged to died along with
 * whatever daemon was running it, and nothing will ever move it off that
 * status again on its own. Left as-is, the UI would show a spinner (or a
 * stale, unresolvable approval box) for a turn that can never finish.
 * Anything already terminal (`done`/`failed`/`interrupted`) is left
 * completely untouched — those are legitimately accurate as cached.
 */
export function normalizeHydratedSnapshot(
  cached: SessionSnapshot,
): SessionSnapshot {
  if (cached.status !== 'working' && cached.status !== 'waiting') return cached;
  return {
    ...cached,
    status: 'interrupted',
    pendingApproval: null,
    lastError: HYDRATED_MID_TURN_ERROR,
  };
}

/**
 * The terminal snapshot `stop` writes.
 *
 * Written unconditionally rather than left to the SDK: if the SDK's async
 * iterator ends cleanly on abort instead of throwing, nothing else would
 * ever move the card off `working`, leaving a spinner that never stops and
 * a Run button that never re-enables. Reuses the existing `failed` status
 * rather than adding a new enum value every status-keyed UI map would have
 * to learn.
 */
export function stopSnapshot(previous: SessionSnapshot): SessionSnapshot {
  return {
    ...previous,
    status: 'failed',
    lastError: STOPPED_BY_USER_ERROR,
    pendingApproval: null,
  };
}

/**
 * How a turn ended, as reported by the LAST `result` message the SDK
 * yielded before its stream closed (or by the exception that ended it).
 */
export type TurnOutcome =
  | { kind: 'success' }
  | { kind: 'error'; message: string };

/**
 * The outcome a `result` message reports, or `null` for any other message.
 *
 * Every result overwrites the previous one rather than the first winning:
 * one `query()` call can yield several, and only the last one describes how
 * the turn actually came out. The SDK says the same thing about the usage
 * these messages carry ("each result carries the running total so far, so
 * read the latest result rather than summing across results").
 */
export function turnOutcomeFromMessage(message: {
  type: string;
  subtype?: string;
}): TurnOutcome | null {
  if (message.type !== 'result') return null;
  if (message.subtype === 'success') return { kind: 'success' };
  return { kind: 'error', message: message.subtype ?? 'unknown error' };
}

/**
 * The terminal snapshot for a turn whose SDK stream has now closed.
 *
 * This is the ONLY place a turn reaches `done`/`failed`, and it runs after
 * the message loop rather than inside it — see `deriveSessionUpdate`'s
 * `result` branch for why a `result` message cannot be trusted to be the
 * last word. Once the iterator is exhausted the SDK subprocess is gone, so
 * "no more messages are coming" is a fact here rather than a guess.
 *
 * A stream that closed without ever yielding a result (`null`) settles as
 * `done`: nothing reported a failure, and the alternative — leaving the
 * card `working` — is the permanent spinner this function exists to
 * prevent. Any pending approval goes with it: the subprocess that asked
 * the question no longer exists, so its box can never be answered, and
 * leaving it on screen invites a click that resolves nothing.
 */
export function settleTurnSnapshot(
  snapshot: SessionSnapshot,
  outcome: TurnOutcome | null,
): SessionSnapshot {
  const settled = { ...snapshot, pendingApproval: null };
  if (!outcome || outcome.kind === 'success') {
    return { ...settled, status: 'done', lastError: null };
  }
  return { ...settled, status: 'failed', lastError: outcome.message };
}

/**
 * Which session id, if any, a `reply` should ask the SDK to `resume`.
 *
 * The daemon's own live in-memory record is preferred when it exists — it
 * is guaranteed current for an active or just-finished turn. The caller's
 * PERSISTED `card.sessionId` is the fallback, used only when this daemon
 * has no live record for the card at all (a fresh daemon after a crash, or
 * the app relaunching after the previous daemon was killed). That fallback
 * is what lets a reply resume the real Claude conversation across that
 * gap — the SDK's own on-disk session persistence carries it, independent
 * of anything this daemon remembers.
 */
export function resolveResumeSessionId(
  liveSessionId: string | null | undefined,
  persistedSessionId: string | null,
): string | undefined {
  return liveSessionId ?? persistedSessionId ?? undefined;
}

/**
 * Whether a snapshot write coming from a running turn should be applied.
 *
 * `isOwningTurn` is the caller's identity check (the map entry's
 * `abortController` is still the one this turn created). A write is dropped
 * when the entry has since been taken over by a newer turn, or when the
 * session was stopped and this is the old turn winding down.
 */
export function shouldApplyTurnWrite(
  flags: TurnFlags | null | undefined,
  isOwningTurn: boolean,
): boolean {
  if (!flags || !isOwningTurn) return false;
  return !flags.stopped;
}
