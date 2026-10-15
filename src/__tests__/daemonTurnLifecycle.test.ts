/**
 * Final whole-branch review, fixes I1, I2 and M2.
 *
 * The daemon's `run`/`reply`/`stop` handlers themselves can only be
 * exercised with a live SDK subprocess and a real unix socket, so the three
 * decisions those fixes turn on were extracted into `turnLifecycle.ts` — the
 * same treatment `approvalDecisions.ts` got in Task 2's fix round — and are
 * tested here directly:
 *
 *   I1: a second `run`/`reply` must not start while a turn is still live
 *       (two concurrent `query()` calls interleaving into one snapshot slot,
 *       plus an orphaned `pendingApprovalResolve` that hangs an SDK
 *       subprocess forever inside an unsupervised daemon).
 *   I2: `stop` must write a terminal status itself, because the SDK's async
 *       iterator may end cleanly on abort rather than throwing, which left
 *       the card stuck on `working` forever.
 *   M2: a fresh "Run again" must not inherit the previous run's checklist or
 *       resurrect a `pendingApproval` from a session that already ended.
 */
import type { SessionSnapshot } from '../shared/daemonProtocol';
import {
  HYDRATED_MID_TURN_ERROR,
  STOPPED_BY_USER_ERROR,
  TURN_IN_PROGRESS_ERROR,
  canStartTurn,
  normalizeHydratedSnapshot,
  rejectTurnSnapshot,
  resolveResumeSessionId,
  settleTurnSnapshot,
  shouldApplyTurnWrite,
  startTurnSnapshot,
  stopSnapshot,
  turnOutcomeFromMessage,
} from '../main/daemon/turnLifecycle';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    cardId: 'crd_1',
    sessionId: 'sess_1',
    status: 'done',
    checklist: [{ id: 'tu_1', label: 'Read: a.py', done: true, seq: 0 }],
    messages: [],
    pendingApproval: null,
    lastError: null,
    ...overrides,
  };
}

describe('I1: in-flight turn guard', () => {
  it('allows a turn for a card with no session entry at all', () => {
    expect(canStartTurn(undefined)).toBe(true);
    expect(canStartTurn(null)).toBe(true);
  });

  it('allows a turn for a card whose previous turn has finished', () => {
    expect(canStartTurn({ turnActive: false, stopped: false })).toBe(true);
  });

  it('allows a turn for a card whose previous turn was stopped', () => {
    // Stop clears turnActive so "Run again" works immediately, even if the
    // aborted SDK iterator has not noticed yet.
    expect(canStartTurn({ turnActive: false, stopped: true })).toBe(true);
  });

  it('REFUSES a turn while one is already in flight', () => {
    expect(canStartTurn({ turnActive: true, stopped: false })).toBe(false);
  });

  it('reports the refusal on lastError without disturbing the live turn', () => {
    const live = snapshot({
      status: 'waiting',
      pendingApproval: { requestId: 'r1', toolName: 'Bash', input: { command: 'ls' } },
      checklist: [{ id: 'tu_1', label: 'Bash: ls', done: false, seq: 0 }],
    });
    const rejected = rejectTurnSnapshot(live);

    expect(rejected.lastError).toBe(TURN_IN_PROGRESS_ERROR);
    // Everything the in-flight turn owns must survive untouched: its status,
    // its checklist, and above all its pending approval (whose resolver the
    // old code orphaned by replacing the map entry).
    expect(rejected.status).toBe('waiting');
    expect(rejected.pendingApproval).toBe(live.pendingApproval);
    expect(rejected.checklist).toBe(live.checklist);
    expect(rejected.sessionId).toBe(live.sessionId);
    // Immutable, like every other snapshot transform in this codebase.
    expect(live.lastError).toBeNull();
  });
});

describe('I2: stop writes a terminal status itself', () => {
  it('moves a still-working card to failed with a "Stopped by user" reason', () => {
    const stopped = stopSnapshot(snapshot({ status: 'working', lastError: null }));
    expect(stopped.status).toBe('failed');
    expect(stopped.lastError).toBe(STOPPED_BY_USER_ERROR);
  });

  it('clears a pending approval so no dead Approve/Deny box is left on screen', () => {
    const stopped = stopSnapshot(
      snapshot({
        status: 'waiting',
        pendingApproval: { requestId: 'r1', toolName: 'Write', input: {} },
      }),
    );
    expect(stopped.pendingApproval).toBeNull();
  });

  it('reuses the existing failed status, so no status-keyed UI map needs a new case', () => {
    const stopped = stopSnapshot(snapshot({ status: 'working' }));
    expect(['working', 'waiting', 'done', 'failed']).toContain(stopped.status);
  });

  it('leaves the work done so far visible in the checklist', () => {
    const before = snapshot({ status: 'working' });
    expect(stopSnapshot(before).checklist).toBe(before.checklist);
  });

  it('produces a status that re-enables Run (canRun requires done/failed)', () => {
    const stopped = stopSnapshot(snapshot({ status: 'working' }));
    const canRun = stopped.status === 'done' || stopped.status === 'failed';
    expect(canRun).toBe(true);
  });
});

describe('M2: a fresh run does not inherit stale state', () => {
  const finished = snapshot({
    status: 'done',
    checklist: [
      { id: 'tu_old_1', label: 'Read: old.py', done: true, seq: 0 },
      { id: 'tu_old_2', label: 'Bash: npm test', done: true, seq: 1 },
    ],
    messages: [{ id: 'msg_old_1:0', kind: 'text', text: 'Done with the old run.', seq: 2 }],
    pendingApproval: { requestId: 'stale', toolName: 'Write', input: {} },
    lastError: 'something earlier',
  });

  it('resets the checklist, transcript and pending approval for a NEW run', () => {
    const next = startTurnSnapshot(finished, 'run');
    expect(next.status).toBe('working');
    expect(next.checklist).toEqual([]);
    expect(next.messages).toEqual([]);
    expect(next.pendingApproval).toBeNull();
    expect(next.lastError).toBeNull();
  });

  it('KEEPS the checklist and transcript for a reply, which continues the same conversation', () => {
    const next = startTurnSnapshot(finished, 'reply');
    expect(next.status).toBe('working');
    expect(next.checklist).toEqual(finished.checklist);
    expect(next.messages).toEqual(finished.messages);
    expect(next.lastError).toBeNull();
  });

  it('carries the session id forward on both kinds (resume needs it)', () => {
    expect(startTurnSnapshot(finished, 'run').sessionId).toBe('sess_1');
    expect(startTurnSnapshot(finished, 'reply').sessionId).toBe('sess_1');
  });

  it('never mutates the previous snapshot', () => {
    startTurnSnapshot(finished, 'run');
    expect(finished.checklist).toHaveLength(2);
    expect(finished.messages).toHaveLength(1);
    expect(finished.pendingApproval).not.toBeNull();
    expect(finished.status).toBe('done');
  });
});

/**
 * The user's own reply text used to vanish from the UI the moment it was
 * sent — it was never recorded anywhere, client or daemon side. A `reply`
 * now records it as a `user`-kind transcript message right where the turn
 * starts, so it survives in the same snapshot that gets persisted to disk.
 */
describe('startTurnSnapshot records the reply text as a user message', () => {
  const finished = snapshot({
    status: 'done',
    checklist: [{ id: 'tu_old_1', label: 'Read: old.py', done: true, seq: 0 }],
    messages: [{ id: 'msg_old_1:0', kind: 'text', text: 'Done with the old run.', seq: 1 }],
  });

  it('appends a user-kind message with the reply text', () => {
    const next = startTurnSnapshot(finished, 'reply', 'please also check the tests');
    expect(next.messages).toHaveLength(2);
    const added = next.messages[1];
    expect(added.kind).toBe('user');
    expect(added.text).toBe('please also check the tests');
  });

  it('gives the new message the next seq after the existing checklist + messages', () => {
    const next = startTurnSnapshot(finished, 'reply', 'go on');
    // checklist has 1 item, messages had 1 entry -> next seq is 2.
    expect(next.messages[1].seq).toBe(2);
  });

  it('keeps the prior checklist and messages untouched apart from the appended entry', () => {
    const next = startTurnSnapshot(finished, 'reply', 'go on');
    expect(next.checklist).toBe(finished.checklist);
    expect(next.messages[0]).toBe(finished.messages[0]);
  });

  it('adds nothing when no reply text is given (a bare reconnect, not a real reply)', () => {
    const next = startTurnSnapshot(finished, 'reply');
    expect(next.messages).toBe(finished.messages);
  });

  it('never records a message for a fresh "run", even if text is passed', () => {
    const next = startTurnSnapshot(finished, 'run', 'ignored text');
    expect(next.messages).toEqual([]);
  });

  it('never mutates the previous snapshot', () => {
    startTurnSnapshot(finished, 'reply', 'go on');
    expect(finished.messages).toHaveLength(1);
  });

  /**
   * A reply can carry its own images. The transcript entry keeps only the
   * path-free reference (filename/mime/cardId/id) the View dialog needs to
   * ask for a preview — the absolute path the daemon read from is main's
   * business and has no place in a snapshot that gets cached to disk and
   * shipped to the renderer.
   */
  it('stamps the reply images onto the user message it appends', () => {
    const next = startTurnSnapshot(finished, 'reply', 'see this', [
      {
        filename: 'a.png',
        mimeType: 'image/png',
        cardId: 'crd_1',
        id: 'att_a',
      },
    ]);
    const added = next.messages[1];
    expect(added.kind).toBe('user');
    expect(added.text).toBe('see this');
    expect(added.images).toHaveLength(1);
    expect(added.images?.[0]).toEqual({
      filename: 'a.png',
      mimeType: 'image/png',
      cardId: 'crd_1',
      id: 'att_a',
    });
  });

  it('omits images entirely on a text-only reply, so old snapshots stay shape-identical', () => {
    expect(
      startTurnSnapshot(finished, 'reply', 'no pictures').messages[1],
    ).not.toHaveProperty('images');
    expect(
      startTurnSnapshot(finished, 'reply', 'no pictures', []).messages[1],
    ).not.toHaveProperty('images');
  });
});

describe('turn-scoped snapshot writes', () => {
  it('applies writes from the turn that owns the entry', () => {
    expect(shouldApplyTurnWrite({ turnActive: true, stopped: false }, true)).toBe(true);
  });

  it('drops writes from a turn whose entry was taken over by a newer turn', () => {
    expect(shouldApplyTurnWrite({ turnActive: true, stopped: false }, false)).toBe(false);
  });

  it('drops writes from an aborted turn winding down after a stop, so "Stopped by user" survives', () => {
    expect(shouldApplyTurnWrite({ turnActive: false, stopped: true }, true)).toBe(false);
  });

  it('drops writes for a card with no entry at all', () => {
    expect(shouldApplyTurnWrite(undefined, true)).toBe(false);
  });
});

/**
 * Lets a `reply` resume the real Claude conversation even after this
 * daemon has no live in-memory record of the card at all (a fresh daemon
 * following a crash, or the app relaunching after the previous daemon was
 * killed). Before this, `reply` only ever resumed using the daemon's own
 * live session id, so a reply sent in exactly that situation silently
 * started a brand-new conversation with no knowledge of the original
 * prompt.
 */
describe('resolveResumeSessionId', () => {
  it('prefers the live in-memory session id when the daemon has one', () => {
    expect(resolveResumeSessionId('sess_live', 'sess_persisted')).toBe('sess_live');
  });

  it('falls back to the persisted session id when the daemon has no live record', () => {
    expect(resolveResumeSessionId(undefined, 'sess_persisted')).toBe('sess_persisted');
    expect(resolveResumeSessionId(null, 'sess_persisted')).toBe('sess_persisted');
  });

  it('resolves to undefined (a genuinely fresh conversation) when neither exists', () => {
    expect(resolveResumeSessionId(undefined, null)).toBeUndefined();
    expect(resolveResumeSessionId(null, null)).toBeUndefined();
  });
});

/**
 * A cached snapshot hydrated onto a fresh daemon has no live turn behind
 * it no matter what its own `status` says. Left as `working`/`waiting`,
 * the UI would show a spinner (or a stale, unresolvable approval box) for
 * a turn that can never finish, since nothing will ever move it off that
 * status again on its own.
 */
describe('normalizeHydratedSnapshot', () => {
  it('corrects a snapshot cached mid-turn (working) to interrupted, clearing any pendingApproval', () => {
    const cached = snapshot({
      status: 'working',
      pendingApproval: { requestId: 'r1', toolName: 'Bash', input: {} },
    });
    const normalized = normalizeHydratedSnapshot(cached);
    expect(normalized.status).toBe('interrupted');
    expect(normalized.pendingApproval).toBeNull();
    expect(normalized.lastError).toBe(HYDRATED_MID_TURN_ERROR);
  });

  it('corrects a snapshot cached mid-approval (waiting) the same way', () => {
    const cached = snapshot({
      status: 'waiting',
      pendingApproval: { requestId: 'r1', toolName: 'Write', input: {} },
    });
    const normalized = normalizeHydratedSnapshot(cached);
    expect(normalized.status).toBe('interrupted');
    expect(normalized.pendingApproval).toBeNull();
  });

  it('leaves an already-terminal cached snapshot completely untouched', () => {
    (['done', 'failed', 'interrupted'] as const).forEach((status) => {
      const cached = snapshot({ status, lastError: status === 'failed' ? 'boom' : null });
      expect(normalizeHydratedSnapshot(cached)).toEqual(cached);
    });
  });

  it('preserves the checklist/messages built up before the interruption', () => {
    const cached = snapshot({ status: 'working' });
    const normalized = normalizeHydratedSnapshot(cached);
    expect(normalized.checklist).toBe(cached.checklist);
    expect(normalized.messages).toBe(cached.messages);
  });
});

/**
 * The other half of "a `result` message is not the end of the turn" (see
 * `daemonChecklist.test.ts` for the recorded SDK stream that proves it).
 * `runTurn` keeps the latest outcome as messages go by and settles the
 * card once, after its `for await` loop has run dry — the first moment at
 * which the SDK subprocess is provably gone.
 */
describe('settling a turn when the SDK stream closes', () => {
  describe('turnOutcomeFromMessage', () => {
    it('reads success off a successful result', () => {
      expect(
        turnOutcomeFromMessage({ type: 'result', subtype: 'success' }),
      ).toEqual({ kind: 'success' });
    });

    it('reads the failure reason off an error result', () => {
      expect(
        turnOutcomeFromMessage({ type: 'result', subtype: 'error_max_turns' }),
      ).toEqual({ kind: 'error', message: 'error_max_turns' });
    });

    it('names an unlabelled failure rather than reporting no outcome at all', () => {
      expect(turnOutcomeFromMessage({ type: 'result' })).toEqual({
        kind: 'error',
        message: 'unknown error',
      });
    });

    it('reports nothing for the ordinary traffic in between', () => {
      expect(turnOutcomeFromMessage({ type: 'assistant' })).toBeNull();
      expect(turnOutcomeFromMessage({ type: 'user' })).toBeNull();
      expect(
        turnOutcomeFromMessage({
          type: 'system',
          subtype: 'task_notification',
        }),
      ).toBeNull();
    });
  });

  describe('settleTurnSnapshot', () => {
    const working = snapshot({ status: 'working', lastError: null });

    it('marks the card done for a turn whose last result was a success', () => {
      const settled = settleTurnSnapshot(working, { kind: 'success' });
      expect(settled.status).toBe('done');
      expect(settled.lastError).toBeNull();
    });

    it('marks the card failed, with the reason, for a turn that ended badly', () => {
      const settled = settleTurnSnapshot(working, {
        kind: 'error',
        message: 'error_max_turns',
      });
      expect(settled.status).toBe('failed');
      expect(settled.lastError).toBe('error_max_turns');
    });

    it('takes the LAST outcome, so a recovered turn is not reported as failed', () => {
      // The ordering from the recorded background-subagent stream: an
      // early result, more work, then a second result that supersedes it.
      let outcome = turnOutcomeFromMessage({
        type: 'result',
        subtype: 'error_max_turns',
      });
      outcome =
        turnOutcomeFromMessage({ type: 'assistant' }) ??
        turnOutcomeFromMessage({ type: 'result', subtype: 'success' }) ??
        outcome;

      expect(settleTurnSnapshot(working, outcome).status).toBe('done');
    });

    it('settles a stream that closed without ever reporting a result', () => {
      // Nothing claimed a failure, and leaving the card `working` here is
      // the permanent spinner this settle exists to prevent.
      expect(settleTurnSnapshot(working, null).status).toBe('done');
    });

    it('clears an approval box the dead subprocess can no longer answer', () => {
      const asking = snapshot({
        status: 'waiting',
        pendingApproval: { requestId: 'r1', toolName: 'Bash', input: {} },
      });
      expect(
        settleTurnSnapshot(asking, { kind: 'success' }).pendingApproval,
      ).toBeNull();
    });

    it('keeps the checklist and transcript the turn produced', () => {
      const settled = settleTurnSnapshot(working, { kind: 'success' });
      expect(settled.checklist).toEqual(working.checklist);
      expect(settled.messages).toEqual(working.messages);
    });

    it('never mutates the snapshot it settles', () => {
      settleTurnSnapshot(working, { kind: 'error', message: 'boom' });
      expect(working.status).toBe('working');
      expect(working.lastError).toBeNull();
    });
  });
});
