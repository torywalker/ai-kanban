import fs from 'fs';
import {
  SHIP_CONFLICT_PROMPT,
  shipCommitMessage,
  type SessionWorktree,
} from '../../shared/worktree';
import type {
  ApprovalMode,
  DaemonEvent,
  DaemonRequest,
} from '../../shared/daemonProtocol';
import { gitIsDirty, gitMergeInProgress, gitTopLevel } from './git';
import {
  abortMergeIfNeeded,
  commitAllInWorktree,
  concludeMergeInWorktree,
  conflictsResolved,
  countCommitsAhead,
  fastForwardDestination,
  mergeDestinationIntoWorktree,
} from './shipMerge';
import { removeWorktree } from './worktree';
import { createShipQueue, type ShipQueueSnapshot } from './shipQueue';

export const COMMIT_FAILED_ERROR =
  'Could not commit the worktree for Ship. Uncommitted changes remain.';
export const NOTHING_TO_SHIP_ERROR =
  'Nothing to ship: this card made no commits in its worktree.';
export const CONFLICT_FAILED_ERROR =
  'Could not resolve merge conflicts automatically.';
export const CANCELLED_ERROR = 'Ship cancelled.';
export const TURN_TIMEOUT_ERROR =
  'Timed out waiting for the agent to finish the Ship turn.';

/**
 * How many times the agent is asked to finish a conflicted merge before the
 * merge is abandoned. Two, because a second attempt sometimes succeeds after
 * the first one's own tool output shows it what it got wrong, and a third
 * spends real tokens on a conflict the user should be looking at.
 */
const MAX_CONFLICT_TURNS = 2;

/** Ten minutes: long enough for a real conflict-resolution turn. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

export interface ShipOptions {
  cardId: string;
  title: string;
  primary: string;
  worktree: SessionWorktree;
  destinationBranch: string;
  sessionId: string | null;
  approvalMode: ApprovalMode;
  model: string | null;
}

export interface AgentTurnRequest {
  cardId: string;
  prompt: string;
  cwd: string;
  sessionId: string | null;
  approvalMode: ApprovalMode;
  model: string | null;
  /** Aborted when the ship is cancelled; the runner must reject on it. */
  signal: AbortSignal;
}

export type AgentTurnRunner = (request: AgentTurnRequest) => Promise<void>;

/**
 * Every git operation Ship performs, as one injectable surface. Tests drive
 * most scenarios against a real temporary repository, but the branches that
 * depend on what the agent did to the merge state are far cheaper — and far
 * more deterministic — to express by substituting these.
 */
export interface ShipGit {
  topLevel: (cwd: string) => Promise<string | null>;
  isDirty: (cwd: string) => Promise<boolean>;
  mergeInProgress: (cwd: string) => Promise<boolean>;
  commitAllInWorktree: (worktreePath: string, message: string) => Promise<void>;
  countCommitsAhead: (
    primary: string,
    destinationBranch: string,
    featureBranch: string,
  ) => Promise<number>;
  abortMergeIfNeeded: (worktreePath: string) => Promise<void>;
  conflictsResolved: (worktreePath: string) => Promise<boolean>;
  concludeMergeInWorktree: (worktreePath: string) => Promise<void>;
  mergeDestinationIntoWorktree: (
    worktreePath: string,
    destinationBranch: string,
  ) => Promise<'clean' | 'conflict' | { failed: string }>;
  fastForwardDestination: (opts: {
    primary: string;
    destinationBranch: string;
    featureBranch: string;
  }) => Promise<void>;
  removeWorktree: (primary: string, worktree: SessionWorktree) => Promise<void>;
}

export const defaultShipGit: ShipGit = {
  topLevel: gitTopLevel,
  isDirty: gitIsDirty,
  mergeInProgress: gitMergeInProgress,
  commitAllInWorktree,
  countCommitsAhead,
  abortMergeIfNeeded,
  conflictsResolved,
  concludeMergeInWorktree,
  mergeDestinationIntoWorktree,
  fastForwardDestination,
  removeWorktree,
};

export interface ShipService {
  ship: (opts: ShipOptions) => Promise<void>;
  cancel: (cardId: string) => Promise<void>;
  statusFor: (cardId: string) => ShipQueueSnapshot | null;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new Error(CANCELLED_ERROR);
}

/**
 * Drives one card's Ship: commit whatever the agent left in the worktree,
 * merge the destination in, let the agent finish the merge if it conflicts,
 * then fast-forward the destination and drop the worktree.
 *
 * Only the conflict step involves the model, and even then only to edit
 * files. Both commits a Ship needs — the pre-merge snapshot and the merge
 * itself — are plain git run from here, so a Ship either takes everything in
 * the worktree or fails saying why. It can never depend on the agent having
 * been permitted to stage or commit, which many are not.
 *
 * Only the success path removes a worktree. Every failure leaves it — and
 * whatever the user's agent did inside it — exactly where it is, because
 * the alternative is deleting work that only exists there.
 */
export function createShipService(deps: {
  runAgentTurn: AgentTurnRunner;
  stopSession: (cardId: string) => Promise<void>;
  onStatus: (snapshot: ShipQueueSnapshot) => void;
  git?: ShipGit;
}): ShipService {
  const git = deps.git ?? defaultShipGit;
  const queue = createShipQueue(deps.onStatus);
  /**
   * The worktree a running job is mutating. Cancellation needs a path to
   * abort a merge in, and the renderer must never supply one: it would be
   * an arbitrary filesystem path arriving over IPC.
   */
  const activeWorktrees = new Map<
    string,
    { path: string; cancellable: boolean }
  >();

  async function abortQuietly(worktreePath: string): Promise<void> {
    try {
      await git.abortMergeIfNeeded(worktreePath);
    } catch {
      // Whatever went wrong here is downstream of the failure already on
      // its way to the caller; replacing that message would hide the cause.
    }
  }

  function runTurn(
    opts: ShipOptions,
    prompt: string,
    signal: AbortSignal,
  ): Promise<void> {
    return deps.runAgentTurn({
      cardId: opts.cardId,
      prompt,
      cwd: opts.worktree.path,
      sessionId: opts.sessionId,
      approvalMode: opts.approvalMode,
      model: opts.model,
      signal,
    });
  }

  async function resolveConflicts(
    opts: ShipOptions,
    signal: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONFLICT_TURNS; attempt += 1) {
      throwIfCancelled(signal);
      // eslint-disable-next-line no-await-in-loop
      await runTurn(opts, SHIP_CONFLICT_PROMPT, signal);
      throwIfCancelled(signal);
      // An agent allowed to commit may have finished the merge outright.
      // eslint-disable-next-line no-await-in-loop
      if (!(await git.mergeInProgress(opts.worktree.path))) return;
      // Otherwise the merge being unfinished says nothing: the prompt tells
      // the agent not to stage or commit, so this is what a *successful*
      // turn leaves behind. The files decide, and Ship concludes the merge
      // itself — the agent's own account of what it did is not evidence.
      // eslint-disable-next-line no-await-in-loop
      if (await git.conflictsResolved(opts.worktree.path)) {
        // eslint-disable-next-line no-await-in-loop
        await git.concludeMergeInWorktree(opts.worktree.path);
        return;
      }
    }

    await git.abortMergeIfNeeded(opts.worktree.path);
    throw new Error(CONFLICT_FAILED_ERROR);
  }

  async function runJob(opts: ShipOptions, signal: AbortSignal): Promise<void> {
    const worktreePath = opts.worktree.path;
    activeWorktrees.set(opts.cardId, {
      path: worktreePath,
      cancellable: true,
    });
    try {
      throwIfCancelled(signal);
      // A merge left half-finished by an earlier attempt makes every later
      // `git merge` here refuse outright, so it is cleared before restarting
      // rather than reported as this attempt's conflict.
      await git.abortMergeIfNeeded(worktreePath);
      throwIfCancelled(signal);

      if (await git.isDirty(worktreePath)) {
        await git.commitAllInWorktree(
          worktreePath,
          shipCommitMessage(opts.title, opts.cardId),
        );
        throwIfCancelled(signal);
        // Belt and braces: merging a tree git still calls dirty would either
        // refuse or quietly fold those edits into the merge commit.
        if (await git.isDirty(worktreePath)) {
          throw new Error(COMMIT_FAILED_ERROR);
        }
      }
      throwIfCancelled(signal);

      // Asked before anything destructive happens. `git merge --ff-only`
      // answers "Already up to date." with exit 0 for a branch that adds
      // nothing, so without this check Ship would report success, delete the
      // worktree, and land nothing — indistinguishable to the user from a
      // Ship that silently failed.
      const ahead = await git.countCommitsAhead(
        opts.primary,
        opts.destinationBranch,
        opts.worktree.branch,
      );
      if (ahead === 0) {
        throw new Error(NOTHING_TO_SHIP_ERROR);
      }
      throwIfCancelled(signal);

      const merged = await git.mergeDestinationIntoWorktree(
        worktreePath,
        opts.destinationBranch,
      );
      if (typeof merged === 'object') {
        throw new Error(merged.failed.trim() || 'Git merge failed.');
      }
      if (merged === 'conflict') {
        await resolveConflicts(opts, signal);
      }
      throwIfCancelled(signal);

      await git.fastForwardDestination({
        primary: opts.primary,
        destinationBranch: opts.destinationBranch,
        featureBranch: opts.worktree.branch,
      });
      throwIfCancelled(signal);

      // Landing is now complete. A cancellation during worktree removal
      // must not turn a successful Ship into a reported cancellation and
      // leave the renderer persisting stale worktree metadata.
      const active = activeWorktrees.get(opts.cardId);
      if (active) active.cancellable = false;
      await git.removeWorktree(opts.primary, opts.worktree);
    } catch (error) {
      // The queue slot is about to be handed to another card in this same
      // repository; releasing it with a merge still in flight would leave
      // that card's first `git merge` refusing for reasons of our making.
      await abortQuietly(worktreePath);
      throw error;
    } finally {
      activeWorktrees.delete(opts.cardId);
    }
  }

  async function ship(opts: ShipOptions): Promise<void> {
    const topLevel = await git.topLevel(opts.primary);
    if (topLevel === null) {
      throw new Error('Working directory is not a git repository.');
    }
    // Realpath, so a card opened through a symlinked path queues behind one
    // opened through the real path: they mutate the same refs.
    const repoKey = fs.realpathSync(topLevel);
    return queue.enqueue(
      repoKey,
      { cardId: opts.cardId, title: opts.title },
      (signal) => runJob(opts, signal),
    );
  }

  async function cancel(cardId: string): Promise<void> {
    if (queue.snapshotForCard(cardId) === null) return;

    const active = activeWorktrees.get(cardId) ?? null;
    const settled =
      !active || active.cancellable
        ? queue.cancel(cardId)
        : queue.whenSettled(cardId);
    // Read synchronously after the abort: the job clears its entry as it
    // unwinds, and a waiting card has no active path at all.
    const worktreePath = active?.cancellable ? active.path : null;

    let abortError: unknown = null;
    if (worktreePath) {
      try {
        await git.abortMergeIfNeeded(worktreePath);
      } catch (error) {
        abortError = error;
      }
    }

    // Stop happens even when the abort failed: an agent turn left running
    // would keep writing into a worktree the user has walked away from.
    await deps.stopSession(cardId);
    // A caller may remove this worktree immediately after cancellation
    // (card deletion does exactly that), so cancellation is not complete
    // until the mutating queue job has fully unwound.
    await settled;
    if (abortError) throw abortError;
  }

  return { ship, cancel, statusFor: queue.snapshotForCard };
}

/**
 * The production agent-turn wait: send the fixed Ship prompt as an ordinary
 * reply, then watch daemon snapshots until this card's turn ends.
 *
 * `sendDaemonRequest` is fire-and-forget once the frame is written, so the
 * turn's outcome can only come from the event stream — and the subscription
 * has to exist before the reply is sent or a fast turn's terminal snapshot
 * is missed entirely.
 */
export function createDaemonAgentTurnRunner(deps: {
  send: (request: DaemonRequest) => Promise<void>;
  subscribe: (listener: (event: DaemonEvent) => void) => () => void;
  timeoutMs?: number;
}): AgentTurnRunner {
  const timeoutMs = deps.timeoutMs ?? TURN_TIMEOUT_MS;

  return (request) =>
    new Promise<void>((resolve, reject) => {
      if (request.signal.aborted) {
        reject(new Error(CANCELLED_ERROR));
        return;
      }

      /**
       * The card's last snapshot is still whatever its previous turn left
       * behind — usually `done`. Waiting for this turn to actually start
       * before believing an end state is what stops that stale snapshot
       * from ending the wait before the agent has read the prompt.
       */
      let started = false;
      let settled = false;
      const cleanups: Array<() => void> = [];

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        cleanups.forEach((cleanup) => cleanup());
        if (error) reject(error);
        else resolve();
      };

      const unsubscribe = deps.subscribe((event) => {
        if (event.event !== 'snapshot') return;
        const { snapshot } = event;
        if (snapshot.cardId !== request.cardId) return;

        if (snapshot.status === 'working' || snapshot.status === 'waiting') {
          started = true;
          return;
        }
        if (!started) return;

        if (snapshot.status === 'done') {
          finish();
          return;
        }
        finish(
          new Error(
            snapshot.lastError ??
              `The Ship turn ended as ${snapshot.status} without an error.`,
          ),
        );
      });
      cleanups.push(unsubscribe);

      const timer = setTimeout(
        () => finish(new Error(TURN_TIMEOUT_ERROR)),
        timeoutMs,
      );
      cleanups.push(() => clearTimeout(timer));

      const onAbort = () => finish(new Error(CANCELLED_ERROR));
      request.signal.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => request.signal.removeEventListener('abort', onAbort));

      deps
        .send({
          op: 'reply',
          cardId: request.cardId,
          text: request.prompt,
          cwd: request.cwd,
          approvalMode: request.approvalMode,
          model: request.model,
          sessionId: request.sessionId,
        })
        .catch((error: Error) => finish(error));
    });
}
