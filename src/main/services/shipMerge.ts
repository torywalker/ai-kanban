import fs from 'fs/promises';
import path from 'path';
import { git, gitHead, gitIsDirty, gitMergeInProgress } from './git';

const DIRTY_DESTINATION_ERROR =
  'Cannot ship into the checked-out branch while it has uncommitted changes.';

/**
 * A conflict marker line as `git merge` writes it: exactly seven characters,
 * then end-of-line or the space before a branch name. Seven and not "seven or
 * more" so that ordinary content — a Markdown `=======` rule under a heading,
 * a row of `>>>>>>>` in a diagram — cannot be mistaken for an unfinished
 * merge and cost the user a Ship.
 */
const CONFLICT_MARKER = /^(?:<{7}|={7}|>{7})(?: |$)/m;

function gitError(stderr: string): Error {
  return new Error(stderr.trim() || 'Git command failed.');
}

/**
 * Commits everything in the worktree — tracked edits and new files alike —
 * as a single snapshot. Ship does this itself instead of asking the agent to
 * commit, so what lands is exactly what is on disk.
 *
 * Hooks are skipped deliberately: this is a machine-made snapshot of work
 * that already exists in a throwaway checkout, and a hook that reformats or
 * rejects it would strand the changes the user just asked to ship.
 */
export async function commitAllInWorktree(
  worktreePath: string,
  message: string,
): Promise<void> {
  const staged = await git(worktreePath, ['add', '-A']);
  if (!staged.ok) {
    throw gitError(staged.stderr);
  }

  const committed = await git(worktreePath, [
    'commit',
    '--no-verify',
    '-m',
    message,
  ]);
  // `git commit` also fails when it finds nothing staged, and it reports that
  // on stdout with an empty stderr. A clean tree is the whole goal, so the
  // tree itself decides whether this failed.
  if (!committed.ok && (await gitIsDirty(worktreePath))) {
    throw gitError(committed.stderr);
  }
}

/**
 * How many commits the card branch has that the destination does not. Zero
 * means shipping it would land nothing, which `git merge --ff-only` reports
 * as the success "Already up to date." — so Ship has to ask this question
 * itself before it starts deleting the worktree.
 */
export async function countCommitsAhead(
  primary: string,
  destinationBranch: string,
  featureBranch: string,
): Promise<number> {
  const result = await git(primary, [
    'rev-list',
    '--count',
    `${destinationBranch}..${featureBranch}`,
  ]);
  if (!result.ok) {
    throw gitError(result.stderr);
  }
  return Number.parseInt(result.stdout.trim(), 10);
}

export async function abortMergeIfNeeded(worktreePath: string): Promise<void> {
  if (!(await gitMergeInProgress(worktreePath))) {
    return;
  }

  const result = await git(worktreePath, ['merge', '--abort']);
  if (!result.ok) {
    throw gitError(result.stderr);
  }
}

export async function mergeDestinationIntoWorktree(
  worktreePath: string,
  destinationBranch: string,
): Promise<'clean' | 'conflict' | { failed: string }> {
  const result = await git(worktreePath, [
    'merge',
    '--no-edit',
    destinationBranch,
  ]);
  if (result.ok) {
    return 'clean';
  }

  if (await gitMergeInProgress(worktreePath)) {
    return 'conflict';
  }

  return { failed: result.stderr };
}

/**
 * The paths git still has in a conflicted state. These stay unmerged in the
 * index until something stages them, which the agent resolving the conflict
 * is not permitted to do — so this is the list of files whose contents decide
 * whether the conflict is finished, not a list of remaining problems.
 */
export async function unmergedPaths(worktreePath: string): Promise<string[]> {
  const result = await git(worktreePath, [
    'diff',
    '--name-only',
    '--diff-filter=U',
    '-z',
  ]);
  if (!result.ok) {
    throw gitError(result.stderr);
  }
  return result.stdout.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Whether the conflicted files have been resolved, judged the only way it can
 * be judged when the resolver cannot stage anything: no conflict marker is
 * left in any of them. A path resolved by deletion counts as resolved.
 *
 * This reads the working tree rather than the index deliberately. Ship's
 * agents are told not to run `git add`, so an unmerged index entry says
 * nothing about whether the work is done.
 */
export async function conflictsResolved(
  worktreePath: string,
): Promise<boolean> {
  const paths = await unmergedPaths(worktreePath);
  const checks = await Promise.all(
    paths.map(async (relative) => {
      try {
        const contents = await fs.readFile(
          path.join(worktreePath, relative),
          'utf8',
        );
        return !CONFLICT_MARKER.test(contents);
      } catch (error) {
        // Gone from disk: the resolution was to delete it, which `git add -A`
        // stages as a deletion. Anything else — an unreadable file — is not
        // something a retry of the same turn can fix, so it is not treated as
        // an unresolved conflict either.
        if ((error as { code?: string }).code === 'ENOENT') return true;
        throw error;
      }
    }),
  );
  return checks.every(Boolean);
}

/**
 * Commits the merge the agent just resolved, concluding it with git's own
 * prepared merge message (which names the branches and the files that
 * conflicted).
 *
 * Ship does this itself for the same reason it makes the pre-merge snapshot
 * commit itself: what lands is exactly what is on disk, and a Ship can never
 * depend on the agent having been allowed to stage or commit. Hooks are
 * skipped to match `commitAllInWorktree` — a hook that rejected this would
 * strand a resolved merge no one else can finish.
 */
export async function concludeMergeInWorktree(
  worktreePath: string,
): Promise<void> {
  const staged = await git(worktreePath, ['add', '-A']);
  if (!staged.ok) {
    throw gitError(staged.stderr);
  }

  const committed = await git(worktreePath, [
    'commit',
    '--no-verify',
    '--no-edit',
  ]);
  // The merge being over is the outcome that matters, and `git commit` also
  // reports failure for a tree it considers empty, so MERGE_HEAD decides.
  if (!committed.ok && (await gitMergeInProgress(worktreePath))) {
    throw gitError(committed.stderr);
  }
}

async function resolveBranch(cwd: string, branch: string): Promise<string> {
  const result = await git(cwd, [
    'rev-parse',
    '--verify',
    `refs/heads/${branch}`,
  ]);
  if (!result.ok) {
    throw gitError(result.stderr);
  }
  return result.stdout.trim();
}

export async function fastForwardDestination(opts: {
  primary: string;
  destinationBranch: string;
  featureBranch: string;
}): Promise<void> {
  const { primary, destinationBranch, featureBranch } = opts;
  const head = await gitHead(primary);

  if (head.kind === 'branch' && head.name === destinationBranch) {
    if (await gitIsDirty(primary)) {
      throw new Error(DIRTY_DESTINATION_ERROR);
    }

    const mergeResult = await git(primary, [
      'merge',
      '--ff-only',
      featureBranch,
    ]);
    if (!mergeResult.ok) {
      throw gitError(mergeResult.stderr);
    }
    return;
  }

  const destinationOid = await resolveBranch(primary, destinationBranch);
  const featureOid = await resolveBranch(primary, featureBranch);
  const ancestorResult = await git(primary, [
    'merge-base',
    '--is-ancestor',
    destinationOid,
    featureOid,
  ]);
  if (!ancestorResult.ok) {
    if (ancestorResult.code === 1 && ancestorResult.stderr.trim() === '') {
      throw new Error(
        `Cannot fast-forward ${destinationBranch} to ${featureBranch}: the destination has commits the card branch does not contain.`,
      );
    }
    throw gitError(ancestorResult.stderr);
  }

  const worktreesResult = await git(primary, [
    'worktree',
    'list',
    '--porcelain',
  ]);
  if (!worktreesResult.ok) {
    throw gitError(worktreesResult.stderr);
  }
  const destinationRef = `refs/heads/${destinationBranch}`;
  const destinationIsCheckedOut = worktreesResult.stdout
    .split('\n')
    .some((line) => line === `branch ${destinationRef}`);
  if (destinationIsCheckedOut) {
    throw new Error(
      `Cannot fast-forward ${destinationBranch}: the destination branch is checked out in another worktree.`,
    );
  }

  const updateResult = await git(primary, [
    'update-ref',
    destinationRef,
    featureOid,
    destinationOid,
  ]);
  if (!updateResult.ok) {
    throw gitError(updateResult.stderr);
  }
}
