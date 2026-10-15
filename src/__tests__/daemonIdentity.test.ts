/**
 * The session daemon is spawned `detached` + `unref()`'d so it outlives the
 * Electron app, and `ensureDaemonRunning` reuses any daemon already
 * listening on the socket. Those two properties together mean a rebuilt
 * daemon bundle NEVER takes effect on its own: the app reconnects to the
 * old process and every change to daemon code is silently ignored until
 * someone kills it by hand. That cost a full round of work once (usage rows
 * were never written because the running daemon predated the code that
 * writes them), which is why the app now identifies which build answered.
 *
 * A build id is the bundle's own content hash, so it changes exactly when
 * the code the daemon is running changes — no version constant anyone has
 * to remember to bump.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  computeBuildId,
  pidFilePathFor,
  readDaemonPid,
  shouldReplaceDaemon,
  writeDaemonPid,
} from '../main/daemon/daemonIdentity';

describe('computeBuildId', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-kanban-build-id-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is stable for unchanged contents', () => {
    const file = path.join(dir, 'daemon.js');
    fs.writeFileSync(file, 'console.log(1);');
    expect(computeBuildId(file)).toBe(computeBuildId(file));
  });

  it('changes when the bundle contents change — the whole point of hashing', () => {
    const file = path.join(dir, 'daemon.js');
    fs.writeFileSync(file, 'console.log(1);');
    const before = computeBuildId(file);
    fs.writeFileSync(file, 'console.log(2);');
    expect(computeBuildId(file)).not.toBe(before);
  });

  it('does not depend on the path, only the contents', () => {
    const a = path.join(dir, 'a.js');
    const b = path.join(dir, 'b.js');
    fs.writeFileSync(a, 'same');
    fs.writeFileSync(b, 'same');
    expect(computeBuildId(a)).toBe(computeBuildId(b));
  });

  it('returns null for a bundle that cannot be read rather than throwing', () => {
    // A missing bundle is a packaging problem, not a reason to fail the
    // handshake and kill a working daemon — see `shouldReplaceDaemon`.
    expect(computeBuildId(path.join(dir, 'absent.js'))).toBeNull();
  });
});

describe('shouldReplaceDaemon', () => {
  it('keeps a daemon running the same build', () => {
    expect(shouldReplaceDaemon('abc123', 'abc123')).toBe(false);
  });

  it('replaces a daemon running a different build', () => {
    expect(shouldReplaceDaemon('abc123', 'def456')).toBe(true);
  });

  it('replaces a daemon too old to report a build id at all', () => {
    // Exactly the case that caused this: a daemon built before the
    // handshake existed answers `pong` with no build id.
    expect(shouldReplaceDaemon('abc123', undefined)).toBe(true);
    expect(shouldReplaceDaemon('abc123', null)).toBe(true);
  });

  /**
   * The eviction has to yield to work in progress. A rebuilt bundle is not
   * worth destroying a running agent turn for: the tokens are already spent,
   * the transcript is mid-stream, and the user did not ask for any of it.
   * Editing daemon source while a session runs is exactly when this fires,
   * so "wrong build" alone must not be enough.
   */
  it('leaves a stale daemon alone while it still has a turn in flight', () => {
    expect(shouldReplaceDaemon('abc123', 'def456', 1)).toBe(false);
    expect(shouldReplaceDaemon('abc123', undefined, 3)).toBe(false);
  });

  it('replaces the stale daemon as soon as it goes idle', () => {
    expect(shouldReplaceDaemon('abc123', 'def456', 0)).toBe(true);
  });

  it('treats an unreported turn count as idle, since older builds never say', () => {
    // A daemon too old to report a build id is also too old to report its
    // turn count, and that generation is the one most in need of eviction.
    expect(shouldReplaceDaemon('abc123', 'def456', undefined)).toBe(true);
  });

  it('keeps the running daemon when the app cannot hash its own bundle', () => {
    // Without a trustworthy expectation there is nothing to compare, and
    // killing a live daemon — possibly mid-turn — on the strength of a
    // failed file read would turn a packaging hiccup into lost agent work.
    expect(shouldReplaceDaemon(null, 'def456')).toBe(false);
    expect(shouldReplaceDaemon(null, undefined)).toBe(false);
  });
});

describe('daemon pid file', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-kanban-pid-test-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('sits beside the socket, like the cache and the ledger', () => {
    expect(pidFilePathFor('/some/userData/session-daemon.sock')).toBe(
      '/some/userData/session-daemon.pid',
    );
  });

  it('round-trips the pid', () => {
    const file = path.join(dir, 'session-daemon.pid');
    writeDaemonPid(file, 4242);
    expect(readDaemonPid(file)).toBe(4242);
  });

  it('reads null when no pid file was ever written', () => {
    // True of any daemon started before this file existed — the reason the
    // replace path cannot rely on it alone.
    expect(readDaemonPid(path.join(dir, 'absent.pid'))).toBeNull();
  });

  it('reads null for a garbage pid file rather than returning NaN', () => {
    const file = path.join(dir, 'session-daemon.pid');
    fs.writeFileSync(file, 'not-a-pid');
    expect(readDaemonPid(file)).toBeNull();
  });
});
