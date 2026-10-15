import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import {
  featureBranchFor,
  SessionWorktree,
  WORKTREE_MISSING_ERROR,
} from '../../shared/worktree';
import { git, gitHead, gitRefExists, gitTopLevel } from './git';

export function worktreePathFor(
  userDataRoot: string,
  primaryRoot: string,
  cardId: string,
): string {
  const repositoryId = crypto
    .createHash('sha1')
    .update(primaryRoot)
    .digest('hex')
    .slice(0, 16);
  return path.join(userDataRoot, 'worktrees', repositoryId, cardId);
}

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

const INVALID_WORKTREE_ERROR =
  'The card worktree record does not match an app-managed git worktree.';

/**
 * Worktree metadata is persisted in the board document and returns through
 * renderer IPC, so it is input rather than authority. Validate every
 * destructive use against the path and branch main would have created.
 */
export async function assertManagedWorktree(opts: {
  userDataRoot: string;
  primary: string;
  cardId: string;
  worktree: SessionWorktree;
}): Promise<string> {
  const primaryRoot = await gitTopLevel(opts.primary);
  if (primaryRoot === null) {
    throw new Error('Working directory is not a git repository.');
  }

  const expectedBranch = featureBranchFor(opts.cardId);
  const expectedPath = worktreePathFor(
    opts.userDataRoot,
    primaryRoot,
    opts.cardId,
  );
  if (
    path.resolve(opts.worktree.path) !== path.resolve(expectedPath) ||
    opts.worktree.branch !== expectedBranch
  ) {
    throw new Error(INVALID_WORKTREE_ERROR);
  }

  let actualPath: string;
  let userDataPath: string;
  try {
    [actualPath, userDataPath] = await Promise.all([
      fs.realpath(opts.worktree.path),
      fs.realpath(opts.userDataRoot),
    ]);
  } catch {
    throw new Error(WORKTREE_MISSING_ERROR);
  }
  const relative = path.relative(userDataPath, actualPath);
  if (
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  ) {
    throw new Error(INVALID_WORKTREE_ERROR);
  }

  const worktreeRoot = await gitTopLevel(actualPath);
  const head = worktreeRoot ? await gitHead(actualPath) : null;
  if (
    worktreeRoot === null ||
    path.resolve(await fs.realpath(worktreeRoot)) !==
      path.resolve(actualPath) ||
    head?.kind !== 'branch' ||
    head.name !== opts.worktree.branch
  ) {
    throw new Error(INVALID_WORKTREE_ERROR);
  }
  return primaryRoot;
}

export async function ensureWorktree(opts: {
  userDataRoot: string;
  primary: string;
  cardId: string;
  existing: SessionWorktree | null;
}): Promise<SessionWorktree> {
  const primaryRoot = await gitTopLevel(opts.primary);
  if (primaryRoot === null) {
    throw new Error('Working directory is not a git repository.');
  }

  const head = await gitHead(opts.primary);
  if (head.kind === 'detached') {
    throw new Error(
      'Cannot start a worktree from a detached HEAD. Check out a branch first.',
    );
  }

  if (opts.existing && (await isDirectory(opts.existing.path))) {
    await assertManagedWorktree({
      userDataRoot: opts.userDataRoot,
      primary: opts.primary,
      cardId: opts.cardId,
      worktree: opts.existing,
    });
    return opts.existing;
  }

  const branch = featureBranchFor(opts.cardId);
  const destination = worktreePathFor(
    opts.userDataRoot,
    primaryRoot,
    opts.cardId,
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });

  const create = await git(primaryRoot, [
    'worktree',
    'add',
    '-b',
    branch,
    destination,
    'HEAD',
  ]);
  if (!create.ok) {
    const branchExistsMessage = `fatal: a branch named '${branch}' already exists`;
    if (!create.stderr.includes(branchExistsMessage)) {
      throw new Error(create.stderr);
    }

    const attach = await git(primaryRoot, [
      'worktree',
      'add',
      destination,
      branch,
    ]);
    if (!attach.ok) {
      throw new Error(attach.stderr);
    }
  }

  return {
    path: destination,
    branch,
    recordedTargetBranch: head.name,
  };
}

export async function removeWorktree(
  primary: string,
  worktree: SessionWorktree,
): Promise<void> {
  const remove = await git(primary, [
    'worktree',
    'remove',
    '--force',
    worktree.path,
  ]);
  if (!remove.ok) {
    throw new Error(remove.stderr);
  }

  if (!(await gitRefExists(primary, worktree.branch))) {
    return;
  }

  const deleteBranch = await git(primary, [
    'branch',
    '-D',
    worktree.branch,
  ]);
  if (!deleteBranch.ok && (await gitRefExists(primary, worktree.branch))) {
    throw new Error(deleteBranch.stderr);
  }
}
