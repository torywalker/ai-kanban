import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  abortMergeIfNeeded,
  commitAllInWorktree,
  concludeMergeInWorktree,
  conflictsResolved,
  countCommitsAhead,
  fastForwardDestination,
  mergeDestinationIntoWorktree,
  unmergedPaths,
} from '../main/services/shipMerge';
import * as gitService from '../main/services/git';
import { gitIsDirty, gitMergeInProgress } from '../main/services/git';
import {
  gitExec,
  initRepo,
  plumbingCommit,
  rmRepo,
} from '../testUtils/gitRepo';

// Every case here drives real `git` against a temp repo, which routinely
// takes longer than Jest's 5s default once the whole suite is competing for
// the machine — the same allowance shipOrchestrator.test.ts makes.
jest.setTimeout(15_000);

function pointWorkingTreeAt(
  repo: string,
  branch: string,
  commit: string,
): void {
  gitExec(repo, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`]);
  gitExec(repo, ['reset', '--hard', commit]);
}

describe('ship merge primitives', () => {
  let repo: string;

  beforeEach(() => {
    repo = initRepo();
  });

  afterEach(() => {
    rmRepo(repo);
  });

  test('commits every change in the worktree, tracked or not', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    pointWorkingTreeAt(repo, 'main', base);
    fs.writeFileSync(path.join(repo, 'result.txt'), 'edited\n');
    fs.writeFileSync(path.join(repo, 'added.txt'), 'new\n');

    await commitAllInWorktree(repo, 'snapshot');

    await expect(gitIsDirty(repo)).resolves.toBe(false);
    expect(gitExec(repo, ['log', '-1', '--pretty=%s']).trim()).toBe('snapshot');
    expect(gitExec(repo, ['show', 'HEAD:result.txt'])).toBe('edited\n');
    expect(gitExec(repo, ['show', 'HEAD:added.txt'])).toBe('new\n');
  });

  test('counts only the commits the card branch adds to the destination', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['update-ref', 'refs/heads/behind', base]);
    plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    // The destination moves on its own, as it does while a card runs.
    const moved = plumbingCommit(repo, {
      files: { 'other.txt': 'moved\n' },
      message: 'moved',
      parent: base,
      ref: 'refs/heads/main',
    });
    pointWorkingTreeAt(repo, 'main', moved);

    // A branch that is merely behind adds nothing, which is the case that
    // used to look like a successful Ship.
    await expect(countCommitsAhead(repo, 'main', 'behind')).resolves.toBe(0);
    await expect(countCommitsAhead(repo, 'main', 'main')).resolves.toBe(0);
    await expect(countCommitsAhead(repo, 'main', 'feature')).resolves.toBe(1);
  });

  test('is a no-op on a clean worktree rather than an error', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    pointWorkingTreeAt(repo, 'main', base);

    await expect(
      commitAllInWorktree(repo, 'snapshot'),
    ).resolves.toBeUndefined();

    expect(gitExec(repo, ['rev-parse', 'HEAD']).trim()).toBe(base);
  });

  test('fast-forwards a clean checked-out destination and updates its working tree', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    const feature = plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'main', base);

    await fastForwardDestination({
      primary: repo,
      destinationBranch: 'main',
      featureBranch: 'feature',
    });

    expect(gitExec(repo, ['rev-parse', 'main']).trim()).toBe(feature);
    expect(fs.readFileSync(path.join(repo, 'result.txt'), 'utf8')).toBe(
      'feature\n',
    );
  });

  test('updates only a destination ref when it is not checked out', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['update-ref', 'refs/heads/topic', base]);
    const feature = plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'main', base);

    await fastForwardDestination({
      primary: repo,
      destinationBranch: 'topic',
      featureBranch: 'feature',
    });

    expect(gitExec(repo, ['rev-parse', 'topic']).trim()).toBe(feature);
    expect(gitExec(repo, ['rev-parse', 'main']).trim()).toBe(base);
    expect(fs.readFileSync(path.join(repo, 'result.txt'), 'utf8')).toBe(
      'base\n',
    );
  });

  test('refuses a dirty checked-out destination', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'main', base);
    fs.writeFileSync(path.join(repo, 'uncommitted.txt'), 'dirty\n');

    await expect(
      fastForwardDestination({
        primary: repo,
        destinationBranch: 'main',
        featureBranch: 'feature',
      }),
    ).rejects.toThrow(
      'Cannot ship into the checked-out branch while it has uncommitted changes.',
    );
    expect(gitExec(repo, ['rev-parse', 'main']).trim()).toBe(base);
  });

  test('allows a dirty primary when updating another branch ref', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['update-ref', 'refs/heads/topic', base]);
    const feature = plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'main', base);
    fs.writeFileSync(path.join(repo, 'uncommitted.txt'), 'dirty\n');

    await fastForwardDestination({
      primary: repo,
      destinationBranch: 'topic',
      featureBranch: 'feature',
    });

    expect(gitExec(repo, ['rev-parse', 'topic']).trim()).toBe(feature);
    expect(fs.readFileSync(path.join(repo, 'uncommitted.txt'), 'utf8')).toBe(
      'dirty\n',
    );
  });

  test('does not overwrite a destination ref that moves during update', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['update-ref', 'refs/heads/topic', base]);
    plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    const moved = plumbingCommit(repo, {
      files: { 'result.txt': 'moved\n' },
      message: 'moved',
      parent: base,
    });
    pointWorkingTreeAt(repo, 'main', base);

    const realGit = gitService.git;
    const gitSpy = jest
      .spyOn(gitService, 'git')
      .mockImplementation(async (cwd, args) => {
        if (args[0] === 'update-ref' && args[1] === 'refs/heads/topic') {
          await realGit(cwd, ['update-ref', 'refs/heads/topic', moved]);
        }
        return realGit(cwd, args);
      });

    try {
      await expect(
        fastForwardDestination({
          primary: repo,
          destinationBranch: 'topic',
          featureBranch: 'feature',
        }),
      ).rejects.toThrow();
    } finally {
      gitSpy.mockRestore();
    }

    expect(gitExec(repo, ['rev-parse', 'topic']).trim()).toBe(moved);
  });

  test('rejects a divergent ref-only destination without moving it', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    const destination = plumbingCommit(repo, {
      files: { 'result.txt': 'destination\n' },
      message: 'destination',
      parent: base,
      ref: 'refs/heads/topic',
    });
    plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'main', base);

    await expect(
      fastForwardDestination({
        primary: repo,
        destinationBranch: 'topic',
        featureBranch: 'feature',
      }),
    ).rejects.toThrow(
      'Cannot fast-forward topic to feature: the destination has commits the card branch does not contain.',
    );

    expect(gitExec(repo, ['rev-parse', 'topic']).trim()).toBe(destination);
    expect(fs.readFileSync(path.join(repo, 'result.txt'), 'utf8')).toBe(
      'base\n',
    );
  });

  test('refuses ref-only landing when destination is in a linked worktree', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/main',
    });
    gitExec(repo, ['update-ref', 'refs/heads/topic', base]);
    plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'main', base);

    const linkedParent = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-kanban-linked-worktree-'),
    );
    const linked = path.join(linkedParent, 'topic');
    gitExec(repo, ['worktree', 'add', linked, 'topic']);
    const linkedHead = gitExec(linked, ['rev-parse', 'HEAD']).trim();
    const linkedIndex = gitExec(linked, ['write-tree']).trim();
    const linkedStatus = gitExec(linked, ['status', '--porcelain']);

    try {
      await expect(
        fastForwardDestination({
          primary: repo,
          destinationBranch: 'topic',
          featureBranch: 'feature',
        }),
      ).rejects.toThrow(
        'Cannot fast-forward topic: the destination branch is checked out in another worktree.',
      );

      expect(gitExec(linked, ['rev-parse', 'HEAD']).trim()).toBe(linkedHead);
      expect(gitExec(linked, ['write-tree']).trim()).toBe(linkedIndex);
      expect(gitExec(linked, ['status', '--porcelain'])).toBe(linkedStatus);
      expect(fs.readFileSync(path.join(linked, 'result.txt'), 'utf8')).toBe(
        'base\n',
      );
    } finally {
      gitExec(repo, ['worktree', 'remove', '--force', linked]);
      rmRepo(linkedParent);
    }
  });

  test('abort is a no-op when no merge is in progress', async () => {
    const feature = plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'feature', feature);
    const index = gitExec(repo, ['write-tree']).trim();

    await abortMergeIfNeeded(repo);

    expect(gitExec(repo, ['rev-parse', 'HEAD']).trim()).toBe(feature);
    expect(gitExec(repo, ['write-tree']).trim()).toBe(index);
    expect(fs.readFileSync(path.join(repo, 'result.txt'), 'utf8')).toBe(
      'feature\n',
    );
  });

  test('checked-out non-fast-forward leaves branch and working tree unchanged', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
    });
    const destination = plumbingCommit(repo, {
      files: { 'result.txt': 'destination\n' },
      message: 'destination',
      parent: base,
      ref: 'refs/heads/main',
    });
    plumbingCommit(repo, {
      files: { 'result.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'main', destination);
    const index = gitExec(repo, ['write-tree']).trim();

    await expect(
      fastForwardDestination({
        primary: repo,
        destinationBranch: 'main',
        featureBranch: 'feature',
      }),
    ).rejects.toThrow();

    expect(gitExec(repo, ['rev-parse', 'main']).trim()).toBe(destination);
    expect(gitExec(repo, ['write-tree']).trim()).toBe(index);
    expect(fs.readFileSync(path.join(repo, 'result.txt'), 'utf8')).toBe(
      'destination\n',
    );
  });

  test('reports a real merge conflict and abort clears MERGE_HEAD', async () => {
    const base = plumbingCommit(repo, {
      files: { 'conflict.txt': 'base\n' },
      message: 'base',
    });
    plumbingCommit(repo, {
      files: { 'conflict.txt': 'destination\n' },
      message: 'destination',
      parent: base,
      ref: 'refs/heads/main',
    });
    const feature = plumbingCommit(repo, {
      files: { 'conflict.txt': 'feature\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'feature', feature);

    await expect(mergeDestinationIntoWorktree(repo, 'main')).resolves.toBe(
      'conflict',
    );
    await expect(gitMergeInProgress(repo)).resolves.toBe(true);

    await abortMergeIfNeeded(repo);

    await expect(gitMergeInProgress(repo)).resolves.toBe(false);
    expect(fs.readFileSync(path.join(repo, 'conflict.txt'), 'utf8')).toBe(
      'feature\n',
    );
  });

  test('returns stderr for merge failures without MERGE_HEAD', async () => {
    const base = plumbingCommit(repo, {
      files: { 'result.txt': 'base\n' },
      message: 'base',
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'feature', base);

    const result = await mergeDestinationIntoWorktree(repo, 'missing');

    expect(result).toEqual({
      failed: expect.stringContaining('missing'),
    });
    await expect(gitMergeInProgress(repo)).resolves.toBe(false);
  });
});

/**
 * Concluding a conflicted merge on the resolver's behalf. Ship's agents are
 * told not to run `git add` or `git commit` — many are configured to refuse
 * outright — so every one of these starts from a working tree that has been
 * edited and an index that still says "unmerged".
 */
describe('finishing a conflict the agent could not commit', () => {
  let repo: string;

  /** Leaves `repo` mid-merge, with `conflict.txt` unmerged. */
  async function conflictedRepo(): Promise<void> {
    const base = plumbingCommit(repo, {
      files: { 'conflict.txt': 'base\n', 'calm.txt': 'untouched\n' },
      message: 'base',
    });
    plumbingCommit(repo, {
      files: { 'conflict.txt': 'destination\n', 'calm.txt': 'untouched\n' },
      message: 'destination',
      parent: base,
      ref: 'refs/heads/main',
    });
    const feature = plumbingCommit(repo, {
      files: { 'conflict.txt': 'feature\n', 'calm.txt': 'untouched\n' },
      message: 'feature',
      parent: base,
      ref: 'refs/heads/feature',
    });
    pointWorkingTreeAt(repo, 'feature', feature);
    await expect(mergeDestinationIntoWorktree(repo, 'main')).resolves.toBe(
      'conflict',
    );
  }

  const conflictFile = () => path.join(repo, 'conflict.txt');

  beforeEach(() => {
    repo = initRepo();
  });

  afterEach(() => {
    rmRepo(repo);
  });

  test('lists the unmerged paths and calls them unresolved while markers remain', async () => {
    await conflictedRepo();

    await expect(unmergedPaths(repo)).resolves.toEqual(['conflict.txt']);
    await expect(conflictsResolved(repo)).resolves.toBe(false);
  });

  test('commits an edited-but-unstaged resolution as a real merge commit', async () => {
    await conflictedRepo();
    fs.writeFileSync(conflictFile(), 'feature and destination\n');

    await expect(conflictsResolved(repo)).resolves.toBe(true);
    await concludeMergeInWorktree(repo);

    await expect(gitMergeInProgress(repo)).resolves.toBe(false);
    await expect(gitIsDirty(repo)).resolves.toBe(false);
    expect(
      gitExec(repo, ['log', '-1', '--pretty=%p']).trim().split(' '),
    ).toHaveLength(2);
    expect(gitExec(repo, ['show', 'HEAD:conflict.txt'])).toBe(
      'feature and destination\n',
    );
  });

  test('treats a conflict resolved by deletion as resolved, and lands the deletion', async () => {
    await conflictedRepo();
    fs.rmSync(conflictFile());

    await expect(conflictsResolved(repo)).resolves.toBe(true);
    await concludeMergeInWorktree(repo);

    await expect(gitMergeInProgress(repo)).resolves.toBe(false);
    expect(
      gitExec(repo, ['ls-tree', '--name-only', 'HEAD']).trim().split('\n'),
    ).toEqual(['calm.txt']);
  });

  test('refuses to call a partial resolution resolved', async () => {
    await conflictedRepo();
    // Edited, but the markers are still in there.
    fs.appendFileSync(conflictFile(), 'still thinking\n');

    await expect(conflictsResolved(repo)).resolves.toBe(false);
  });

  test('does not mistake ordinary content for a conflict marker', async () => {
    await conflictedRepo();
    // A Markdown rule and a quoted diff: seven-or-more lookalikes that are
    // not what `git merge` writes.
    fs.writeFileSync(
      conflictFile(),
      ['Heading', '=========', '', '>>>>>>>>> quoted', ''].join('\n'),
    );

    await expect(conflictsResolved(repo)).resolves.toBe(true);
  });
});
