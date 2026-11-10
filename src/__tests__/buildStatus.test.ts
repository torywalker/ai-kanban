import {
  createBuildStatusService,
  type Exec,
  type ExecResult,
} from '../main/services/buildStatus';
import {
  isPrUrl,
  noticesFor,
  normalizeCheck,
  type BuildNotice,
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

function setup(handler: (cmd: string, args: string[]) => ExecResult) {
  let time = 1_000_000;
  const notices: BuildNotice[] = [];
  const updates: BuildStatusUpdate[] = [];
  const exec: Exec = async (cmd, args) => handler(cmd, args);
  const service = createBuildStatusService({
    exec,
    notify: (n) => notices.push(n),
    emit: (u) => updates.push(u),
    now: () => time,
  });
  return {
    service,
    notices,
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
  it('notifies each failed check, and the final pass only when nothing failed', () => {
    const failed = noticesFor({ cardId: 'c', title: 't' }, 'sha1', [
      { name: 'lint', state: 'fail', url: null },
      { name: 'build', state: 'pass', url: null },
    ]);
    expect(failed.map((n) => n.key)).toEqual(['c|sha1|lint']);

    const passed = noticesFor({ cardId: 'c', title: 't' }, 'sha1', [
      { name: 'build', state: 'pass', url: null },
    ]);
    expect(passed.map((n) => n.key)).toEqual(['c|sha1|ALL']);

    expect(
      noticesFor({ cardId: 'c', title: 't' }, 'sha1', [
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
          jobs: [{ name: 'deploy', status: 'completed', conclusion: 'success' }],
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
});
