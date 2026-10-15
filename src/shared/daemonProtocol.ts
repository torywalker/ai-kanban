// Type-only, so nothing from `attachments.ts` (zod included) is pulled into
// the daemon bundle at runtime — this module is shared by the renderer, the
// main process and the daemon, and only the daemon's bundle is size-tuned.
import type { AllowedImageMime } from './attachments';

/**
 * `interrupted` is distinct from `failed`: it means "this daemon has no
 * live record of the card's session" (after a relaunch, or a daemon that
 * crashed and was replaced) — not that anything actually went wrong. The
 * underlying Claude conversation is usually still resumable via a reply
 * (see `resolveResumeSessionId` in `turnLifecycle.ts`), so this must never
 * be styled or worded like a dead end the way a genuine `failed` is.
 */
export type SessionStatus =
  | 'working'
  | 'waiting'
  | 'done'
  | 'failed'
  | 'interrupted';

/**
 * 'ask' is the SDK's `permissionMode: 'default'` — every tool call reaches
 * `canUseTool` and waits on the user. 'auto' ("Smart auto") is the SDK's
 * real `permissionMode: 'auto'` — the same hosted model classifier the
 * Claude CLI's own Auto Mode uses decides almost every call directly.
 * Verified live to auto-approve even destructive/outbound calls (a real
 * `rm`, a read outside the working directory, an outbound `curl`) with
 * `canUseTool` never invoked; only a small fixed set of always-interactive
 * cases (`AskUserQuestion`, certain MCP/connector tools) still reach it —
 * see `permissionConfig.ts`. That means the `waiting`/`pendingApproval`
 * Approve/Deny surface will rarely appear while 'auto' is selected — a
 * deliberate tradeoff, adopted on explicit user direction to match the real
 * CLI's behavior rather than a safer approximation of it. Global-only by
 * design: no per-card override, so this never needs threading through
 * `Card`/`Board` fields the way `sessionRepo`/`defaultRepo` are.
 */
export type ApprovalMode = 'ask' | 'auto';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
  /** Insertion order, shared with `TranscriptMessage.seq`, so the View
   * dialog can render tool calls and assistant text as one chronological
   * feed instead of two separately-ordered lists. */
  seq: number;
}

/**
 * One image a turn carries into the model, as main hands it to the daemon.
 *
 * `path` is absolute and resolved by main from the card's assets folder —
 * the daemon reads the bytes itself rather than having them serialised
 * through the socket, so a 5 MB screenshot never rides in a JSON frame.
 * `cardId`/`id` travel alongside purely so the daemon can record a
 * path-free reference on the user's transcript entry (see
 * {@link TranscriptImageRef}); they are not used to locate the file.
 */
export interface DaemonImage {
  path: string;
  mimeType: AllowedImageMime;
  filename: string;
  cardId: string;
  id: string;
}

/**
 * What a user transcript entry remembers about an image it was sent with:
 * everything needed to ask main for a preview later, and deliberately NOT
 * the absolute path. Snapshots are cached to disk and broadcast to the
 * renderer, and a filesystem path belongs in neither.
 */
export interface TranscriptImageRef {
  filename: string;
  mimeType: AllowedImageMime;
  cardId: string;
  id: string;
}

/**
 * An assistant text/thinking block, or the user's own reply text, captured
 * so the View dialog can show a full back-and-forth — not just what the
 * agent said or which tools it called. `id` is the SDK's own
 * per-content-block message `uuid` for `text`/`thinking` (those blocks have
 * no id of their own the way `tool_use` blocks do), so a resent/duplicated
 * event dedupes the same way checklist items already do; `user` entries are
 * synthesized by the daemon itself when a turn starts (see
 * `turnLifecycle.ts`'s `startTurnSnapshot`), so they carry a daemon-minted id
 * instead.
 */
export interface TranscriptMessage {
  id: string;
  kind: 'text' | 'thinking' | 'user';
  text: string;
  seq: number;
  /**
   * Only ever set on a `user` entry, and only when that turn actually
   * carried images. Absent (not empty) otherwise, so snapshots cached by a
   * build predating this field hydrate and render exactly as they do today.
   */
  images?: TranscriptImageRef[];
}

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
}

/**
 * Token counts for one API request within the turn in flight. No cost field,
 * deliberately: the SDK computes `costUSD` only on a turn's `result`
 * message, and inventing a price here would mean maintaining a local rate
 * table that goes stale the moment Anthropic changes rates.
 */
export interface LiveTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface SessionSnapshot {
  cardId: string;
  sessionId: string | null;
  status: SessionStatus;
  checklist: ChecklistItem[];
  messages: TranscriptMessage[];
  pendingApproval: PendingApproval | null;
  lastError: string | null;
  /**
   * Tokens spent by the turn currently in flight, keyed by the API request
   * (`message.id`) that reported them — several assistant messages share one
   * id and each restates that request's running total, so keyed storage
   * counts each request once where summing messages would multiply it by its
   * content-block count.
   *
   * Cleared when the turn ends: from that moment the turn's authoritative
   * numbers live in the usage ledger, and leaving this set would show them
   * twice. Optional because snapshots cached by a build predating this field
   * hydrate without it (the cache is deliberately unvalidated).
   */
  liveUsage?: Record<string, LiveTokenUsage>;
}

export type DaemonRequest =
  | {
      op: 'run';
      cardId: string;
      prompt: string;
      cwd: string;
      approvalMode: ApprovalMode;
      model: string | null;
      /**
       * The card's own attachments. Omitted/empty keeps the turn on the
       * plain string prompt the SDK has always been given — see
       * `queryPrompt.ts`.
       */
      images?: DaemonImage[];
    }
  // `cwd` is required on `reply`, not just `run`: a follow-up turn re-enters
  // the SDK through a fresh `query()` call, so without an explicit working
  // directory the SDK would fall back to `process.cwd()` — the detached
  // daemon's own inherited directory — and run Write/Edit/Bash against the
  // wrong repo entirely.
  //
  // `sessionId` is the CALLER's persisted `card.sessionId` — used only as a
  // fallback `resume` target when the daemon has no live in-memory record
  // for this card (a fresh daemon after the previous one died or the app
  // relaunched). A daemon that DOES still have a live/finished session for
  // this card in memory prefers its own record instead, since that one is
  // guaranteed current; this is purely for reconnecting a conversation the
  // daemon itself has already forgotten. The transcript/checklist shown in
  // the UI still starts empty in that case — only the underlying Claude
  // conversation (persisted by the SDK itself, independent of this
  // daemon's in-memory bookkeeping) actually resumes.
  | {
      op: 'reply';
      cardId: string;
      text: string;
      cwd: string;
      approvalMode: ApprovalMode;
      model: string | null;
      sessionId: string | null;
      /**
       * This reply's OWN images only. The card's attachments are not
       * resent on follow-up turns: the model already saw them on the
       * `run`, and re-uploading them every message would re-bill the same
       * bytes for the rest of the conversation.
       */
      images?: DaemonImage[];
    }
  | {
      op: 'approve';
      cardId: string;
      requestId: string;
      decision: 'allow' | 'deny';
      message?: string;
      /**
       * Only meaningful for an `AskUserQuestion` approval: the user's
       * answers, keyed by each question's own `question` text
       * (multi-select as an array of the chosen labels) — the exact shape
       * the SDK requires back as `updatedInput.answers`. Ignored for
       * `decision: 'deny'` and for an ordinary tool's approval. See
       * `computeApprovalResolution` in `approvalDecisions.ts`.
       */
      answers?: Record<string, string | string[]>;
    }
  | { op: 'stop'; cardId: string }
  | { op: 'getState'; cardId: string }
  | { op: 'ping' };

/**
 * The daemon always emits the FULL current snapshot on any change, never an
 * incremental delta — the same "whole document, not a diff" philosophy this
 * app's own data file already uses. Simpler consumer logic (replace, don't
 * merge) at the cost of resending the checklist on every change; the payload
 * is small enough that this is free.
 */
export type DaemonEvent =
  | { event: 'snapshot'; snapshot: SessionSnapshot }
  /**
   * `buildId` is the content hash of the daemon bundle this process is
   * running (see `daemonIdentity.ts`). It is how the app detects that the
   * daemon still listening on the socket predates the current build — the
   * daemon is detached and reused across app restarts, so without this
   * check a rebuilt daemon silently never takes effect. Optional because a
   * daemon built before the handshake existed answers without it, which is
   * itself the signal to replace it.
   */
  | {
      event: 'pong';
      buildId?: string;
      /**
       * How many cards have a turn in flight right now. The app refuses to
       * evict a stale daemon while this is above zero: in development the
       * bundle is rebuilt on every source edit, so the build id stops
       * matching constantly — including mid-session — and replacing the
       * daemon then would destroy a turn whose tokens are already spent.
       * Absent from builds that predate the field, which reads as idle.
       */
      activeTurns?: number;
    };
