/**
 * Lets a fresh daemon (after a crash, or the app relaunching once the
 * previous daemon was killed) answer `getState`/`reply` with a card's
 * real prior checklist/transcript instead of nothing at all — verified
 * live that the Agent SDK's own `resume` continues the underlying
 * conversation across that gap but does NOT replay history into this
 * process's own message stream, so this cache is what actually recovers
 * the visible transcript.
 *
 * Real filesystem, not mocked: these are thin, deterministic wrappers
 * around `fs.writeFileSync`/`readFileSync`/`mkdirSync`, and a genuine
 * write-then-read round trip is simpler to get right and more convincing
 * than mocking `fs` and hoping the mock matches real semantics.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { SessionSnapshot } from '../shared/daemonProtocol';
import { cacheDirFor, readCachedSnapshot, writeCachedSnapshot } from '../main/daemon/sessionCache';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    cardId: 'crd_1',
    sessionId: 'sess_1',
    status: 'done',
    checklist: [{ id: 'tu_1', label: 'Read: a.py', done: true, seq: 0 }],
    messages: [{ id: 'evt_1:0', kind: 'text', text: 'Done.', seq: 1 }],
    pendingApproval: null,
    lastError: null,
    ...overrides,
  };
}

describe('cacheDirFor', () => {
  it('lives in a sibling directory next to the socket file, not inside it', () => {
    const dir = cacheDirFor('/some/userData/session-daemon.sock');
    expect(dir).toBe('/some/userData/agent-sessions-cache');
  });
});

describe('writeCachedSnapshot + readCachedSnapshot', () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-kanban-session-cache-test-'));
  });

  afterEach(() => {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  it('round-trips a snapshot exactly', () => {
    const original = snapshot();
    writeCachedSnapshot(cacheDir, original);
    expect(readCachedSnapshot(cacheDir, 'crd_1')).toEqual(original);
  });

  it('creates the cache directory itself if it does not exist yet', () => {
    const freshDir = path.join(cacheDir, 'not-created-yet');
    expect(fs.existsSync(freshDir)).toBe(false);
    writeCachedSnapshot(freshDir, snapshot());
    expect(fs.existsSync(freshDir)).toBe(true);
  });

  it('returns null for a card with no cache entry at all', () => {
    expect(readCachedSnapshot(cacheDir, 'crd_never_cached')).toBeNull();
  });

  it('returns null (not a throw) for a corrupt cache file', () => {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'crd_corrupt.json'), '{ not valid json');
    expect(readCachedSnapshot(cacheDir, 'crd_corrupt')).toBeNull();
  });

  it('keeps different cards in separate files, overwriting only the one written', () => {
    writeCachedSnapshot(cacheDir, snapshot({ cardId: 'crd_a', status: 'done' }));
    writeCachedSnapshot(cacheDir, snapshot({ cardId: 'crd_b', status: 'failed' }));
    writeCachedSnapshot(cacheDir, snapshot({ cardId: 'crd_a', status: 'interrupted' }));

    expect(readCachedSnapshot(cacheDir, 'crd_a')?.status).toBe('interrupted');
    expect(readCachedSnapshot(cacheDir, 'crd_b')?.status).toBe('failed');
  });
});
