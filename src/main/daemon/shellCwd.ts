import { execFile } from 'child_process';
import fs from 'fs';

/**
 * A process's current directory. node-pty doesn't expose it, so read it from
 * the OS: /proc on Linux, lsof on macOS. Undefined elsewhere or on failure.
 */
export function readProcessCwd(pid: number): Promise<string | undefined> {
  if (process.platform === 'linux') {
    return fs.promises.readlink(`/proc/${pid}/cwd`).catch(() => undefined);
  }
  if (process.platform !== 'darwin') return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile(
      'lsof',
      ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'],
      { timeout: 2000 },
      (error, stdout) => {
        // -Fn prints "p<pid>", "fcwd", then "n<path>".
        const line = error
          ? undefined
          : stdout.split('\n').find((l) => l[0] === 'n');
        resolve(line?.slice(1));
      },
    );
  });
}
