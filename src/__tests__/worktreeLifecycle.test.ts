import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  assertManagedWorktree,
  ensureWorktree,
  removeWorktree,
  worktreePathFor,
} from '../main/services/worktree';
import { gitRefExists } from '../main/services/git';
import {
  gitExec,
  initRepo,
  plumbingCommit,
  rmRepo,
} from '../testUtils/gitRepo';

// Real `git worktree` subprocesses against temp repos, which outrun the 5s
// default once the whole suite competes for the machine.
jest.setTimeout(15_000);

describe('worktree lifecycle', () => {
  let repo: string;
  let userDataRoot: string;

  beforeEach(() => {
    repo = initRepo();
    userDataRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-kanban-user-data-test-'),
    );
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
    rmRepo(userDataRoot);
  });

  it('derives a stable path below the user data root', () => {
    const digest = crypto
      .createHash('sha1')
      .update(fs.realpathSync(repo))
      .digest('hex')
      .slice(0, 16);

    expect(worktreePathFor(userDataRoot, fs.realpathSync(repo), 'crd_test1'))
      .toBe(path.join(userDataRoot, 'worktrees', digest, 'crd_test1'));
  });

  it('creates, reuses, and removes a card worktree', async () => {
    const worktree = await ensureWorktree({
      userDataRoot,
      primary: repo,
      cardId: 'crd_test1',
      existing: null,
    });

    expect(worktree).toEqual({
      path: worktreePathFor(userDataRoot, fs.realpathSync(repo), 'crd_test1'),
      branch: 'kanban/crd_test1',
      recordedTargetBranch: 'main',
    });
    expect(fs.statSync(worktree.path).isDirectory()).toBe(true);
    expect(gitExec(worktree.path, ['branch', '--show-current']).trim()).toBe(
      'kanban/crd_test1',
    );
    expect(gitExec(worktree.path, ['rev-parse', 'HEAD']).trim()).toBe(
      gitExec(repo, ['rev-parse', 'HEAD']).trim(),
    );

    gitExec(repo, ['checkout', '-b', 'other']);
    const reused = await ensureWorktree({
      userDataRoot,
      primary: repo,
      cardId: 'crd_test1',
      existing: worktree,
    });
    expect(reused).toBe(worktree);
    expect(reused.recordedTargetBranch).toBe('main');

    await removeWorktree(repo, worktree);
    expect(fs.existsSync(worktree.path)).toBe(false);
    expect(await gitRefExists(repo, worktree.branch)).toBe(false);
  });

  it('rejects persisted worktree metadata outside the app-managed card path', async () => {
    await expect(
      assertManagedWorktree({
        userDataRoot,
        primary: repo,
        cardId: 'crd_test1',
        worktree: {
          path: repo,
          branch: 'kanban/crd_test1',
          recordedTargetBranch: 'main',
        },
      }),
    ).rejects.toThrow(
      'The card worktree record does not match an app-managed git worktree.',
    );
  });

  it('validates an app-created worktree before destructive use', async () => {
    const worktree = await ensureWorktree({
      userDataRoot,
      primary: repo,
      cardId: 'crd_managed',
      existing: null,
    });

    await expect(
      assertManagedWorktree({
        userDataRoot,
        primary: repo,
        cardId: 'crd_managed',
        worktree,
      }),
    ).resolves.toBe(fs.realpathSync(repo));
  });

  it('tolerates an already-absent recorded branch during removal', async () => {
    const worktree = await ensureWorktree({
      userDataRoot,
      primary: repo,
      cardId: 'crd_test1',
      existing: null,
    });

    await expect(
      removeWorktree(repo, {
        ...worktree,
        branch: 'kanban/already-absent',
      }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(worktree.path)).toBe(false);
  });

  it('propagates feature branch deletion failures', async () => {
    const protectedWorktree = await ensureWorktree({
      userDataRoot,
      primary: repo,
      cardId: 'crd_protected',
      existing: null,
    });
    gitExec(repo, ['worktree', 'remove', '--force', protectedWorktree.path]);
    gitExec(repo, ['checkout', protectedWorktree.branch]);

    const removableWorktree = await ensureWorktree({
      userDataRoot,
      primary: repo,
      cardId: 'crd_removable',
      existing: null,
    });

    await expect(
      removeWorktree(repo, {
        ...removableWorktree,
        branch: protectedWorktree.branch,
      }),
    ).rejects.toThrow();
    expect(await gitRefExists(repo, protectedWorktree.branch)).toBe(true);
  });

  it('attaches an existing feature branch after create reports it exists', async () => {
    gitExec(repo, ['branch', 'kanban/crd_test1']);

    const worktree = await ensureWorktree({
      userDataRoot,
      primary: repo,
      cardId: 'crd_test1',
      existing: null,
    });

    expect(gitExec(worktree.path, ['branch', '--show-current']).trim()).toBe(
      'kanban/crd_test1',
    );
    expect(worktree.recordedTargetBranch).toBe('main');
  });

  it('does not retry attach after an unrelated worktree add failure', async () => {
    const destination = worktreePathFor(
      userDataRoot,
      fs.realpathSync(repo),
      'crd_test1',
    );
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, 'blocker.txt'), 'occupied\n');

    await expect(
      ensureWorktree({
        userDataRoot,
        primary: repo,
        cardId: 'crd_test1',
        existing: null,
      }),
    ).rejects.toThrow();

    expect(fs.readFileSync(path.join(destination, 'blocker.txt'), 'utf8')).toBe(
      'occupied\n',
    );
  });

  it('rejects a non-git working directory', async () => {
    const outside = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-kanban-not-git-test-'),
    );
    try {
      let error: unknown;
      try {
        await ensureWorktree({
          userDataRoot,
          primary: outside,
          cardId: 'crd_test1',
          existing: null,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        'Working directory is not a git repository.',
      );
    } finally {
      rmRepo(outside);
    }
  });

  it('rejects a detached primary HEAD', async () => {
    gitExec(repo, ['checkout', '--detach']);

    let error: unknown;
    try {
      await ensureWorktree({
        userDataRoot,
        primary: repo,
        cardId: 'crd_test1',
        existing: null,
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'Cannot start a worktree from a detached HEAD. Check out a branch first.',
    );
  });
});
