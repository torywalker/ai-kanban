import fs from 'fs';
import path from 'path';
import {
  git,
  gitHead,
  gitIsDirty,
  gitMergeInProgress,
  gitRefExists,
  gitTopLevel,
} from '../main/services/git';
import {
  gitExec,
  initRepo,
  plumbingCommit,
  rmRepo,
} from '../testUtils/gitRepo';

// Real `git` subprocesses against temp repos, which outrun the 5s default
// once the whole suite competes for the machine.
jest.setTimeout(15_000);

describe('git', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
  });

  afterEach(() => {
    rmRepo(repo);
  });

  it('returns ok with stdout on success', async () => {
    const result = await git(repo, ['rev-parse', '--show-toplevel']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.stdout.trim()).toBe(fs.realpathSync(repo));
    }
  });

  it('returns ok false with stderr and code on failure', async () => {
    const result = await git(repo, ['rev-parse', '--verify', 'NOT_A_REF']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stderr.length).toBeGreaterThan(0);
      expect(typeof result.code).toBe('number');
    }
  });
});

describe('gitTopLevel', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
  });

  afterEach(() => {
    rmRepo(repo);
  });

  it('returns the repository root', async () => {
    expect(await gitTopLevel(repo)).toBe(fs.realpathSync(repo));
  });

  it('returns null outside a git repo', async () => {
    const outside = path.dirname(repo);
    expect(await gitTopLevel(outside)).toBeNull();
  });
});

describe('gitHead', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
    const hash = plumbingCommit(repo, {
      files: { 'README.md': 'init\n' },
      message: 'init',
    });
    gitExec(repo, ['update-ref', 'refs/heads/master', hash]);
    gitExec(repo, ['symbolic-ref', 'HEAD', 'refs/heads/master']);
    gitExec(repo, ['reset', '--hard', hash]);
  });

  afterEach(() => {
    rmRepo(repo);
  });

  it('returns branch name after checkout -b main', async () => {
    gitExec(repo, ['checkout', '-b', 'main']);
    expect(await gitHead(repo)).toEqual({ kind: 'branch', name: 'main' });
  });

  it('returns detached after checkout --detach', async () => {
    const hash = gitExec(repo, ['rev-parse', 'HEAD']).trim();
    gitExec(repo, ['checkout', '--detach', hash]);
    expect(await gitHead(repo)).toEqual({ kind: 'detached' });
  });
});

describe('gitIsDirty', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
    const hash = plumbingCommit(repo, {
      files: { 'README.md': 'init\n' },
      message: 'init',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    gitExec(repo, ['reset', '--hard', hash]);
  });

  afterEach(() => {
    rmRepo(repo);
  });

  it('is false on a clean tree', async () => {
    expect(await gitIsDirty(repo)).toBe(false);
  });

  it('is true after writing an untracked file', async () => {
    fs.writeFileSync(path.join(repo, 'dirty.txt'), 'change\n');
    expect(await gitIsDirty(repo)).toBe(true);
  });
});

describe('gitRefExists', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
    plumbingCommit(repo, {
      files: { 'README.md': 'init\n' },
      message: 'init',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  });

  afterEach(() => {
    rmRepo(repo);
  });

  it('returns true for an existing branch', async () => {
    expect(await gitRefExists(repo, 'main')).toBe(true);
  });

  it('returns false for a missing branch', async () => {
    expect(await gitRefExists(repo, 'no-such-branch')).toBe(false);
  });
});

describe('gitMergeInProgress', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
    const baseHash = plumbingCommit(repo, {
      files: { 'file.txt': 'base content\n' },
      message: 'base commit',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    gitExec(repo, ['reset', '--hard', baseHash]);

    gitExec(repo, ['branch', 'feature', baseHash]);
    gitExec(repo, ['checkout', 'feature']);
    plumbingCommit(repo, {
      files: { 'file.txt': 'feature content\n' },
      message: 'feature commit',
      ref: 'refs/heads/feature',
      parent: baseHash,
    });

    gitExec(repo, ['checkout', 'main']);
    const mainHash = plumbingCommit(repo, {
      files: { 'file.txt': 'main content\n' },
      message: 'main commit',
      ref: 'refs/heads/main',
      parent: baseHash,
    });
    gitExec(repo, ['reset', '--hard', mainHash]);
  });

  afterEach(() => {
    rmRepo(repo);
  });

  it('is false before a merge', async () => {
    expect(await gitMergeInProgress(repo)).toBe(false);
  });

  it('is true after a conflicted merge', async () => {
    await git(repo, ['merge', 'feature']);
    expect(await gitMergeInProgress(repo)).toBe(true);
  });
});
