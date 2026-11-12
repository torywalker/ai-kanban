import { execFile } from 'child_process';
import {
  noticesFor,
  normalizeCheck,
  summarizeChecks,
  type BuildCheck,
  type BuildNotice,
  type BuildStatus,
  type BuildStatusPause,
  type BuildStatusUpdate,
  type BuildWatchTarget,
  type RawCheck,
} from '../../shared/buildStatus';

export type ExecResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string; code: number | null };

export type Exec = (
  cmd: 'gh' | 'git',
  args: string[],
  cwd: string,
) => Promise<ExecResult>;

// A packaged app launched from Finder does not inherit the shell PATH, and
// `gh` usually lives in Homebrew's prefix.
const EXTRA_PATH = '/opt/homebrew/bin:/usr/local/bin';

export const defaultExec: Exec = (cmd, args, cwd) =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PATH: `${process.env.PATH}:${EXTRA_PATH}` },
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, stdout });
          return;
        }
        const { code } = error as { code?: unknown };
        resolve({
          ok: false,
          stderr: stderr || String(error),
          code: typeof code === 'number' ? code : null,
        });
      },
    );
  });

const TICK_MS = 10_000;
const RUNNING_MS = 30_000;
const SETTLED_MS = 5 * 60_000;
const NO_PR_MS = 2 * 60_000;
const UNPUSHED_MS = 60_000;
const WAITING_MS = 15_000;
const NO_BUILDS_AFTER_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const RUN_LIMIT = 50;

// What `gh` says when it cannot work at all, as opposed to a bad moment.
const GH_UNUSABLE =
  /auth login|not logged in|authentication|GH_TOKEN|SAML|ENOENT|command not found/i;

class PauseError extends Error {}

interface Entry {
  target: BuildWatchTarget;
  status: BuildStatus;
  nextDue: number;
  failures: number;
  /** A merged/closed PR never changes again. */
  done: boolean;
  /** When Ship's commit was first seen on the remote. */
  pushSeenAt: number | null;
  /** run headSha -> does it contain the shipped commit. Ancestry is immutable. */
  contains: Map<string, boolean>;
  seen: boolean;
}

export interface BuildStatusService {
  setTargets: (targets: BuildWatchTarget[]) => void;
  retry: () => void;
  tick: () => Promise<void>;
  start: () => void;
  stop: () => void;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

export function createBuildStatusService(deps: {
  exec: Exec;
  notify: (notice: BuildNotice) => void;
  emit: (update: BuildStatusUpdate) => void;
  /** Last known statuses from a previous run, shown (as stale) until re-polled. */
  load?: () => BuildStatus[];
  save?: (statuses: BuildStatus[]) => void;
  now?: () => number;
}): BuildStatusService {
  const now = deps.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const notified = new Set<string>();
  let paused: BuildStatusPause | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let lastEmitted = '';
  const restored = new Map(
    (deps.load?.() ?? []).map((status) => [status.cardId, status]),
  );

  // `force` is for a renderer that just (re)registered: its store may be empty
  // after a reload, so an unchanged update must still be delivered to it.
  function emit(force = false): void {
    const update: BuildStatusUpdate = {
      statuses: [...entries.values()].map((entry) => entry.status),
      paused,
    };
    const serialized = JSON.stringify(update);
    if (!force && serialized === lastEmitted) return;
    lastEmitted = serialized;
    deps.save?.(update.statuses);
    deps.emit(update);
  }

  async function run(
    cmd: 'gh' | 'git',
    args: string[],
    cwd: string,
  ): Promise<string> {
    const result = await deps.exec(cmd, args, cwd);
    if (result.ok) return result.stdout;
    if (cmd === 'gh' && GH_UNUSABLE.test(result.stderr)) {
      throw new PauseError(result.stderr.trim().split('\n')[0]);
    }
    throw new Error(result.stderr);
  }

  async function isAncestor(
    cwd: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    const result = await deps.exec(
      'git',
      ['merge-base', '--is-ancestor', ancestor, descendant],
      cwd,
    );
    if (result.ok) return true;
    // Exit 1 means "no"; anything else (unknown commit, not a repo) is an error.
    if (result.code === 1) return false;
    throw new Error(result.stderr);
  }

  function announce(entry: Entry, sha: string, checks: BuildCheck[]): void {
    const notices = noticesFor(entry.target, sha, checks);
    notices.forEach((notice) => {
      if (notified.has(notice.key)) return;
      notified.add(notice.key);
      // A build that was already green when the app started is not news.
      if (!entry.seen && notice.title === 'Build passed') return;
      deps.notify(notice);
    });
  }

  function settle(
    entry: Entry,
    status: Omit<BuildStatus, 'cardId' | 'stale'>,
    sha: string,
  ): void {
    const { target } = entry;
    announce(entry, sha, status.checks);
    entry.seen = true;
    entry.failures = 0;
    entry.status = { cardId: target.cardId, stale: false, ...status };
    const { pending } = summarizeChecks(status.checks);
    const running = pending > 0 || status.checks.length === 0;
    entry.nextDue = now() + (running ? RUNNING_MS : SETTLED_MS);
  }

  async function findPr(target: BuildWatchTarget): Promise<string | null> {
    if (target.prUrl) return target.prUrl;
    const out = await run(
      'gh',
      [
        'pr',
        'list',
        '--head',
        target.branch,
        '--state',
        'all',
        '--json',
        'url',
        '--limit',
        '1',
      ],
      target.repo,
    );
    return parseJson<{ url: string }[]>(out)[0]?.url ?? null;
  }

  async function pollPr(entry: Entry, prRef: string): Promise<void> {
    const out = await run(
      'gh',
      ['pr', 'view', prRef, '--json', 'url,state,headRefOid,statusCheckRollup'],
      entry.target.repo,
    );
    const pr = parseJson<{
      url: string;
      state: string;
      headRefOid: string;
      statusCheckRollup: RawCheck[] | null;
    }>(out);
    const checks = (pr.statusCheckRollup ?? []).map(normalizeCheck);
    settle(entry, { kind: 'pr', url: pr.url, checks }, pr.headRefOid);
    if (pr.state !== 'OPEN') entry.done = true;
  }

  async function pollShip(
    entry: Entry,
    ship: { sha: string; targetBranch: string },
  ): Promise<void> {
    const { repo, cardId } = entry.target;
    const remoteRef = `origin/${ship.targetBranch}`;
    await run('git', ['fetch', 'origin', ship.targetBranch], repo);

    if (!(await isAncestor(repo, ship.sha, remoteRef))) {
      entry.status = {
        cardId,
        kind: 'unpushed',
        url: null,
        checks: [],
        stale: false,
      };
      entry.nextDue = now() + UNPUSHED_MS;
      return;
    }
    entry.pushSeenAt ??= now();

    const out = await run(
      'gh',
      [
        'run',
        'list',
        '--branch',
        ship.targetBranch,
        '--limit',
        String(RUN_LIMIT),
        '--json',
        'databaseId,headSha,createdAt',
      ],
      repo,
    );
    const runs = parseJson<
      { databaseId: number; headSha: string; createdAt: string }[]
    >(out).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Newest first: a later push that fixes a red build must replace it.
    let headSha: string | null = null;
    for (let i = 0; i < runs.length && headSha === null; i += 1) {
      const candidate = runs[i];
      let contains = entry.contains.get(candidate.headSha);
      if (contains === undefined) {
        // eslint-disable-next-line no-await-in-loop
        contains = await isAncestor(repo, ship.sha, candidate.headSha);
        entry.contains.set(candidate.headSha, contains);
      }
      if (contains) headSha = candidate.headSha;
    }

    if (headSha === null) {
      const waited = now() - entry.pushSeenAt;
      const quiet = waited > NO_BUILDS_AFTER_MS;
      entry.status = {
        cardId,
        kind: quiet ? 'no-builds' : 'waiting',
        url: null,
        checks: [],
        stale: false,
      };
      entry.nextDue = now() + (quiet ? SETTLED_MS : WAITING_MS);
      return;
    }

    // One push can start several workflows; they all belong to this build.
    const sameCommit = runs.filter((r) => r.headSha === headSha);
    const checks: BuildCheck[] = [];
    let url: string | null = null;
    for (let i = 0; i < sameCommit.length; i += 1) {
      const candidate = sameCommit[i];
      // eslint-disable-next-line no-await-in-loop
      const detail = await run(
        'gh',
        ['run', 'view', String(candidate.databaseId), '--json', 'jobs,url'],
        repo,
      );
      const parsed = parseJson<{ url: string; jobs: RawCheck[] }>(detail);
      url ??= parsed.url;
      checks.push(...parsed.jobs.map(normalizeCheck));
    }
    // A click should land on what broke, not on whichever workflow listed first.
    const failedUrl = checks.find((c) => c.state === 'fail')?.url;
    settle(entry, { kind: 'push', url: failedUrl ?? url, checks }, headSha);
  }

  async function poll(entry: Entry): Promise<void> {
    const { target } = entry;
    const prRef = await findPr(target);
    if (prRef) {
      await pollPr(entry, prRef);
    } else if (target.ship) {
      await pollShip(entry, target.ship);
    } else {
      entry.status = {
        cardId: target.cardId,
        kind: 'none',
        url: null,
        checks: [],
        stale: false,
      };
      entry.nextDue = now() + NO_PR_MS;
    }
  }

  async function pollSafely(entry: Entry): Promise<void> {
    try {
      await poll(entry);
    } catch (error) {
      if (error instanceof PauseError) {
        paused = { reason: error.message };
        return;
      }
      // Keep the last known checks, but say they may be old. A transient
      // failure must never turn into a red build.
      entry.failures += 1;
      entry.status = { ...entry.status, stale: true };
      entry.nextDue =
        now() + Math.min(RUNNING_MS * 2 ** entry.failures, MAX_BACKOFF_MS);
    }
  }

  async function runDue(): Promise<void> {
    const due = [...entries.values()].filter(
      (entry) => !entry.done && entry.nextDue <= now(),
    );
    for (let i = 0; i < due.length && !paused; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await pollSafely(due[i]);
      emit();
    }
  }

  // Callers during a running pass wait for it instead of starting a second.
  function tick(): Promise<void> {
    if (paused) {
      emit();
      return Promise.resolve();
    }
    inFlight ??= runDue().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function setTargets(targets: BuildWatchTarget[]): void {
    const ids = new Set(targets.map((target) => target.cardId));
    [...entries.keys()].forEach((id) => {
      if (!ids.has(id)) entries.delete(id);
    });
    targets.forEach((target) => {
      const existing = entries.get(target.cardId);
      if (
        existing &&
        JSON.stringify(existing.target) === JSON.stringify(target)
      ) {
        return;
      }
      entries.set(target.cardId, {
        target,
        // Keep what was last known so the marker doesn't vanish while the
        // re-poll for the changed target is in flight.
        status: existing?.status ??
          (restored.has(target.cardId)
            ? { ...restored.get(target.cardId)!, stale: true }
            : {
                cardId: target.cardId,
                kind: 'none',
                url: null,
                checks: [],
                stale: false,
              }),
        nextDue: 0,
        failures: 0,
        done: false,
        pushSeenAt: existing?.pushSeenAt ?? null,
        contains: new Map(),
        seen: existing?.seen ?? false,
      });
    });
    emit(true);
    tick();
  }

  function retry(): void {
    paused = null;
    entries.forEach((entry) => {
      entry.nextDue = 0;
    });
    emit();
    tick();
  }

  return {
    setTargets,
    retry,
    tick,
    start: () => {
      if (timer) return;
      timer = setInterval(tick, TICK_MS);
      timer.unref?.();
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
