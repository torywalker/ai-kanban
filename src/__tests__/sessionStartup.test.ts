/**
 * Clicking Run left the transcript blank: the daemon needs a moment to
 * spawn and reach the SDK, and until its first text/tool call arrives there
 * was nothing on screen to say the agent was starting at all. This is the
 * rule behind that notice — when to show it, and which of its two phases.
 */
import type { SessionSnapshot } from '@shared/daemonProtocol';
import {
  pendingReplySnapshot,
  pendingRunSnapshot,
  startupNotice,
} from '@/domain/sessionStartup';

const snapshotOf = (
  overrides: Partial<SessionSnapshot> = {},
): SessionSnapshot => ({
  cardId: 'crd_1',
  sessionId: null,
  status: 'working',
  checklist: [],
  messages: [],
  pendingApproval: null,
  lastError: null,
  ...overrides,
});

describe('startupNotice', () => {
  it('reports `starting` for a turn with no session id and nothing streamed', () => {
    expect(startupNotice(snapshotOf())).toBe('starting');
  });

  it('moves to `awaiting-response` once the SDK has reported a session id', () => {
    expect(startupNotice(snapshotOf({ sessionId: 'sess_live' }))).toBe(
      'awaiting-response',
    );
  });

  it('goes quiet as soon as the agent has said something', () => {
    const snapshot = snapshotOf({
      sessionId: 'sess_live',
      messages: [{ id: 'evt_1:0', kind: 'text', text: 'On it.', seq: 0 }],
    });

    expect(startupNotice(snapshot)).toBeNull();
  });

  it('goes quiet as soon as the agent has called a tool', () => {
    const snapshot = snapshotOf({
      sessionId: 'sess_live',
      checklist: [{ id: 'tu_1', label: 'Read: auth.py', done: false, seq: 0 }],
    });

    expect(startupNotice(snapshot)).toBeNull();
  });

  /**
   * A reply has the same dead window as a run: the user's message is on
   * screen, the turn is live, and nothing has come back yet. Output from
   * EARLIER turns must not count as this turn's answer, which is why the
   * rule looks only at what follows the newest user message.
   */
  it('returns to the notice on a reply, ignoring the previous turn’s output', () => {
    const snapshot = snapshotOf({
      sessionId: 'sess_live',
      checklist: [{ id: 'tu_1', label: 'Read: auth.py', done: true, seq: 0 }],
      messages: [
        { id: 'evt_1:0', kind: 'text', text: 'Here is what I found.', seq: 1 },
        { id: 'user:abc', kind: 'user', text: 'check the tests too', seq: 2 },
      ],
    });

    expect(startupNotice(snapshot)).toBe('awaiting-response');
  });

  it('goes quiet once the agent answers that reply', () => {
    const snapshot = snapshotOf({
      sessionId: 'sess_live',
      messages: [
        { id: 'user:abc', kind: 'user', text: 'check the tests too', seq: 0 },
        { id: 'evt_2:0', kind: 'text', text: 'Running them now.', seq: 1 },
      ],
    });

    expect(startupNotice(snapshot)).toBeNull();
  });

  // `waiting` has an Approve/Deny box on screen, and the terminal statuses
  // have their own result or error. None of them is a silent gap.
  it.each(['waiting', 'done', 'failed', 'interrupted'] as const)(
    'shows nothing for `%s`, which is never a silent wait',
    (status) => {
      expect(startupNotice(snapshotOf({ status }))).toBeNull();
    },
  );
});

/**
 * The daemon's own first snapshot is what normally puts a card into
 * `working`, and it cannot arrive until the daemon has spawned and
 * connected. These are the snapshots the renderer writes locally in the
 * meantime — the same trick `reportFailure` and AppShell's reattach
 * placeholder already use — so the transcript exists to show a notice at
 * all. The daemon's real snapshot replaces them wholesale.
 */
describe('the locally-written snapshot a turn starts from', () => {
  it('starts a run with an empty feed and no session id, so the notice reads `starting`', () => {
    const snapshot = pendingRunSnapshot('crd_1');

    expect(snapshot.status).toBe('working');
    expect(snapshot.checklist).toEqual([]);
    expect(snapshot.messages).toEqual([]);
    expect(startupNotice(snapshot)).toBe('starting');
  });

  /**
   * A run is deliberately not told the card's persisted `sessionId`: the
   * `run` op starts a fresh conversation rather than resuming, so claiming
   * a live session would skip the `starting` phase on every Run again.
   */
  it('does not carry a session id into a fresh run', () => {
    expect(pendingRunSnapshot('crd_1').sessionId).toBeNull();
  });

  it('keeps the conversation so far on a reply and appends what was typed', () => {
    const previous = snapshotOf({
      sessionId: 'sess_live',
      status: 'done',
      checklist: [{ id: 'tu_1', label: 'Read: auth.py', done: true, seq: 0 }],
      messages: [
        { id: 'evt_1:0', kind: 'text', text: 'Here is what I found.', seq: 1 },
      ],
    });

    const snapshot = pendingReplySnapshot(previous, 'check the tests too');

    expect(snapshot.status).toBe('working');
    expect(snapshot.checklist).toEqual(previous.checklist);
    expect(snapshot.messages).toHaveLength(2);
    expect(snapshot.messages[1]).toMatchObject({
      kind: 'user',
      text: 'check the tests too',
      // Mirrors the daemon's own shared counter (checklist + messages), so
      // the entry sorts where the daemon's echo of it will.
      seq: 2,
    });
  });

  it('shows the notice for the reply’s own turn, not the previous answer', () => {
    const previous = snapshotOf({
      sessionId: 'sess_live',
      status: 'done',
      messages: [
        { id: 'evt_1:0', kind: 'text', text: 'Here is what I found.', seq: 0 },
      ],
    });

    expect(startupNotice(pendingReplySnapshot(previous, 'more please'))).toBe(
      'awaiting-response',
    );
  });

  // Every turn start clears the previous turn's error, and the live token
  // figure is scoped to the turn in flight — the finished turn's tokens are
  // already in the ledger.
  it('clears the previous turn’s error and live usage', () => {
    const previous = snapshotOf({
      sessionId: 'sess_live',
      status: 'failed',
      lastError: 'Stopped by user',
      liveUsage: {
        req_1: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    });

    const snapshot = pendingReplySnapshot(previous, 'again');

    expect(snapshot.lastError).toBeNull();
    expect(snapshot.liveUsage).toEqual({});
  });
});
