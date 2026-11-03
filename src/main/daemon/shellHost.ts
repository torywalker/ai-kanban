import fs from 'fs';
import path from 'path';
import type { DaemonEvent } from '@shared/daemonProtocol';
import { defaultShell } from './terminalLaunch';
import { appendCapped } from './terminalHooks';
import type { PtyLike } from './terminalHost';

/** A pty that also reports its foreground process name (node-pty's `process`). */
export type ShellPtyLike = PtyLike & { readonly process: string };

export interface ShellHostDeps {
  spawnPty: (
    file: string,
    args: string[],
    opts: {
      cwd: string;
      cols: number;
      rows: number;
      env: Record<string, string>;
    },
  ) => ShellPtyLike;
  platform: string;
  envShell: string | undefined;
  baseEnv: Record<string, string | undefined>;
  homedir: string;
  publishEvent: (e: DaemonEvent) => void;
}

export interface ShellStartArgs {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface ShellHost {
  start(req: ShellStartArgs): void;
  has(id: string): boolean;
  input(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  close(id: string): void;
  attach(id: string): void;
  openCount(): number;
  dispose(): void;
}

interface Shell {
  pty: ShellPtyLike;
  buffer: string;
  busy: boolean;
  timer: ReturnType<typeof setInterval>;
}

const BUSY_POLL_MS = 500;

/** App-internal env vars that must not leak into user shells. */
const ENV_BLOCKLIST = new Set(['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']);

function baseName(proc: string): string {
  return path.basename(proc).replace(/^-/, '');
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Plain login-shell terminals, independent of cards: no Claude hooks and no
 * usage tracking. Output rides the existing terminalData/terminalReplay
 * events keyed by the shell's id.
 */
export function createShellHost(deps: ShellHostDeps): ShellHost {
  const shells = new Map<string, Shell>();
  const shellFile = defaultShell(deps.platform, deps.envShell);

  const publishState = (id: string, alive: boolean, busy: boolean): void => {
    deps.publishEvent({ event: 'shellState', id, alive, busy });
  };

  const forget = (id: string, shell: Shell): void => {
    clearInterval(shell.timer);
    if (shells.get(id) === shell) shells.delete(id);
  };

  const killQuietly = (pty: ShellPtyLike): void => {
    try {
      pty.kill();
    } catch {
      // Already gone.
    }
  };

  return {
    start(req) {
      const existing = shells.get(req.id);
      if (existing) {
        // Every dialog open starts each tab; resync its busy state.
        publishState(req.id, true, existing.busy);
        return;
      }
      const cwd = req.cwd && isDirectory(req.cwd) ? req.cwd : deps.homedir;
      const env: Record<string, string> = {};
      Object.entries(deps.baseEnv).forEach(([key, value]) => {
        if (value !== undefined && !ENV_BLOCKLIST.has(key)) env[key] = value;
      });
      env.TERM = 'xterm-256color';
      env.COLORTERM = 'truecolor';

      let pty: ShellPtyLike;
      try {
        pty = deps.spawnPty(shellFile, ['-l'], {
          cwd,
          cols: req.cols,
          rows: req.rows,
          env,
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('daemon: failed to spawn shell', req.id, error);
        publishState(req.id, false, false);
        return;
      }

      const shell: Shell = {
        pty,
        buffer: '',
        busy: false,
        timer: setInterval(() => {
          let proc: string;
          try {
            proc = pty.process;
          } catch {
            return;
          }
          const busy = baseName(proc) !== baseName(shellFile);
          if (busy === shell.busy) return;
          shell.busy = busy;
          publishState(req.id, true, busy);
        }, BUSY_POLL_MS),
      };
      shells.set(req.id, shell);
      // The panel drops live output until the first replay.
      deps.publishEvent({ event: 'terminalReplay', cardId: req.id, data: '' });

      pty.onData((data) => {
        shell.buffer = appendCapped(shell.buffer, data);
        deps.publishEvent({ event: 'terminalData', cardId: req.id, data });
      });
      pty.onExit(() => {
        if (shells.get(req.id) !== shell) return;
        forget(req.id, shell);
        publishState(req.id, false, false);
      });
    },

    has: (id) => shells.has(id),

    input(id, data) {
      try {
        shells.get(id)?.pty.write(data);
      } catch {
        // The pty just exited; onExit follows.
      }
    },

    resize(id, cols, rows) {
      try {
        shells.get(id)?.pty.resize(cols, rows);
      } catch {
        // The pty just exited; onExit follows.
      }
    },

    close(id) {
      const shell = shells.get(id);
      if (shell) killQuietly(shell.pty);
    },

    attach(id) {
      deps.publishEvent({
        event: 'terminalReplay',
        cardId: id,
        data: shells.get(id)?.buffer ?? '',
      });
    },

    openCount: () => shells.size,

    dispose() {
      shells.forEach((shell, id) => {
        forget(id, shell);
        killQuietly(shell.pty);
      });
    },
  };
}
