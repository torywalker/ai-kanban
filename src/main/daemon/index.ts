import net from 'net';
import fs from 'fs';
// `@anthropic-ai/claude-agent-sdk` publishes as an ESM-only package
// ("type": "module", main: sdk.mjs). This repo's tsconfig uses
// `module: node16`, and this file has no package.json "type": "module"
// nearby, so TypeScript treats it as CommonJS and refuses a static
// `import` of an ESM-only package (TS1479/TS1541) even though webpack's
// bundler would happily splice the two together. A dynamic `import()` for
// the runtime value, plus a `resolution-mode` attribute on the type-only
// import, are the two ways TS lets a CJS file reach into an ESM-only one.
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import { createFrameDecoder, encodeFrame } from './framing';
import {
  createInitialSnapshot,
  deriveSessionUpdate,
} from './deriveSessionUpdate';
import {
  computeApprovalResolution,
  computeStopResolution,
} from './approvalDecisions';
import { buildSessionPermissionOptions } from './permissionConfig';
import {
  buildQueryPrompt,
  singleUserMessageStream,
  transcriptImagesFrom,
} from './queryPrompt';
import {
  cacheDirFor,
  readCachedSnapshot,
  writeCachedSnapshot,
} from './sessionCache';
import { buildUsageEntries } from './usageEntry';
import { appendUsageEntries, usageLedgerPathFor } from './usageLedger';
import {
  computeBuildId,
  pidFilePathFor,
  writeDaemonPid,
} from './daemonIdentity';
import {
  canStartTurn,
  normalizeHydratedSnapshot,
  rejectTurnSnapshot,
  resolveResumeSessionId,
  settleTurnSnapshot,
  shouldApplyTurnWrite,
  startTurnSnapshot,
  stopSnapshot,
  turnOutcomeFromMessage,
  type TurnOutcome,
} from './turnLifecycle';
import type {
  DaemonImage,
  DaemonRequest,
  DaemonEvent,
  SessionSnapshot,
  ApprovalMode,
} from '@shared/daemonProtocol';

// Last-resort backstop. Nothing supervises this process: it is spawned
// detached and unref()'d specifically so it outlives the Electron app, so an
// unhandled exception anywhere would silently take every live session with
// it. Log and keep running instead — a wedged session is recoverable from
// the UI, a dead daemon is not.
process.on('uncaughtException', (error) => {
  // eslint-disable-next-line no-console
  console.error('daemon: uncaught exception', error);
});
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('daemon: unhandled rejection', reason);
});

const socketPath = process.argv[2];
if (!socketPath) {
  // eslint-disable-next-line no-console
  console.error('daemon: no socket path given (expected argv[2])');
  process.exit(1);
}

// A stale socket file from a previous run that did not exit cleanly would
// otherwise make `net.createServer().listen()` fail with EADDRINUSE.
if (fs.existsSync(socketPath)) {
  fs.unlinkSync(socketPath);
}

const cacheDir = cacheDirFor(socketPath);
const usageLedgerPath = usageLedgerPathFor(socketPath);

/**
 * This process hashes its OWN bundle (argv[1] is the path it was launched
 * with) so the app can tell whether the daemon answering the socket was
 * built from the current code. Computed once at startup rather than per
 * ping: the file cannot change underneath a running process in any way that
 * would alter the code already loaded into it.
 */
const buildId = computeBuildId(process.argv[1]);

// Recorded so the app can SIGTERM this process when the build no longer
// matches. The handler installed at the bottom of this file is what makes
// that a clean shutdown.
writeDaemonPid(pidFilePathFor(socketPath), process.pid);

interface Session {
  snapshot: SessionSnapshot;
  abortController: AbortController;
  pendingApprovalResolve: ((decision: PermissionResult | null) => void) | null;
  // See turnLifecycle.ts for what these two guard against.
  turnActive: boolean;
  stopped: boolean;
}

const sessions = new Map<string, Session>();
const sockets = new Set<net.Socket>();

/** Monotonic tie-breaker for approval `requestId`s — see `canUseTool` below. */
let approvalSeq = 0;

function broadcast(event: DaemonEvent): void {
  const frame = encodeFrame(event);
  sockets.forEach((socket) => socket.write(frame));
}

function updateSnapshot(
  cardId: string,
  updater: (snapshot: SessionSnapshot) => SessionSnapshot,
): void {
  const session = sessions.get(cardId);
  if (!session) return;
  session.snapshot = updater(session.snapshot);
  broadcast({ event: 'snapshot', snapshot: session.snapshot });
  writeCachedSnapshot(cacheDir, session.snapshot);
}

/**
 * Looks up a card's in-memory session, falling back to disk-cached state
 * for a card this daemon has no live record of at all — a fresh daemon
 * after a crash, or the app relaunching once the previous daemon was
 * killed. The hydrated entry is inert (no real turn is active, nothing to
 * abort or resolve) until a genuine `run`/`reply` starts one; it exists
 * purely so `getState` and a resumed `reply` have real prior
 * checklist/transcript to build on instead of nothing.
 */
function getOrHydrateSession(cardId: string): Session | undefined {
  const existing = sessions.get(cardId);
  if (existing) return existing;
  const cached = readCachedSnapshot(cacheDir, cardId);
  if (!cached) return undefined;
  const hydrated: Session = {
    snapshot: normalizeHydratedSnapshot(cached),
    abortController: new AbortController(),
    pendingApprovalResolve: null,
    turnActive: false,
    stopped: false,
  };
  sessions.set(cardId, hydrated);
  return hydrated;
}

/**
 * Runs one turn (a fresh conversation, or a reply into an existing one via
 * `resume`) to completion, folding every yielded message into the card's
 * snapshot as it arrives. This is a fire-and-forget async function — the
 * socket handler below calls it and returns immediately; progress is
 * reported entirely through `broadcast`.
 */
async function runTurn(
  cardId: string,
  prompt: string,
  // `cwd` is required, not optional: leaving it off meant the SDK silently
  // defaulted to `process.cwd()` — this detached daemon's own inherited
  // directory — and ran Write/Edit/Bash against the wrong repo. Making it
  // mandatory turns any missing working directory into a compile error
  // instead of a silent `undefined`.
  options: {
    kind: 'run' | 'reply';
    cwd: string;
    resume?: string;
    approvalMode: ApprovalMode;
    model: string | null;
    /**
     * Images this turn carries, already resolved to absolute paths by main.
     * Only the SDK prompt changes shape for them — `prompt` above stays the
     * plain text that gets recorded on the card and in the transcript.
     */
    images?: DaemonImage[];
  },
): Promise<void> {
  // Falls back to disk-cached state for a card this daemon has no live
  // record of — this is what lets a `reply` build on the real prior
  // checklist/transcript after a crash/relaunch, instead of starting from
  // an empty one every time (the `resume` sessionId alone only continues
  // the underlying Claude conversation; it does not replay history into
  // this process's own message stream — verified live).
  const existing = getOrHydrateSession(cardId);

  // In-flight guard: a second turn for the same card must never start while
  // one is still streaming. Report it on the snapshot instead, WITHOUT
  // replacing the entry or disturbing the live turn's state.
  if (!canStartTurn(existing)) {
    updateSnapshot(cardId, rejectTurnSnapshot);
    return;
  }

  const abortController = new AbortController();
  const snapshot = existing?.snapshot ?? createInitialSnapshot(cardId);
  sessions.set(cardId, {
    snapshot: startTurnSnapshot(
      snapshot,
      options.kind,
      options.kind === 'reply' ? prompt : undefined,
      transcriptImagesFrom(options.images),
    ),
    abortController,
    pendingApprovalResolve: null,
    turnActive: true,
    stopped: false,
  });
  broadcast({ event: 'snapshot', snapshot: sessions.get(cardId)!.snapshot });
  writeCachedSnapshot(cacheDir, sessions.get(cardId)!.snapshot);

  // Snapshot writes coming from THIS turn. Dropped once the entry has been
  // taken over by a newer turn, or once the user has stopped the session —
  // otherwise a winding-down aborted turn would overwrite the explicit
  // "Stopped by user" terminal state with whatever the SDK threw on abort.
  const updateThisTurn = (
    updater: (s: SessionSnapshot) => SessionSnapshot,
  ): void => {
    const session = sessions.get(cardId);
    const isOwningTurn = session?.abortController === abortController;
    if (!shouldApplyTurnWrite(session, isOwningTurn)) return;
    updateSnapshot(cardId, updater);
  };

  const finishTurn = (): void => {
    const session = sessions.get(cardId);
    if (session?.abortController === abortController) {
      session.turnActive = false;
    }
  };

  // Checked here, not just left to the SDK's own failure, per the spec's
  // error-handling section: a missing working directory should surface a
  // specific, immediate message rather than whatever generic error the SDK
  // happens to throw for it.
  if (!fs.existsSync(options.cwd)) {
    updateThisTurn((s) => ({
      ...s,
      status: 'failed',
      lastError: `Working directory does not exist: ${options.cwd}`,
    }));
    finishTurn();
    return;
  }

  // How this turn ended, per the LAST `result` message to arrive (or the
  // exception that ended it). Kept here rather than on the snapshot
  // because it is turn-scoped bookkeeping, not something any client needs
  // to see — `finally` below is its only reader.
  let outcome: TurnOutcome | null = null;

  try {
    // Every attachment is read here, before the SDK is even imported: an
    // attachment the user deleted from disk must fail the turn outright
    // (the `catch` below turns the thrown `UnreadableImageError` into the
    // card's `lastError`) rather than quietly sending a prompt that refers
    // to a screenshot the model never received. Text-only turns get the
    // literal string back — see queryPrompt.ts for why that still matters.
    const builtPrompt = await buildQueryPrompt(prompt, options.images);
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    for await (const message of query({
      prompt:
        typeof builtPrompt === 'string'
          ? builtPrompt
          : singleUserMessageStream(builtPrompt),
      options: {
        cwd: options.cwd,
        resume: options.resume,
        model: options.model ?? undefined,
        // The Agent SDK otherwise uses its minimal tool-calling prompt,
        // which intentionally omits Claude Code's coding, tool-use, safety,
        // and security guidance. This preset is the same system prompt used
        // by the Claude Code CLI. Filesystem settings remain enabled by
        // default, so user/project CLAUDE.md instructions, hooks, skills,
        // and local settings still layer on top.
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          snapshot: true,
        },
        abortController,
        // Spread, not cherry-picked: `permissionConfig` deliberately omits
        // `allowedTools` entirely rather than passing an empty/undefined one,
        // because a BARE tool name there pre-authorises that tool and the
        // SDK then never calls `canUseTool` at all — which is exactly how
        // this feature's whole Approve/Deny surface came to be dead code.
        // See permissionConfig.ts for the SDK's own warning about it.
        ...buildSessionPermissionOptions(
          async (toolName, input, { signal }) => {
            if (signal.aborted)
              return { behavior: 'deny', message: 'Session stopped' };
            // Reached at all only for the small fixed set of always-interactive
            // cases (AskUserQuestion, certain MCP/connector tools) when
            // "Smart auto" is selected — see permissionConfig.ts for why
            // `sessionPermissionMode('auto')` now maps straight to the SDK's
            // real `'auto'` mode, and why that means this callback is mostly
            // bypassed by the hosted classifier for ordinary tool calls under
            // that mode. Always reached for every call in "Ask every time".
            // `Date.now()` alone is NOT unique enough now that every tool call
            // reaches this callback: two approvals raised inside the same
            // millisecond would collide, and `computeApprovalResolution` matches
            // decisions by `requestId`, so a collision would let a decision for
            // one tool call resolve a different one. The counter makes the id
            // unconditionally unique.
            approvalSeq += 1;
            const requestId = `${cardId}-${Date.now()}-${approvalSeq}`;
            updateThisTurn((s) => ({
              ...s,
              status: 'waiting',
              pendingApproval: { requestId, toolName, input },
            }));
            return new Promise<PermissionResult | null>((resolve) => {
              const session = sessions.get(cardId);
              if (session) session.pendingApprovalResolve = resolve;
            });
          },
          options.approvalMode,
        ),
      },
    })) {
      // Recorded UNCONDITIONALLY, outside `updateThisTurn`'s guards: those
      // guards exist to stop a superseded or stopped turn from overwriting
      // the visible snapshot, but tokens that turn burned were still burned
      // and still billed. Dropping them because the user pressed Stop would
      // make the card under-report real money — the one thing this ledger
      // exists to get right.
      appendUsageEntries(
        usageLedgerPath,
        buildUsageEntries(
          cardId,
          options.kind,
          new Date().toISOString(),
          message as never,
        ),
      );
      outcome = turnOutcomeFromMessage(message as never) ?? outcome;
      updateThisTurn((s) => deriveSessionUpdate(s, message as never));
    }
  } catch (error) {
    // Recorded, not written: the settle below is the single place this
    // turn's terminal status is set, so that a throw and a clean end can
    // never race each other to a different answer.
    outcome = {
      kind: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // The iterator is exhausted, so the SDK subprocess is gone and no
    // further message can arrive for this turn — the one moment at which
    // "the agent is finished" is a fact rather than a guess. Dropped by
    // `updateThisTurn` if a newer turn has taken the card over, or if the
    // user stopped the session (whose own terminal state must stand).
    updateThisTurn((s) => settleTurnSnapshot(s, outcome));
    finishTurn();
  }
}

const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  // Without this, an ECONNRESET/ERR_STREAM_DESTROYED on one client socket
  // (an abrupt Electron exit while `broadcast()` is mid-write, for example)
  // becomes an unhandled 'error' event, which would take down this whole
  // detached, unsupervised, unref()'d process — the one thing this
  // architecture depends on outliving the app.
  socket.on('error', () => sockets.delete(socket));

  const decode = createFrameDecoder((raw) => {
    const request = raw as DaemonRequest;

    if (request.op === 'ping') {
      // The build id rides on `pong` rather than needing an op of its own,
      // so the app learns which build it is talking to on the same
      // round-trip it already uses to prove the socket is alive.
      // `activeTurns` rides along so the app can decline to evict this
      // process while it still has work streaming — see
      // `shouldReplaceDaemon`. Counted live rather than tracked separately:
      // `turnActive` is already the single source of truth for "a turn is
      // running", maintained by `runTurn`/`stop`.
      const activeTurns = [...sessions.values()].filter(
        (session) => session.turnActive,
      ).length;
      socket.write(
        encodeFrame(
          buildId
            ? { event: 'pong', buildId, activeTurns }
            : { event: 'pong', activeTurns },
        ),
      );
      return;
    }

    if (request.op === 'run') {
      void runTurn(request.cardId, request.prompt, {
        kind: 'run',
        cwd: request.cwd,
        approvalMode: request.approvalMode,
        model: request.model,
        images: request.images,
      });
      return;
    }

    if (request.op === 'reply') {
      const session = sessions.get(request.cardId);
      void runTurn(request.cardId, request.text, {
        kind: 'reply',
        // Same working directory the card's `run` used. Without it the SDK
        // fell back to this daemon's own inherited cwd for every follow-up
        // message.
        cwd: request.cwd,
        resume: resolveResumeSessionId(
          session?.snapshot.sessionId,
          request.sessionId,
        ),
        approvalMode: request.approvalMode,
        model: request.model,
        // This reply's own images only — the card's attachments are not
        // resent, so a long conversation does not re-upload (and re-bill)
        // the same screenshots on every message.
        images: request.images,
      });
      return;
    }

    if (request.op === 'approve') {
      const session = sessions.get(request.cardId);
      // Guard against a stale/delayed `approve` arriving for a request that
      // the session has already moved past (a new `canUseTool` call with a
      // different requestId) — see approvalDecisions.ts for the rationale.
      // If it's stale, ignore it silently: the client's own view of the
      // session would already show the new pending approval by the time it
      // could send a decision for the old one, so there's nothing more to
      // communicate back.
      const resolution = session
        ? computeApprovalResolution(session.snapshot.pendingApproval, {
            requestId: request.requestId,
            decision: request.decision,
            message: request.message,
            answers: request.answers,
          })
        : null;
      if (session && resolution) {
        session.pendingApprovalResolve?.(resolution);
        session.pendingApprovalResolve = null;
        updateSnapshot(request.cardId, (s) => ({
          ...s,
          status: 'working',
          pendingApproval: null,
        }));
      }
      return;
    }

    if (request.op === 'stop') {
      const session = sessions.get(request.cardId);
      // If a tool-use approval is outstanding, resolve it as denied so the
      // SDK's awaited `canUseTool` call unblocks and the abort can
      // propagate cleanly, and clear the resolver so a later stale
      // `approve` (see the `approve` handler above) can never find a
      // dangling resolver to misfire against.
      if (session?.pendingApprovalResolve) {
        session.pendingApprovalResolve(computeStopResolution());
        session.pendingApprovalResolve = null;
      }
      session?.abortController.abort();
      if (session) {
        // Marked stopped BEFORE writing the terminal snapshot so the
        // winding-down turn's own writes are suppressed from here on, and
        // `turnActive` cleared so the card is immediately runnable again
        // (the SDK's iterator may take a while to notice the abort, or may
        // end cleanly without ever throwing).
        session.stopped = true;
        session.turnActive = false;
        updateSnapshot(request.cardId, stopSnapshot);
      }
      return;
    }

    if (request.op === 'getState') {
      // Hydrates from the disk cache when this daemon has no live record
      // for the card — this is what lets AppShell's reattach effect show
      // the real prior checklist/transcript instead of the empty
      // "Reconnecting…" placeholder it started with.
      const session = getOrHydrateSession(request.cardId);
      if (session) {
        socket.write(
          encodeFrame({ event: 'snapshot', snapshot: session.snapshot }),
        );
      }
    }
  });

  socket.on('data', decode);
});

server.listen(socketPath, () => {
  // eslint-disable-next-line no-console
  console.log(`daemon: listening on ${socketPath}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
