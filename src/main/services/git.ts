import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type GitExecResult =
  | { ok: true; stdout: string }
  | { ok: false; stderr: string; code: number | null };

export type HeadState =
  | { kind: 'branch'; name: string }
  | { kind: 'detached' };

export async function git(cwd: string, args: string[]): Promise<GitExecResult> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
    });
    return { ok: true, stdout };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stderr?: string;
      code?: number | string;
    };
    const code =
      typeof execError.code === 'number' ? execError.code : null;
    return {
      ok: false,
      stderr: execError.stderr ?? String(error),
      code,
    };
  }
}

export async function gitTopLevel(cwd: string): Promise<string | null> {
  const result = await git(cwd, ['rev-parse', '--show-toplevel']);
  if (!result.ok) return null;
  return result.stdout.trim();
}

export async function gitHead(cwd: string): Promise<HeadState> {
  const result = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!result.ok) {
    throw new Error(result.stderr);
  }
  const name = result.stdout.trim();
  if (name === 'HEAD') {
    return { kind: 'detached' };
  }
  return { kind: 'branch', name };
}

export async function gitIsDirty(cwd: string): Promise<boolean> {
  const result = await git(cwd, ['status', '--porcelain']);
  if (!result.ok) {
    throw new Error(result.stderr);
  }
  return result.stdout.trim().length > 0;
}

export async function gitRefExists(cwd: string, ref: string): Promise<boolean> {
  const result = await git(cwd, [
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${ref}`,
  ]);
  return result.ok;
}

export async function gitMergeInProgress(cwd: string): Promise<boolean> {
  const result = await git(cwd, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
  return result.ok;
}
