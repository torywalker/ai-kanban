import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Which build of the daemon is running, and how the app gets rid of one
 * running the wrong build.
 *
 * The daemon is spawned `detached` + `unref()`'d so it survives the app
 * (sessions are meant to keep running across restarts), and
 * `ensureDaemonRunning` reuses whatever is already listening on the socket.
 * The consequence is not obvious and bites hard: a rebuilt daemon bundle
 * never takes effect by itself, because the app reconnects to the process
 * that is already there. Daemon-side changes appear to do nothing at all,
 * with no error anywhere — the failure mode that hid usage recording
 * completely until the stale process was killed by hand.
 *
 * Identifying the build closes that hole. The id is the bundle's own
 * content hash rather than a hand-maintained version constant, so it is
 * impossible to change daemon code and forget to bump it.
 */

/**
 * The bundle's content hash, or `null` when it cannot be read.
 *
 * Content rather than mtime: a rebuild that produces identical output
 * should NOT cost the user a restarted daemon (and, with it, every live
 * session), and mtime changes on every rebuild whether the code did or not.
 */
export function computeBuildId(bundlePath: string): string | null {
  try {
    return crypto
      .createHash('sha1')
      .update(fs.readFileSync(bundlePath))
      .digest('hex');
  } catch {
    return null;
  }
}

/**
 * Whether a daemon reporting `reported` should be replaced by one built
 * from `expected`.
 *
 * Fails SAFE in both directions, and the asymmetry is deliberate:
 *
 * - A daemon that reports no id at all is replaced. It predates the
 *   handshake, which means it also predates whatever else has changed
 *   since — precisely the stale process this exists to evict.
 * - A daemon is KEPT while it reports a turn in flight, however stale it is.
 * - A daemon is KEPT when the app cannot hash its own bundle. With no
 *   trustworthy expectation there is nothing to compare against, and
 *   killing a live daemon on the strength of a failed file read would
 *   escalate a packaging hiccup into interrupted agent work.
 */
export function shouldReplaceDaemon(
  expected: string | null,
  reported: string | null | undefined,
  activeTurns?: number,
): boolean {
  if (!expected) return false;
  if (reported === expected) return false;
  // Never evict a daemon that is mid-turn. A rebuilt bundle does not justify
  // destroying work already in progress: those tokens are spent, the
  // transcript is streaming, and the user asked for none of it. Editing
  // daemon source while a session runs is precisely when this triggers, so
  // the stale build is tolerated until the turn finishes — the next session
  // operation after that evicts it.
  //
  // An unreported count reads as idle: a build old enough to omit it is the
  // generation most in need of replacing, and it cannot be asked.
  if (typeof activeTurns === 'number' && activeTurns > 0) return false;
  return true;
}

/**
 * Where the daemon records its own pid, beside the socket file — the same
 * directory the session cache and the usage ledger live in, reached without
 * Electron's `app` (this process runs as plain Node).
 *
 * This exists because asking a stale daemon to shut down politely is
 * exactly what a stale daemon cannot do: a build old enough to lack the
 * handshake also lacks any new request op, and would ignore one silently.
 * A pid plus the SIGTERM handler the daemon already installs works on any
 * build that writes this file.
 */
export function pidFilePathFor(socketPath: string): string {
  return path.join(path.dirname(socketPath), 'session-daemon.pid');
}

/** Best-effort: an unwritable pid file must not stop the daemon from serving. */
export function writeDaemonPid(pidFilePath: string, pid: number): void {
  try {
    fs.mkdirSync(path.dirname(pidFilePath), { recursive: true });
    fs.writeFileSync(pidFilePath, String(pid));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('daemon: failed to write pid file', error);
  }
}

/**
 * The recorded pid, or `null` if there is no readable one — which is the
 * normal answer for any daemon started before this file existed, so callers
 * must have a path that copes with not knowing the pid.
 */
export function readDaemonPid(pidFilePath: string): number | null {
  try {
    const pid = Number.parseInt(
      fs.readFileSync(pidFilePath, 'utf8').trim(),
      10,
    );
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}
