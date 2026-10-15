/**
 * Regression test for the in-flight-call guard on `ensureDaemonRunning()`.
 * Before the fix, two callers invoking `ensureDaemonRunning()` concurrently
 * (before either had finished connecting) would each independently see
 * `client === null`, each fail to connect (no daemon up yet), and each
 * independently `spawn()` a daemon process — the second daemon's startup
 * unlinks the socket file the first daemon is bound to, orphaning the
 * first as an unreachable zombie. The fix caches the in-flight *promise*
 * of the connect/spawn attempt so concurrent callers all await the same
 * attempt instead of racing independent ones.
 *
 * `net`, `child_process`, and `electron` are mocked so this test observes
 * call counts without spawning a real daemon process or touching a real
 * socket.
 */
import { EventEmitter } from 'events';

const createConnectionMock = jest.fn();
const spawnMock = jest.fn();

/** What the app believes the current daemon bundle hashes to. */
let currentBuildId: string | null = 'build-current';
/** What, if anything, the running daemon recorded as its pid. */
let recordedPid: number | null = null;

jest.mock('net', () => ({
  createConnection: (...args: unknown[]) => createConnectionMock(...args),
}));

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

jest.mock('../main/daemon/daemonIdentity', () => ({
  computeBuildId: () => currentBuildId,
  // The real decision function's behaviour, restated rather than imported so
  // the mock stays self-contained; `daemonIdentity.test.ts` is what actually
  // pins that behaviour down. Must thread `activeTurns` the same way the
  // real function does — omitting it here made every test in this file
  // exercise a `shouldReplaceDaemon` that could never keep a mid-turn
  // daemon, so "leaves a stale daemon running while it still has a turn in
  // flight" silently took the eviction branch instead and hung for the
  // full Jest timeout waiting on socket-release events nothing in that
  // test ever drives.
  shouldReplaceDaemon: (
    expected: string | null,
    reported: string | null,
    activeTurns?: number,
  ) =>
    !!expected &&
    reported !== expected &&
    !(typeof activeTurns === 'number' && activeTurns > 0),
  pidFilePathFor: () => '/tmp/ai-kanban-test-userdata/session-daemon.pid',
  readDaemonPid: () => recordedPid,
}));

jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/tmp/ai-kanban-test-userdata'),
    isPackaged: false,
  },
}));

type FakeSocket = EventEmitter & {
  destroyed: boolean;
  write: jest.Mock;
  destroy: jest.Mock;
};
type FakeChild = EventEmitter & { unref: jest.Mock };

function makeFakeSocket(): FakeSocket {
  const socket = new EventEmitter() as FakeSocket;
  socket.destroyed = false;
  socket.write = jest.fn();
  // Part of the real `net.Socket` surface, and the eviction path calls it.
  socket.destroy = jest.fn(() => {
    socket.destroyed = true;
  });
  return socket;
}

/**
 * Answers the build-id handshake the way a real daemon does — as a framed
 * `pong` on the socket's data stream, decoded by the same decoder the socket
 * keeps for its lifetime.
 */
function answerPing(
  socket: FakeSocket,
  buildId?: string,
  activeTurns?: number,
): void {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { encodeFrame } = require('../main/daemon/framing');
  const pong: Record<string, unknown> = { event: 'pong' };
  if (buildId) pong.buildId = buildId;
  if (activeTurns !== undefined) pong.activeTurns = activeTurns;
  socket.emit('data', encodeFrame(pong));
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.unref = jest.fn();
  return child;
}

describe('sessionDaemonClient ensureDaemonRunning concurrency guard', () => {
  let sockets: FakeSocket[];
  let children: FakeChild[];

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    sockets = [];
    children = [];
    createConnectionMock.mockReset();
    spawnMock.mockReset();
    currentBuildId = 'build-current';
    recordedPid = null;

    createConnectionMock.mockImplementation(() => {
      const socket = makeFakeSocket();
      sockets.push(socket);
      return socket;
    });

    spawnMock.mockImplementation(() => {
      const child = makeFakeChild();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('two concurrent calls result in exactly one connect/spawn attempt, not two', async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    // Fire two concurrent calls before either has any chance to settle.
    const call1 = ensureDaemonRunning();
    const call2 = ensureDaemonRunning();

    // Both calls should share a single in-flight connect attempt: only one
    // net.createConnection() call so far, even though ensureDaemonRunning()
    // was invoked twice.
    expect(createConnectionMock).toHaveBeenCalledTimes(1);

    // No daemon is listening yet — fail the first connect attempt, which
    // should trigger exactly one spawn() and an immediate retry connect
    // (connectWithRetry attempts right away, not after a fixed delay),
    // shared by both callers.
    sockets[0].emit('error', new Error('ECONNREFUSED (test)'));

    // Let the catch handler's synchronous spawn()+first-retry-attempt run.
    await jest.advanceTimersByTimeAsync(0);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(createConnectionMock).toHaveBeenCalledTimes(2);

    // Succeed the retry connect — this should resolve both callers' calls,
    // since they were awaiting the same in-flight promise.
    sockets[1].emit('connect');

    await expect(Promise.all([call1, call2])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    // Still exactly one spawn and exactly two connect attempts total
    // (one failed initial probe + one successful post-spawn connect) for
    // BOTH callers combined — proving no second, independent spawn race
    // happened.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(createConnectionMock).toHaveBeenCalledTimes(2);
  });

  /**
   * Regression test for the real bug this replaced: a single fixed 500ms
   * wait before exactly one retry. On this machine the daemon's real
   * cold-start (spawning under `ELECTRON_RUN_AS_NODE`, then a dynamic
   * `import()` of the ESM-only Agent SDK) measured multiple seconds — far
   * past 500ms — so the one retry lost the race and the resulting ENOENT
   * propagated verbatim to the renderer as
   * "Error invoking remote method 'session:run': ... connect ENOENT ..."
   * even though the daemon went on to bind successfully moments later.
   * `connectWithRetry` polls instead of guessing a fixed wait, so it must
   * still succeed even after several failed attempts spanning well past
   * the old 500ms budget.
   */
  it('keeps retrying past the old fixed-500ms window until the daemon socket comes up', async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('error', new Error('ECONNREFUSED (test)'));
    await jest.advanceTimersByTimeAsync(0);
    expect(createConnectionMock).toHaveBeenCalledTimes(2);

    // First retry also fails — under the old fixed-500ms-then-one-retry
    // code, this alone would already have been fatal.
    sockets[1].emit('error', new Error('ECONNREFUSED (test)'));
    await jest.advanceTimersByTimeAsync(150);
    expect(createConnectionMock).toHaveBeenCalledTimes(3);

    // Second retry also fails — now well past the old 500ms budget.
    sockets[2].emit('error', new Error('ECONNREFUSED (test)'));
    await jest.advanceTimersByTimeAsync(150);
    expect(createConnectionMock).toHaveBeenCalledTimes(4);

    // The daemon finally finishes starting and this attempt succeeds.
    sockets[3].emit('connect');

    await expect(call).resolves.toBeUndefined();
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('gives up promptly if the daemon process exits before it starts listening, instead of waiting out the full retry window', async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('error', new Error('ECONNREFUSED (test)'));
    await jest.advanceTimersByTimeAsync(0);

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(createConnectionMock).toHaveBeenCalledTimes(2);

    // The spawned daemon process dies before ever binding its socket.
    children[0].emit('exit', 1, null);
    sockets[1].emit('error', new Error('ECONNREFUSED (test)'));

    await expect(call).rejects.toThrow(/exited before it started listening/);

    // No further retry attempts after the child died — nothing left to
    // wait for.
    expect(createConnectionMock).toHaveBeenCalledTimes(2);
  });

  it('a later call after the client disconnects starts a fresh attempt', async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const first = ensureDaemonRunning();
    sockets[0].emit('connect');
    // The socket's frame decoder is attached only once the connect promise
    // resolves, so the reply has to come a tick later or it lands before
    // anything is listening for it.
    await jest.advanceTimersByTimeAsync(0);
    // A daemon that was already listening has to identify its build before
    // the app will use it — see the handshake suite below.
    answerPing(sockets[0], 'build-current');
    await first;

    expect(createConnectionMock).toHaveBeenCalledTimes(1);

    // Simulate the daemon connection dropping.
    sockets[0].emit('close');

    const second = ensureDaemonRunning();
    expect(createConnectionMock).toHaveBeenCalledTimes(2);
    sockets[1].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[1], 'build-current');
    await second;

    expect(spawnMock).not.toHaveBeenCalled();
  });
});

/**
 * The daemon is spawned detached and unref'd so sessions survive the app
 * closing, and `ensureDaemonRunning` reuses whatever is already listening.
 * Those two facts together mean a rebuilt daemon bundle does not take effect
 * on its own — the app happily reconnects to the old process, and every
 * daemon-side change appears to do nothing with no error to explain it. That
 * is not hypothetical: usage rows went unwritten for a whole round of work
 * because the running daemon predated the code that writes them.
 */
describe('sessionDaemonClient build-id handshake', () => {
  let sockets: FakeSocket[];
  let children: FakeChild[];

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    sockets = [];
    children = [];
    createConnectionMock.mockReset();
    spawnMock.mockReset();
    currentBuildId = 'build-current';
    recordedPid = null;

    createConnectionMock.mockImplementation(() => {
      const socket = makeFakeSocket();
      sockets.push(socket);
      return socket;
    });
    spawnMock.mockImplementation(() => {
      const child = makeFakeChild();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reuses a daemon already running the current build', async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0], 'build-current');
    await call;

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('replaces a daemon running a different build', async () => {
    recordedPid = 4242;
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0], 'build-stale');

    // Eviction: SIGTERM the recorded pid, wait for the socket to be
    // released, then spawn a daemon from the current bundle.
    await jest.advanceTimersByTimeAsync(0);
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');

    sockets[1].emit(
      'error',
      new Error('ECONNREFUSED (test) — socket released'),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    sockets[2].emit('connect');
    await call;

    killSpy.mockRestore();
  });

  it('replaces a daemon too old to report a build id at all', async () => {
    // The exact case that hid usage recording: a daemon built before the
    // handshake existed answers `pong` with nothing in it.
    recordedPid = 4242;
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0]);

    await jest.advanceTimersByTimeAsync(0);
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');

    sockets[1].emit(
      'error',
      new Error('ECONNREFUSED (test) — socket released'),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    sockets[2].emit('connect');
    await call;

    killSpy.mockRestore();
  });

  it('replaces a daemon that never answers the handshake', async () => {
    recordedPid = 4242;
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    // No reply at all — a wedged daemon is no more usable than a stale one.
    await jest.advanceTimersByTimeAsync(2_000);

    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');

    sockets[1].emit(
      'error',
      new Error('ECONNREFUSED (test) — socket released'),
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    sockets[2].emit('connect');
    await call;

    killSpy.mockRestore();
  });

  /**
   * Eviction must yield to work in progress.
   *
   * In development the webpack watcher rebuilds the daemon bundle on every
   * source edit, so the build id stops matching constantly — including while
   * an agent turn is streaming. Evicting then throws away a turn whose
   * tokens are already spent and whose transcript is mid-flight, for a code
   * change nobody asked to apply at that moment. This is not hypothetical:
   * it killed a running session twice before the guard was wired up.
   */
  it('leaves a stale daemon running while it still has a turn in flight', async () => {
    recordedPid = 4242;
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { ensureDaemonRunning } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0], 'a-stale-build', 1);
    await call;

    expect(killSpy).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();

    killSpy.mockRestore();
  });

  it('evicts the stale daemon once its last turn has finished', async () => {
    recordedPid = 4242;
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { ensureDaemonRunning } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0], 'a-stale-build', 0);

    await jest.advanceTimersByTimeAsync(0);
    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');

    sockets[1].emit('error', new Error('ECONNREFUSED (test) — socket released'));
    await jest.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    sockets[2].emit('connect');
    await call;

    killSpy.mockRestore();
  });

  it('skips the handshake entirely when the app cannot hash its own bundle', async () => {
    // With no trustworthy expectation there is nothing to compare, so paying
    // a round-trip could not change the outcome — and evicting a live daemon
    // over a failed file read would turn a packaging hiccup into lost work.
    currentBuildId = null;

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
    } = require('../main/services/sessionDaemonClient');

    const call = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    await call;

    expect(sockets[0].write).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

/**
 * `restartDaemon` is the user-initiated equivalent of the automatic
 * build-mismatch eviction above: a Settings button lets someone kill a
 * wedged daemon on demand rather than waiting for a rebuild to trigger
 * eviction. It has to go through the exact same "signal the recorded pid,
 * wait for the socket to release, spawn fresh" path as the automatic case —
 * there is no separate "please shut down" request op a live daemon could
 * ignore differently.
 */
describe('sessionDaemonClient restartDaemon', () => {
  let sockets: FakeSocket[];
  let children: FakeChild[];

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    sockets = [];
    children = [];
    createConnectionMock.mockReset();
    spawnMock.mockReset();
    currentBuildId = 'build-current';
    recordedPid = null;

    createConnectionMock.mockImplementation(() => {
      const socket = makeFakeSocket();
      sockets.push(socket);
      return socket;
    });
    spawnMock.mockImplementation(() => {
      const child = makeFakeChild();
      children.push(child);
      return child;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('signals the recorded pid and spawns a fresh daemon', async () => {
    recordedPid = 4242;
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
      restartDaemon,
    } = require('../main/services/sessionDaemonClient');

    // A daemon is already running and identified — restartDaemon must evict
    // it even though its build id matches (unlike the automatic path, which
    // only evicts on mismatch).
    const initial = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0], 'build-current');
    await initial;
    expect(spawnMock).not.toHaveBeenCalled();

    const restart = restartDaemon();

    expect(killSpy).toHaveBeenCalledWith(4242, 'SIGTERM');

    // The release-poll opened by `terminateStaleDaemon` confirms the old
    // daemon's socket is no longer accepting connections.
    sockets[1].emit(
      'error',
      new Error('ECONNREFUSED (test) — socket released'),
    );
    await jest.advanceTimersByTimeAsync(0);

    // `restartDaemon` hands off to the public `ensureDaemonRunning`, which
    // (with the cached client cleared) probes for a listener of its own
    // before spawning — same as any other cold call to it.
    sockets[2].emit('error', new Error('ECONNREFUSED (test) — probe'));
    await jest.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    sockets[3].emit('connect');
    await restart;

    killSpy.mockRestore();
  });

  it('drops the cached client socket immediately rather than waiting on the old daemon to close it', async () => {
    recordedPid = 4242;
    const killSpy = jest.spyOn(process, 'kill').mockImplementation(() => true);

    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
      restartDaemon,
    } = require('../main/services/sessionDaemonClient');

    const initial = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0], 'build-current');
    await initial;

    const restart = restartDaemon();
    // Destroyed synchronously, before `restartDaemon` has awaited anything —
    // a caller racing in right after this call must never observe the old,
    // about-to-be-replaced socket as still the cached client.
    expect(sockets[0].destroy).toHaveBeenCalled();

    sockets[1].emit(
      'error',
      new Error('ECONNREFUSED (test) — socket released'),
    );
    await jest.advanceTimersByTimeAsync(0);
    sockets[2].emit('error', new Error('ECONNREFUSED (test) — probe'));
    await jest.advanceTimersByTimeAsync(0);
    sockets[3].emit('connect');
    await restart;

    killSpy.mockRestore();
  });

  it('spawns a fresh daemon even with no pid on file, rather than leaving none running', async () => {
    // No pid file (`recordedPid` stays null) — mirrors the "too old/never
    // wrote a pid" branch of the automatic path: nothing to signal, so
    // `terminateStaleDaemon` just warns and returns immediately, with no
    // release-poll socket at all, and restartDaemon still spawns a fresh
    // daemon over it via `ensureDaemonRunning`.
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const {
      ensureDaemonRunning,
      restartDaemon,
    } = require('../main/services/sessionDaemonClient');

    const initial = ensureDaemonRunning();
    sockets[0].emit('connect');
    await jest.advanceTimersByTimeAsync(0);
    answerPing(sockets[0], 'build-current');
    await initial;

    const restart = restartDaemon();
    await jest.advanceTimersByTimeAsync(0);

    sockets[1].emit('error', new Error('ECONNREFUSED (test) — probe'));
    await jest.advanceTimersByTimeAsync(0);
    expect(spawnMock).toHaveBeenCalledTimes(1);

    sockets[2].emit('connect');
    await restart;
  });
});
