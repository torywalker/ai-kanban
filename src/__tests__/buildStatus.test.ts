import {
  createBuildStatusService,
  type Exec,
  type ExecResult,
  type PersistedBuildState,
} from '../main/services/buildStatus';
import {
  isPrUrl,
  noticesFor,
  normalizeCheck,
  type BuildNotice,
  type BuildStatus,
  type BuildStatusUpdate,
  type BuildWatchTarget,
} from '../shared/buildStatus';

const ok = (stdout: string): ExecResult => ({ ok: true, stdout });
const fail = (stderr: string, code: number | null = 1): ExecResult => ({
  ok: false,
  stderr,
  code,
});

const baseTarget: BuildWatchTarget = {
  cardId: 'crd_1',
  title: 'My card',
  repo: '/repo',
  branch: 'kanban/crd_1',
  prUrl: null,
  ship: null,
};

function setup(
  handler: (cmd: string, args: string[]) => ExecResult,
  persist: Partial<Parameters<typeof createBuildStatusService>[0]> = {},
) {
  let time = 1_000_000;
  const notices: BuildNotice[] = [];
  const updates: BuildStatusUpdate[] = [];
  const exec: Exec = async (cmd, args) => handler(cmd, args);
  const service = createBuildStatusService({
    exec,
    notify: (n) => notices.push(n),
    emit: (u) => updates.push(u),
    now: () => time,
    ...persist,
  });
  return {
    service,
    notices,
    updates,
    last: () => updates[updates.length - 1],
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe('check normalization', () => {
  it('maps check runs and legacy status contexts', () => {
    expect(
      normalizeCheck({ name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' })
        .state,
    ).toBe('pass');
    expect(
      normalizeCheck({ name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' })
        .state,
    ).toBe('fail');
    expect(normalizeCheck({ name: 'a', status: 'IN_PROGRESS' }).state).toBe(
      'pending',
    );
    expect(normalizeCheck({ context: 'jira', state: 'SUCCESS' }).state).toBe(
      'pass',
    );
    // gh run view reports lowercase conclusions
    expect(
      normalizeCheck({ name: 'j', status: 'completed', conclusion: 'failure' })
        .state,
    ).toBe('fail');
  });

  it('recognises PR urls', () => {
    expect(isPrUrl('https://github.com/bankrate/bankrate-brain/pull/40')).toBe(
      true,
    );
    expect(isPrUrl('https://example.com/pull/1')).toBe(false);
  });
});

describe('notices', () => {
  it('sends one failure notice per build, and the final pass only when nothing failed', () => {
    const failed = noticesFor({ repo: 'r', title: 't' }, 'sha1', [
      { name: 'lint', state: 'fail', url: null },
      { name: 'test', state: 'fail', url: null },
      { name: 'build', state: 'pass', url: null },
    ]);
    expect(failed.map((n) => n.key)).toEqual(['r|sha1|FAIL']);
    expect(failed[0].body).toBe('t: lint, test');

    const passed = noticesFor({ repo: 'r', title: 't' }, 'sha1', [
      { name: 'build', state: 'pass', url: null },
    ]);
    expect(passed.map((n) => n.key)).toEqual(['r|sha1|ALL']);

    expect(
      noticesFor({ repo: 'r', title: 't' }, 'sha1', [
        { name: 'build', state: 'pending', url: null },
      ]),
    ).toEqual([]);
  });
});

describe('build status service', () => {
  const prView = (rollup: unknown[], state = 'OPEN') =>
    ok(
      JSON.stringify({
        url: 'https://github.com/o/r/pull/1',
        state,
        headRefOid: 'abc',
        statusCheckRollup: rollup,
      }),
    );

  it('finds the PR by branch, reports a failure once, and does not repeat it', async () => {
    const { service, notices, last, advance } = setup((cmd, args) => {
      if (args[0] === 'pr' && args[1] === 'list') {
        return ok('[{"url":"https://github.com/o/r/pull/1"}]');
      }
      return prView([
        { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
        { name: 'build', status: 'IN_PROGRESS' },
      ]);
    });

    service.setTargets([baseTarget]);
    await service.tick();
    expect(last().statuses[0].kind).toBe('pr');
    expect(notices.map((n) => n.body)).toEqual(['My card: lint']);

    advance(60_000);
    await service.tick();
    expect(notices).toHaveLength(1);
  });

  it('does not announce a build that was already green at startup', async () => {
    const { service, notices } = setup((cmd, args) =>
      args[1] === 'list'
        ? ok('[{"url":"https://github.com/o/r/pull/1"}]')
        : prView([{ name: 'b', status: 'COMPLETED', conclusion: 'SUCCESS' }]),
    );
    service.setTargets([baseTarget]);
    await service.tick();
    expect(notices).toEqual([]);
  });

  it('tracks a shipped commit: unpushed, then the run that contains it', async () => {
    let pushed = false;
    const { service, last, advance } = setup((cmd, args) => {
      if (args[0] === 'pr') return ok('[]');
      if (cmd === 'git' && args[0] === 'fetch') return ok('');
      if (cmd === 'git' && args[0] === 'merge-base') {
        const descendant = args[3];
        if (descendant === 'origin/qa') return pushed ? ok('') : fail('', 1);
        // run "r-old" predates the ship, "r-new" contains it
        return descendant === 'r-new' ? ok('') : fail('', 1);
      }
      if (args[0] === 'run' && args[1] === 'list') {
        return ok(
          JSON.stringify([
            { databaseId: 2, headSha: 'r-new', createdAt: '2026-01-02' },
            { databaseId: 1, headSha: 'r-old', createdAt: '2026-01-01' },
          ]),
        );
      }
      return ok(
        JSON.stringify({
          url: 'https://github.com/o/r/actions/runs/2',
          jobs: [
            { name: 'deploy', status: 'completed', conclusion: 'success' },
          ],
        }),
      );
    });

    service.setTargets([
      { ...baseTarget, ship: { sha: 'shipsha', targetBranch: 'qa' } },
    ]);
    await service.tick();
    expect(last().statuses[0].kind).toBe('unpushed');

    pushed = true;
    advance(61_000);
    await service.tick();
    const status = last().statuses[0];
    expect(status.kind).toBe('push');
    expect(status.checks.map((c) => c.state)).toEqual(['pass']);
  });

  it('reports the newest run containing the shipped commit, not the first', async () => {
    const { service, last } = setup((cmd, args) => {
      if (args[0] === 'pr') return ok('[]');
      if (cmd === 'git') return ok('');
      if (args[0] === 'run' && args[1] === 'list') {
        return ok(
          JSON.stringify([
            { databaseId: 2, headSha: 'fix', createdAt: '2026-01-02' },
            { databaseId: 1, headSha: 'broken', createdAt: '2026-01-01' },
          ]),
        );
      }
      const passed = args[2] === '2';
      return ok(
        JSON.stringify({
          url: `https://github.com/o/r/actions/runs/${args[2]}`,
          jobs: [
            {
              name: 'deploy',
              status: 'completed',
              conclusion: passed ? 'success' : 'failure',
            },
          ],
        }),
      );
    });
    service.setTargets([
      { ...baseTarget, ship: { sha: 'shipsha', targetBranch: 'qa' } },
    ]);
    await service.tick();
    expect(last().statuses[0].checks.map((c) => c.state)).toEqual(['pass']);
  });

  it("shows the previous run's status as stale until the first poll lands", async () => {
    const saved: BuildStatus = {
      cardId: 'crd_1',
      kind: 'pr',
      url: 'u',
      checks: [{ name: 'lint', state: 'fail', url: null }],
      stale: false,
    };
    const { service, updates } = setup(() => fail('boom', 1), {
      load: () => ({ statuses: [saved], notified: [] }),
    });
    service.setTargets([baseTarget]);
    expect(updates[0].statuses[0]).toMatchObject({ kind: 'pr', stale: true });
  });

  it('does not re-announce a failure it already announced before a restart', async () => {
    const handler = (cmd: string, args: string[]) =>
      args[1] === 'list'
        ? ok('[{"url":"https://github.com/o/r/pull/1"}]')
        : prView([
            { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
          ]);
    let state: PersistedBuildState | undefined;
    const withSave = setup(handler, {
      save: (s) => {
        state = s;
      },
    });
    withSave.service.setTargets([baseTarget]);
    await withSave.service.tick();
    expect(withSave.notices).toHaveLength(1);

    const restarted = setup(handler, { load: () => state! });
    restarted.service.setTargets([baseTarget]);
    await restarted.service.tick();
    expect(restarted.notices).toEqual([]);
  });

  it('sends one notification for cards that share a branch', async () => {
    const { service, notices } = setup((cmd, args) => {
      if (args[0] === 'pr') return ok('[]');
      if (cmd === 'git') return ok('');
      if (args[0] === 'run' && args[1] === 'list') {
        return ok(
          JSON.stringify([
            { databaseId: 1, headSha: 'tip', createdAt: '2026-01-01' },
          ]),
        );
      }
      return ok(
        JSON.stringify({
          url: 'https://github.com/o/r/actions/runs/1',
          jobs: [
            { name: 'deploy', status: 'completed', conclusion: 'failure' },
          ],
        }),
      );
    });
    const ship = { sha: 'shipsha', targetBranch: 'qa' };
    service.setTargets([
      { ...baseTarget, ship },
      { ...baseTarget, cardId: 'crd_2', title: 'Other card', ship },
    ]);
    await service.tick();
    expect(notices).toHaveLength(1);
    expect(notices[0].body).toBe('My card, Other card: deploy');
  });

  it('shows no-builds after the grace period when nothing runs', async () => {
    const { service, last, advance } = setup((cmd, args) => {
      if (args[0] === 'pr') return ok('[]');
      if (args[0] === 'run') return ok('[]');
      return ok('');
    });
    service.setTargets([
      { ...baseTarget, ship: { sha: 'shipsha', targetBranch: 'feat' } },
    ]);
    await service.tick();
    expect(last().statuses[0].kind).toBe('waiting');
    advance(3 * 60_000);
    await service.tick();
    expect(last().statuses[0].kind).toBe('no-builds');
  });

  it('pauses on an unusable gh and never reports it as a failed build', async () => {
    const { service, last, notices } = setup(() =>
      fail('To get started with GitHub CLI, please run: gh auth login'),
    );
    service.setTargets([baseTarget]);
    await service.tick();
    expect(last().paused?.reason).toContain('gh auth login');
    expect(notices).toEqual([]);
  });

  it('marks data stale on a transient failure instead of failing the build', async () => {
    let broken = false;
    const { service, last, advance } = setup((cmd, args) => {
      if (broken) return fail('network unreachable');
      return args[1] === 'list'
        ? ok('[{"url":"https://github.com/o/r/pull/1"}]')
        : prView([{ name: 'b', status: 'IN_PROGRESS' }]);
    });
    service.setTargets([baseTarget]);
    await service.tick();
    broken = true;
    advance(31_000);
    await service.tick();
    const status = last().statuses[0];
    expect(status.stale).toBe(true);
    expect(status.checks.map((c) => c.state)).toEqual(['pending']);
  });

  it('shares gh calls between cards in one repo', async () => {
    const calls: string[] = [];
    const { service, last } = setup((cmd, args) => {
      if (cmd === 'gh') calls.push(args.slice(0, 2).join(' '));
      if (args[0] === 'pr') return ok('[]');
      if (cmd === 'git') return ok('');
      if (args[1] === 'list') {
        return ok('[{"databaseId":1,"headSha":"s","createdAt":"2026-01-01"}]');
      }
      return ok(
        '{"url":"u","jobs":[{"name":"b","status":"completed","conclusion":"success"}]}',
      );
    });
    const ship = { sha: 's', targetBranch: 'qa' };
    service.setTargets(
      ['crd_1', 'crd_2', 'crd_3'].map((cardId) => ({
        ...baseTarget,
        cardId,
        branch: `kanban/${cardId}`,
        ship,
      })),
    );
    await service.tick();
    expect(last().statuses.map((s) => s.kind)).toEqual([
      'push',
      'push',
      'push',
    ]);
    expect(calls.filter((c) => c === 'run list')).toHaveLength(1);
    expect(calls.filter((c) => c === 'run view')).toHaveLength(1);
  });

  it('stops polling for a while once GitHub says the rate limit is exceeded', async () => {
    let calls = 0;
    const { service, last, advance } = setup(() => {
      calls += 1;
      return fail('HTTP 403: API rate limit exceeded for user ID 1.');
    });
    service.setTargets(
      ['crd_1', 'crd_2', 'crd_3'].map((cardId) => ({
        ...baseTarget,
        cardId,
        branch: `kanban/${cardId}`,
      })),
    );
    await service.tick();
    // The first card hits the limit; the other two are not even tried.
    expect(calls).toBe(1);
    expect(last().statuses[0].error).toContain('rate limit exceeded');

    advance(60_000);
    await service.tick();
    expect(calls).toBe(1);

    advance(5 * 60_000);
    await service.tick();
    expect(calls).toBeGreaterThan(1);
  });

  it('re-sends current state when the renderer re-registers unchanged targets', async () => {
    const { service, updates } = setup((cmd, args) =>
      args[1] === 'list'
        ? ok('[{"url":"https://github.com/o/r/pull/1"}]')
        : prView([{ name: 'b', status: 'COMPLETED', conclusion: 'SUCCESS' }]),
    );
    service.setTargets([baseTarget]);
    await service.tick();
    const before = updates.length;

    // A reloaded window sends the same targets again and has an empty store.
    service.setTargets([baseTarget]);
    expect(updates.length).toBeGreaterThan(before);
    expect(updates[updates.length - 1].statuses[0].kind).toBe('pr');
  });

  it('keeps the last known status while a changed target is re-polled', async () => {
    const { service, updates } = setup((cmd, args) =>
      args[1] === 'list'
        ? ok('[{"url":"https://github.com/o/r/pull/1"}]')
        : prView([{ name: 'b', status: 'IN_PROGRESS' }]),
    );
    service.setTargets([baseTarget]);
    await service.tick();
    service.setTargets([{ ...baseTarget, title: 'Renamed' }]);
    expect(updates[updates.length - 1].statuses[0].kind).toBe('pr');
  });
});
