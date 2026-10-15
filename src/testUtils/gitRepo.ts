import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export function gitExec(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function initRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-kanban-git-test-'));
  // Empty template avoids sample hooks that can fail in restricted environments.
  gitExec(dir, ['init', '--template=']);
  gitExec(dir, ['config', 'user.email', 'test@test.com']);
  gitExec(dir, ['config', 'user.name', 'Test User']);
  return dir;
}

export function plumbingCommit(
  cwd: string,
  opts: {
    files: Record<string, string>;
    message: string;
    ref?: string;
    parent?: string;
  },
): string {
  for (const [filePath, content] of Object.entries(opts.files)) {
    const fullPath = path.join(cwd, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
    const blobHash = gitExec(cwd, ['hash-object', '-w', filePath]).trim();
    gitExec(cwd, [
      'update-index',
      '--add',
      '--cacheinfo',
      '100644',
      blobHash,
      filePath,
    ]);
  }

  const treeHash = gitExec(cwd, ['write-tree']).trim();
  const commitArgs = ['commit-tree', treeHash, '-m', opts.message];
  if (opts.parent) {
    commitArgs.push('-p', opts.parent);
  }
  const commitHash = gitExec(cwd, commitArgs).trim();

  if (opts.ref) {
    gitExec(cwd, ['update-ref', opts.ref, commitHash]);
  }

  return commitHash;
}

export function rmRepo(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
