import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createDaemonAgentTurnRunner,
  createShipService,
  defaultShipGit,
  type AgentTurnRequest,
  type ShipGit,
  type ShipOptions,
} from '../main/services/ship';
import type { ShipQueueSnapshot } from '../main/services/shipQueue';
import { gitMergeInProgress } from '../main/services/git';
import { mergeDestinationIntoWorktree } from '../main/services/shipMerge';
import { ensureWorktree } from '../main/services/worktree';
import { SHIP_CONFLICT_PROMPT, type SessionWorktree } from '../shared/worktree';
import type {
  DaemonEvent,
  DaemonRequest,
  SessionStatus,
} from '../shared/daemonProtocol';
import {
  gitExec,
  initRepo,
  plumbingCommit,
  rmRepo,
} from '../testUtils/gitRepo';

// Every scenario here drives real `git` subprocesses against a temporary
// repository, which comfortably outruns the 5s default once several suites
// are running in parallel.
jest.setTimeout(30_000);

const tick = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${label}`);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }
}

/** A Ship agent turn, typed so its recorded calls stay inspectable. */
function turnMock(impl?: (request: AgentTurnRequest) => Promise<void>) {
  return jest.fn<Promise<void>, [AgentTurnRequest]>(
    impl ?? (() => Promise.resolve()),
  );
}

/** Records how a promise settled without leaving it unhandled. */
function track(promise: Promise<unknown>) {
  const state = { settled: false, error: null as Error | null };
  const record = async () => {
    try {
      await promise;
    } catch (error) {
      state.error = error as Error;
    }
    state.settled = true;
  };
  record();
  return state;
}

describe('ship orchestrator', () => {
  let primary: string;
  let userDataRoot: string;
  let base: string;
  let statuses: ShipQueueSnapshot[];
  let stopSession: jest.Mock<Promise<void>, [string]>;

  beforeEach(() => {
    primary = initRepo();
    base = plumbingCommit(primary, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    gitExec(primary, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    gitExec(primary, ['reset', '--hard', base]);
    userDataRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-kanban-ship-user-data-'),
    );
    statuses = [];
    stopSession = jest.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmRepo(primary);
    rmRepo(userDataRoot);
  });

  function serviceWith(
    runAgentTurn: (request: AgentTurnRequest) => Promise<void>,
    git?: ShipGit,
  ) {
    return createShipService({
      runAgentTurn,
      stopSession,
      onStatus: (snapshot: ShipQueueSnapshot) => {
        statuses.push(snapshot);
      },
      ...(git ? { git } : {}),
    });
  }

  function worktreeFor(cardId: string): Promise<SessionWorktree> {
    return ensureWorktree({ userDataRoot, primary, cardId, existing: null });
  }

  function commitInWorktree(
    worktree: SessionWorktree,
    files: Record<string, string>,
    message: string,
  ): string {
    return plumbingCommit(worktree.path, {
      files,
      message,
      parent: gitExec(worktree.path, ['rev-parse', 'HEAD']).trim(),
      ref: `refs/heads/${worktree.branch}`,
    });
  }

  function shipOptions(cardId: string, worktree: SessionWorktree): ShipOptions {
    return {
      cardId,
      title: `Card ${cardId}`,
      primary,
      worktree,
      destinationBranch: 'main',
      sessionId: null,
      approvalMode: 'ask',
      model: null,
    };
  }

  /** Moves `main` forward while it is checked out in the primary clone. */
  function advanceMain(contents: string): string {
    const commit = plumbingCommit(primary, {
      files: { 'result.txt': contents },
      message: 'destination',
      parent: base,
      ref: 'refs/heads/main',
    });
    gitExec(primary, ['reset', '--hard', commit]);
    return commit;
  }

  it('fast-forwards and removes the worktree when nothing needs an agent', async () => {
    const worktree = await worktreeFor('crd_clean');
    const feature = commitInWorktree(
      worktree,
      { 'result.txt': 'feature\n' },
      'feature',
    );
    const runAgentTurn = turnMock();

    await serviceWith(runAgentTurn).ship(shipOptions('crd_clean', worktree));

    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(gitExec(primary, ['rev-parse', 'main']).trim()).toBe(feature);
    expect(fs.readFileSync(path.join(primary, 'result.txt'), 'utf8')).toBe(
      'feature\n',
    );
    expect(fs.existsSync(worktree.path)).toBe(false);
  });

  it('commits a dirty worktree itself, including new files, with no agent turn', async () => {
    const worktree = await worktreeFor('crd_dirty');
    fs.writeFileSync(path.join(worktree.path, 'result.txt'), 'feature\n');
    fs.writeFileSync(path.join(worktree.path, 'added.txt'), 'brand new\n');
    const runAgentTurn = turnMock();

    await serviceWith(runAgentTurn).ship(shipOptions('crd_dirty', worktree));

    // The model is never asked to commit — an untracked file landing proves
    // Ship staged everything itself.
    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(primary, 'result.txt'), 'utf8')).toBe(
      'feature\n',
    );
    expect(fs.readFileSync(path.join(primary, 'added.txt'), 'utf8')).toBe(
      'brand new\n',
    );
    expect(gitExec(primary, ['log', '-1', '--pretty=%s']).trim()).toBe(
      'Card crd_dirty',
    );
    expect(fs.existsSync(worktree.path)).toBe(false);
  });

  it('refuses to ship a worktree that has no commits of its own', async () => {
    // What a card looks like when its agent never wrote anything: the branch
    // is still whatever the worktree was cut from. `git merge --ff-only`
    // would call that "Already up to date" and Ship would delete the
    // worktree while landing nothing.
    const worktree = await worktreeFor('crd_empty');
    advanceMain('destination\n');
    const runAgentTurn = turnMock();

    await expect(
      serviceWith(runAgentTurn).ship(shipOptions('crd_empty', worktree)),
    ).rejects.toThrow(
      'Nothing to ship: this card made no commits in its worktree.',
    );

    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(fs.existsSync(worktree.path)).toBe(true);
    expect(gitExec(primary, ['rev-parse', 'kanban/crd_empty']).trim()).toBe(
      base,
    );
  });

  it('still ships a worktree whose only work is uncommitted', async () => {
    // The guard must run after the deterministic commit, not before it, or
    // it would reject exactly the work Ship exists to rescue.
    const worktree = await worktreeFor('crd_onlydirty');
    fs.writeFileSync(path.join(worktree.path, 'result.txt'), 'feature\n');

    await serviceWith(turnMock()).ship(shipOptions('crd_onlydirty', worktree));

    expect(fs.readFileSync(path.join(primary, 'result.txt'), 'utf8')).toBe(
      'feature\n',
    );
    expect(fs.existsSync(worktree.path)).toBe(false);
  });

  it('keeps the worktree when committing does not clean it', async () => {
    const worktree = await worktreeFor('crd_stuck');
    commitInWorktree(worktree, { 'result.txt': 'feature\n' }, 'feature');
    fs.writeFileSync(path.join(worktree.path, 'scratch.txt'), 'wip\n');
    const runAgentTurn = turnMock();
    const git: ShipGit = {
      ...defaultShipGit,
      commitAllInWorktree: jest.fn().mockResolvedValue(undefined),
    };

    await expect(
      serviceWith(runAgentTurn, git).ship(shipOptions('crd_stuck', worktree)),
    ).rejects.toThrow(
      'Could not commit the worktree for Ship. Uncommitted changes remain.',
    );

    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(fs.existsSync(worktree.path)).toBe(true);
    expect(
      fs.readFileSync(path.join(worktree.path, 'scratch.txt'), 'utf8'),
    ).toBe('wip\n');
    expect(gitExec(primary, ['rev-parse', 'main']).trim()).toBe(base);
  });

  it('aborts a merge left over from an earlier attempt before starting', async () => {
    const worktree = await worktreeFor('crd_stale');
    const feature = commitInWorktree(
      worktree,
      { 'conflict.txt': 'feature\n' },
      'feature',
    );
    plumbingCommit(primary, {
      files: { 'conflict.txt': 'other\n' },
      message: 'other',
      parent: base,
      ref: 'refs/heads/other',
    });
    gitExec(primary, ['reset', '--hard', 'main']);
    await expect(
      mergeDestinationIntoWorktree(worktree.path, 'other'),
    ).resolves.toBe('conflict');
    const runAgentTurn = turnMock();

    await serviceWith(runAgentTurn).ship(shipOptions('crd_stale', worktree));

    expect(runAgentTurn).not.toHaveBeenCalled();
    expect(gitExec(primary, ['rev-parse', 'main']).trim()).toBe(feature);
    expect(fs.existsSync(worktree.path)).toBe(false);
  });

  it('gives up after two conflict turns and aborts the merge', async () => {
    const worktree = await worktreeFor('crd_conflict');
    commitInWorktree(worktree, { 'result.txt': 'feature\n' }, 'feature');
    const destination = advanceMain('destination\n');
    const runAgentTurn = turnMock();

    await expect(
      serviceWith(runAgentTurn).ship(shipOptions('crd_conflict', worktree)),
    ).rejects.toThrow('Could not resolve merge conflicts automatically.');

    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(runAgentTurn.mock.calls[1][0]).toMatchObject({
      prompt: SHIP_CONFLICT_PROMPT,
      cwd: worktree.path,
    });
    await expect(gitMergeInProgress(worktree.path)).resolves.toBe(false);
    expect(fs.existsSync(worktree.path)).toBe(true);
    expect(gitExec(primary, ['rev-parse', 'main']).trim()).toBe(destination);
  });

  it('lands a conflict the agent resolved with edits alone', async () => {
    // The whole point of the conflict turn: agents are routinely configured
    // — by user or project instructions Ship cannot see — to refuse `git
    // add` and `git commit`. A correctly resolved merge therefore arrives
    // with MERGE_HEAD still in place, which Ship used to read as failure and
    // throw away with `git merge --abort`, returning the user to square one.
    const worktree = await worktreeFor('crd_edits');
    commitInWorktree(worktree, { 'result.txt': 'feature\n' }, 'feature');
    advanceMain('destination\n');
    const resolved = 'feature and destination\n';
    const runAgentTurn = turnMock((request) => {
      // Everything an agent forbidden from staging can do, and no more.
      expect(
        fs.readFileSync(path.join(request.cwd, 'result.txt'), 'utf8'),
      ).toContain('<<<<<<<');
      fs.writeFileSync(path.join(request.cwd, 'result.txt'), resolved);
      return Promise.resolve();
    });

    await serviceWith(runAgentTurn).ship(shipOptions('crd_edits', worktree));

    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync(path.join(primary, 'result.txt'), 'utf8')).toBe(
      resolved,
    );
    // A real merge commit — two parents — carrying git's prepared message.
    expect(gitExec(primary, ['log', '-1', '--pretty=%s']).trim()).toContain(
      'Merge branch',
    );
    expect(
      gitExec(primary, ['log', '-1', '--pretty=%p']).trim().split(' '),
    ).toHaveLength(2);
    expect(fs.existsSync(worktree.path)).toBe(false);
  });

  it('will not conclude a merge whose files still carry conflict markers', async () => {
    // The counterweight to the test above: "the agent edited something" is
    // not resolution, and committing markers would be worse than failing.
    const worktree = await worktreeFor('crd_markers');
    commitInWorktree(worktree, { 'result.txt': 'feature\n' }, 'feature');
    const destination = advanceMain('destination\n');
    const runAgentTurn = turnMock((request) => {
      fs.appendFileSync(
        path.join(request.cwd, 'result.txt'),
        'a thought, but not a resolution\n',
      );
      return Promise.resolve();
    });

    await expect(
      serviceWith(runAgentTurn).ship(shipOptions('crd_markers', worktree)),
    ).rejects.toThrow('Could not resolve merge conflicts automatically.');

    expect(runAgentTurn).toHaveBeenCalledTimes(2);
    expect(gitExec(primary, ['rev-parse', 'main']).trim()).toBe(destination);
    expect(fs.existsSync(worktree.path)).toBe(true);
  });

  it('ships after a single conflict turn clears the merge', async () => {
    const worktree = await worktreeFor('crd_resolved');
    const git: ShipGit = {
      topLevel: jest.fn().mockResolvedValue(fs.realpathSync(primary)),
      isDirty: jest.fn().mockResolvedValue(false),
      mergeInProgress: jest.fn().mockResolvedValue(false),
      commitAllInWorktree: jest.fn().mockResolvedValue(undefined),
      countCommitsAhead: jest.fn().mockResolvedValue(1),
      abortMergeIfNeeded: jest.fn().mockResolvedValue(undefined),
      conflictsResolved: jest.fn().mockResolvedValue(true),
      concludeMergeInWorktree: jest.fn().mockResolvedValue(undefined),
      mergeDestinationIntoWorktree: jest.fn().mockResolvedValue('conflict'),
      fastForwardDestination: jest.fn().mockResolvedValue(undefined),
      removeWorktree: jest.fn().mockResolvedValue(undefined),
    };
    const runAgentTurn = turnMock();

    await serviceWith(runAgentTurn, git).ship(
      shipOptions('crd_resolved', worktree),
    );

    expect(runAgentTurn).toHaveBeenCalledTimes(1);
    expect(git.fastForwardDestination).toHaveBeenCalledWith({
      primary,
      destinationBranch: 'main',
      featureBranch: worktree.branch,
    });
    expect(git.removeWorktree).toHaveBeenCalledWith(primary, worktree);
  });

  it('refuses a dirty checked-out destination without touching it', async () => {
    const worktree = await worktreeFor('crd_dirtydest');
    commitInWorktree(worktree, { 'result.txt': 'feature\n' }, 'feature');
    fs.writeFileSync(path.join(primary, 'uncommitted.txt'), 'local\n');
    const runAgentTurn = turnMock();

    await expect(
      serviceWith(runAgentTurn).ship(shipOptions('crd_dirtydest', worktree)),
    ).rejects.toThrow(
      'Cannot ship into the checked-out branch while it has uncommitted changes.',
    );

    expect(gitExec(primary, ['rev-parse', 'main']).trim()).toBe(base);
    expect(fs.readFileSync(path.join(primary, 'result.txt'), 'utf8')).toBe(
      'base\n',
    );
    expect(fs.readFileSync(path.join(primary, 'uncommitted.txt'), 'utf8')).toBe(
      'local\n',
    );
    expect(fs.existsSync(worktree.path)).toBe(true);
  });

  it('cancels a waiting agent turn and lets the next card ship', async () => {
    // The first card conflicts with the destination, so its conflict turn is
    // what holds the queue open — the only turn Ship still runs.
    const stuck = await worktreeFor('crd_first');
    commitInWorktree(stuck, { 'result.txt': 'first\n' }, 'first');
    const next = await worktreeFor('crd_second');
    commitInWorktree(next, { 'other.txt': 'second\n' }, 'second');
    advanceMain('destination\n');

    let turnStarted = false;
    const runAgentTurn = jest.fn(
      (request: AgentTurnRequest) =>
        new Promise<void>((_resolve, reject) => {
          turnStarted = true;
          request.signal.addEventListener(
            'abort',
            () => reject(new Error('Ship cancelled.')),
            { once: true },
          );
        }),
    );
    const service = serviceWith(runAgentTurn);

    const first = track(service.ship(shipOptions('crd_first', stuck)));
    await waitFor(() => turnStarted, 'the conflict turn to start');
    const second = track(service.ship(shipOptions('crd_second', next)));
    await waitFor(
      () => service.statusFor('crd_second')?.waiters.length === 1,
      'the second card to queue behind the first',
    );

    expect(service.statusFor('crd_second')).toMatchObject({
      active: { cardId: 'crd_first' },
      waiters: [{ cardId: 'crd_second' }],
    });

    await service.cancel('crd_first');
    await waitFor(() => second.settled, 'the second card to finish shipping');

    expect(first.error?.message).toBe('Ship cancelled.');
    expect(second.error).toBeNull();
    expect(stopSession).toHaveBeenCalledWith('crd_first');
    expect(fs.readFileSync(path.join(primary, 'other.txt'), 'utf8')).toBe(
      'second\n',
    );
    expect(fs.existsSync(stuck.path)).toBe(true);
    expect(fs.existsSync(next.path)).toBe(false);
    expect(statuses.some((snap) => snap.active === null)).toBe(true);
  });

  it('does not report cancellation after the destination has landed', async () => {
    const worktree = await worktreeFor('crd_landed');
    let finishRemoval!: () => void;
    const removal = new Promise<void>((resolve) => {
      finishRemoval = resolve;
    });
    const git: ShipGit = {
      topLevel: jest.fn().mockResolvedValue(fs.realpathSync(primary)),
      isDirty: jest.fn().mockResolvedValue(false),
      mergeInProgress: jest.fn().mockResolvedValue(false),
      commitAllInWorktree: jest.fn().mockResolvedValue(undefined),
      countCommitsAhead: jest.fn().mockResolvedValue(1),
      abortMergeIfNeeded: jest.fn().mockResolvedValue(undefined),
      conflictsResolved: jest.fn().mockResolvedValue(true),
      concludeMergeInWorktree: jest.fn().mockResolvedValue(undefined),
      mergeDestinationIntoWorktree: jest.fn().mockResolvedValue('clean'),
      fastForwardDestination: jest.fn().mockResolvedValue(undefined),
      removeWorktree: jest.fn().mockReturnValue(removal),
    };
    const service = serviceWith(turnMock(), git);
    const shipping = service.ship(shipOptions('crd_landed', worktree));

    await waitFor(
      () => (git.removeWorktree as jest.Mock).mock.calls.length === 1,
      'worktree cleanup to start',
    );
    const cancelling = service.cancel('crd_landed');
    finishRemoval();

    await cancelling;
    await expect(shipping).resolves.toBeUndefined();
    expect(stopSession).toHaveBeenCalledWith('crd_landed');
  });

  it('reports no queue status for a card that is not shipping', async () => {
    const service = serviceWith(jest.fn().mockResolvedValue(undefined));

    expect(service.statusFor('crd_unknown')).toBeNull();
  });
});

describe('daemon agent turn runner', () => {
  function snapshotEvent(
    cardId: string,
    status: SessionStatus,
    lastError: string | null = null,
  ): DaemonEvent {
    return {
      event: 'snapshot',
      snapshot: {
        cardId,
        sessionId: null,
        status,
        checklist: [],
        messages: [],
        pendingApproval: null,
        lastError,
      },
    };
  }

  function runnerHarness(timeoutMs?: number) {
    const order: string[] = [];
    const sent: DaemonRequest[] = [];
    const unsubscribe = jest.fn();
    let listener: ((event: DaemonEvent) => void) | null = null;
    const runner = createDaemonAgentTurnRunner({
      send: async (daemonRequest: DaemonRequest) => {
        order.push('send');
        sent.push(daemonRequest);
      },
      subscribe: (onEvent: (event: DaemonEvent) => void) => {
        order.push('subscribe');
        listener = onEvent;
        return unsubscribe;
      },
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    return {
      order,
      sent,
      unsubscribe,
      runner,
      emit: (event: DaemonEvent) => listener?.(event),
    };
  }

  function request(signal: AbortSignal): AgentTurnRequest {
    return {
      cardId: 'crd_1',
      prompt: SHIP_CONFLICT_PROMPT,
      cwd: '/tmp/worktree',
      sessionId: 'ses_1',
      approvalMode: 'auto',
      model: 'sonnet',
      signal,
    };
  }

  it('subscribes before replying and resolves once the turn is done', async () => {
    const harness = runnerHarness();
    const pending = harness.runner(request(new AbortController().signal));

    expect(harness.order).toEqual(['subscribe', 'send']);
    expect(harness.sent).toEqual([
      {
        op: 'reply',
        cardId: 'crd_1',
        text: SHIP_CONFLICT_PROMPT,
        cwd: '/tmp/worktree',
        approvalMode: 'auto',
        model: 'sonnet',
        sessionId: 'ses_1',
      },
    ]);

    harness.emit(snapshotEvent('crd_1', 'working'));
    harness.emit(snapshotEvent('crd_1', 'done'));

    await expect(pending).resolves.toBeUndefined();
    expect(harness.unsubscribe).toHaveBeenCalled();
  });

  it('ignores other cards and a stale finished snapshot', async () => {
    const harness = runnerHarness();
    const state = track(harness.runner(request(new AbortController().signal)));

    harness.emit(snapshotEvent('crd_1', 'done'));
    harness.emit(snapshotEvent('crd_2', 'working'));
    harness.emit(snapshotEvent('crd_2', 'done'));
    await tick();
    expect(state.settled).toBe(false);

    harness.emit(snapshotEvent('crd_1', 'waiting'));
    harness.emit(snapshotEvent('crd_1', 'done'));
    await waitFor(() => state.settled, 'the turn to resolve');
    expect(state.error).toBeNull();
  });

  it('rejects with the reported error when the turn fails', async () => {
    const harness = runnerHarness();
    const pending = harness.runner(request(new AbortController().signal));

    harness.emit(snapshotEvent('crd_1', 'working'));
    harness.emit(snapshotEvent('crd_1', 'failed', 'model quota exhausted'));

    await expect(pending).rejects.toThrow('model quota exhausted');
    expect(harness.unsubscribe).toHaveBeenCalled();
  });

  it('rejects and unsubscribes when the ship is cancelled', async () => {
    const harness = runnerHarness();
    const controller = new AbortController();
    const pending = harness.runner(request(controller.signal));

    harness.emit(snapshotEvent('crd_1', 'working'));
    controller.abort();

    await expect(pending).rejects.toThrow('Ship cancelled.');
    expect(harness.unsubscribe).toHaveBeenCalled();
  });

  it('rejects when the turn never finishes', async () => {
    const harness = runnerHarness(5);
    const pending = harness.runner(request(new AbortController().signal));

    harness.emit(snapshotEvent('crd_1', 'working'));

    await expect(pending).rejects.toThrow(
      'Timed out waiting for the agent to finish the Ship turn.',
    );
    expect(harness.unsubscribe).toHaveBeenCalled();
  });
});
