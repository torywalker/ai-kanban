/** What the renderer asks main to watch for one card. */
export interface BuildWatchTarget {
  cardId: string;
  title: string;
  /** The primary clone; `gh` and `git` run here and infer the GitHub repo. */
  repo: string;
  /** The card's own branch (`kanban/<id>`), used to find its PR. */
  branch: string;
  /** A GitHub pull-request URL the user put in the card's link field. */
  prUrl: string | null;
  /** Set once Ship has merged the card into `targetBranch` locally. */
  ship: { sha: string; targetBranch: string } | null;
}

export type CheckState = 'pending' | 'pass' | 'fail';

export interface BuildCheck {
  name: string;
  state: CheckState;
  url: string | null;
}

export type BuildStatusKind =
  | 'pr'
  | 'push'
  | 'unpushed'
  | 'waiting'
  | 'no-builds'
  | 'none';

export interface BuildStatus {
  cardId: string;
  kind: BuildStatusKind;
  /** Where a click goes: the PR, or the workflow run. */
  url: string | null;
  checks: BuildCheck[];
  /** The last poll failed transiently; `checks` is the last known data. */
  stale: boolean;
}

/** `gh` is unusable until the user fixes it; polling is paused meanwhile. */
export interface BuildStatusPause {
  reason: string;
}

export interface BuildStatusUpdate {
  statuses: BuildStatus[];
  paused: BuildStatusPause | null;
}

export const PR_URL_PATTERN =
  /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/;

export function isPrUrl(value: string): boolean {
  return PR_URL_PATTERN.test(value.trim());
}

const FAIL_CONCLUSIONS = new Set([
  'FAILURE',
  'TIMED_OUT',
  'CANCELLED',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
]);
const PASS_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

/**
 * One check from `gh pr view --json statusCheckRollup` or one job from
 * `gh run view --json jobs`. Both carry a status plus a conclusion; legacy
 * status contexts carry a single `state` instead.
 */
export interface RawCheck {
  name?: string;
  context?: string;
  status?: string;
  conclusion?: string | null;
  state?: string;
  detailsUrl?: string;
  targetUrl?: string;
  url?: string;
}

export function normalizeCheck(raw: RawCheck): BuildCheck {
  const name = raw.name ?? raw.context ?? 'check';
  const url = raw.detailsUrl ?? raw.targetUrl ?? raw.url ?? null;
  const conclusion = (raw.conclusion ?? '').toUpperCase();
  const status = (raw.status ?? raw.state ?? '').toUpperCase();

  let state: CheckState = 'pending';
  if (conclusion) {
    if (PASS_CONCLUSIONS.has(conclusion)) state = 'pass';
    else if (FAIL_CONCLUSIONS.has(conclusion)) state = 'fail';
  } else if (status === 'SUCCESS') {
    state = 'pass';
  } else if (FAIL_CONCLUSIONS.has(status)) {
    state = 'fail';
  }
  return { name, state, url };
}

export function summarizeChecks(checks: BuildCheck[]): {
  failing: BuildCheck[];
  pending: number;
  passed: number;
  total: number;
  finished: boolean;
} {
  const failing = checks.filter((c) => c.state === 'fail');
  const pending = checks.filter((c) => c.state === 'pending').length;
  return {
    failing,
    pending,
    passed: checks.length - failing.length - pending,
    total: checks.length,
    finished: checks.length > 0 && pending === 0,
  };
}

export interface BuildNotice {
  key: string;
  title: string;
  body: string;
}

/**
 * The notifications this poll owes. A failed check notifies once per
 * (card, sha, check); the all-passed result once per (card, sha). A new push
 * changes the sha, so it starts fresh.
 */
export function noticesFor(
  target: { cardId: string; title: string },
  sha: string,
  checks: BuildCheck[],
): BuildNotice[] {
  const { failing, finished } = summarizeChecks(checks);
  const notices: BuildNotice[] = failing.map((check) => ({
    key: `${target.cardId}|${sha}|${check.name}`,
    title: 'Build step failed',
    body: `${target.title}: ${check.name}`,
  }));
  if (finished && failing.length === 0) {
    notices.push({
      key: `${target.cardId}|${sha}|ALL`,
      title: 'Build passed',
      body: target.title,
    });
  }
  return notices;
}
