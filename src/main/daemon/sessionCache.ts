import fs from 'fs';
import path from 'path';
import type { SessionSnapshot } from '@shared/daemonProtocol';

/**
 * Where each card's last-known snapshot is cached to disk, so a fresh
 * daemon — after a crash, or the app relaunching once the previous daemon
 * was killed — can answer `getState`/`reply` with the real prior
 * checklist/transcript instead of nothing at all. The Agent SDK's own
 * `resume` continues the underlying Claude conversation across that gap
 * (verified live — see `resolveResumeSessionId` in turnLifecycle.ts), but
 * it does not replay history to this process's own message stream, so
 * without this cache the UI's transcript would restart empty every time.
 *
 * Lives next to the socket file (same directory this daemon is handed via
 * argv) rather than under Electron's `app.getPath('userData')` — this
 * process runs under `ELECTRON_RUN_AS_NODE`, plain Node, with no access to
 * Electron APIs at all. The socket's own directory IS that same userData
 * path, just reached without needing `app`.
 */
export function cacheDirFor(socketPath: string): string {
  return path.join(path.dirname(socketPath), 'agent-sessions-cache');
}

function cacheFilePath(cacheDir: string, cardId: string): string {
  return path.join(cacheDir, `${cardId}.json`);
}

/**
 * Best-effort write. A cache write failure (disk full, permissions) must
 * never block or crash a live session — this cache exists to help a
 * future reattach, it is not a durability guarantee this daemon depends
 * on to keep functioning right now.
 */
export function writeCachedSnapshot(cacheDir: string, snapshot: SessionSnapshot): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFilePath(cacheDir, snapshot.cardId), JSON.stringify(snapshot));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('daemon: failed to write session cache', error);
  }
}

/**
 * Returns `null` for a missing, unreadable, or malformed cache entry —
 * treated identically to "no cache exists" by every caller. Deliberately
 * not schema-validated the way the document file is: this is an
 * easily-regenerable internal cache, not the user's data, so a corrupt
 * entry is simply ignored rather than needing a recovery strategy.
 */
export function readCachedSnapshot(
  cacheDir: string,
  cardId: string,
): SessionSnapshot | null {
  try {
    const raw = fs.readFileSync(cacheFilePath(cacheDir, cardId), 'utf8');
    return JSON.parse(raw) as SessionSnapshot;
  } catch {
    return null;
  }
}
