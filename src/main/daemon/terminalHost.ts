import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import type {
  DaemonEvent,
  SessionSnapshot,
  TerminalStartRequest,
} from '@shared/daemonProtocol';
import { buildTerminalLaunch, defaultShell } from './terminalLaunch';
import {
  appendCapped,
  applyHookEvent,
  applyPtyExit,
  isIdleTerminal,
  splitHookRecords,
} from './terminalHooks';

/** The slice of node-pty's `IPty` the host uses, so tests can fake it. */
export interface PtyLike {
  onData(cb: (d: string) => void): void;
  onExit(cb: () => void): void;
  write(d: string): void;
  resize(c: number, r: number): void;
  kill(): void;
}

export interface TerminalHostDeps {
  spawnPty: (
    file: string,
    args: string[],
    opts: {
      cwd: string;
      cols: number;
      rows: number;
      env: Record<string, string>;
    },
  ) => PtyLike;
  hookDir: string;
  platform: string;
  envShell: string | undefined;
  baseEnv: Record<string, string | undefined>;
  publishSnapshot: (s: SessionSnapshot) => void;
  publishEvent: (e: DaemonEvent) => void;
  /** `first` is true for the first usage batch of this spawn. */
  onUsageBatch: (
    cardId: string,
    transcriptPath: string,
    first: boolean,
  ) => void;
  now: () => number;
}

export interface TerminalHost {
  start(req: TerminalStartRequest): void;
  input(cardId: string, data: string): void;
  resize(cardId: string, cols: number, rows: number): void;
  interrupt(cardId: string): void;
  close(cardId: string): void;
  attach(cardId: string): void;
  closeIdle(): void;
  openCount(): number;
  /** The live snapshot, or undefined once the card's pty has exited. */
  snapshot(cardId: string): SessionSnapshot | undefined;
  dispose(): void;
}

const HOOK_POLL_MS = 250;
const IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

interface Terminal {
  cardId: string;
  pty: PtyLike;
  buffer: string;
  hookFile: string;
  hookOffset: number;
  // A multi-byte character can straddle two polls.
  hookDecoder: StringDecoder;
  pendingHook: string;
  snapshot: SessionSnapshot;
  firstBatch: boolean;
  pollTimer: ReturnType<typeof setInterval>;
  lastActivity: number;
}

function killQuietly(pty: PtyLike): void {
  try {
    pty.kill();
  } catch {
    // Already gone.
  }
}

/**
 * Owns one pty per card, running the user's `claude` CLI. Status comes from
 * Claude's own hooks, which append to a per-card file this host polls.
 */
export function createTerminalHost(deps: TerminalHostDeps): TerminalHost {
  const terminals = new Map<string, Terminal>();
  const lastSnapshots = new Map<string, SessionSnapshot>();

  const readNewHookText = (terminal: Terminal): string => {
    let fd: number;
    try {
      fd = fs.openSync(terminal.hookFile, 'r');
    } catch {
      return '';
    }
    try {
      const { size } = fs.fstatSync(fd);
      if (size <= terminal.hookOffset) return '';
      const bytes = Buffer.alloc(size - terminal.hookOffset);
      const read = fs.readSync(fd, bytes, 0, bytes.length, terminal.hookOffset);
      terminal.hookOffset += read;
      return terminal.hookDecoder.write(bytes.subarray(0, read));
    } catch {
      return '';
    } finally {
      fs.closeSync(fd);
    }
  };

  const pollHooks = (terminal: Terminal): void => {
    const text = readNewHookText(terminal);
    if (!text) return;
    const { events, rest } = splitHookRecords(terminal.pendingHook + text);
    terminal.pendingHook = rest;
    if (events.length === 0) return;
    const usageBatches: string[] = [];
    events.forEach((event) => {
      terminal.snapshot = applyHookEvent(terminal.snapshot, event);
      if (
        (event.name === 'Stop' || event.name === 'SessionEnd') &&
        event.transcriptPath
      ) {
        usageBatches.push(event.transcriptPath);
      }
    });
    deps.publishSnapshot(terminal.snapshot);
    usageBatches.forEach((transcriptPath) => {
      deps.onUsageBatch(terminal.cardId, transcriptPath, terminal.firstBatch);
      terminal.firstBatch = false;
    });
  };

  const tick = (terminal: Terminal): void => {
    pollHooks(terminal);
    if (deps.now() - terminal.lastActivity < IDLE_TIMEOUT_MS) return;
    // Restarting the clock means a shell that survives the kill is retried
    // a day later rather than on every poll.
    terminal.lastActivity = deps.now();
    killQuietly(terminal.pty);
  };

  return {
    start(req) {
      if (terminals.has(req.cardId)) return;
      lastSnapshots.delete(req.cardId);
      const launchSessionId = req.sessionId ?? randomUUID();
      const hookFile = path.join(deps.hookDir, `${req.cardId}.log`);
      const initial: SessionSnapshot = {
        cardId: req.cardId,
        sessionId: req.sessionId,
        status: 'working',
        checklist: [],
        messages: [],
        pendingApproval: null,
        lastError: null,
        engine: 'terminal',
        terminal: { shellAlive: true, claudeRunning: false },
      };

      let pty: PtyLike;
      try {
        if (!fs.existsSync(req.cwd)) {
          throw new Error(`Working directory does not exist: ${req.cwd}`);
        }
        fs.mkdirSync(deps.hookDir, { recursive: true });
        fs.writeFileSync(hookFile, '');
        const launch = buildTerminalLaunch({
          shell: defaultShell(deps.platform, deps.envShell),
          claudeCliPath: req.claudeCliPath,
          prompt: req.prompt,
          model: req.model,
          approvalMode: req.approvalMode,
          sessionId: launchSessionId,
          resume: req.sessionId !== null,
          hookFile,
          baseEnv: deps.baseEnv,
        });
        pty = deps.spawnPty(launch.file, launch.args, {
          cwd: req.cwd,
          cols: req.cols,
          rows: req.rows,
          env: launch.env,
        });
      } catch (error) {
        const failed: SessionSnapshot = {
          ...initial,
          status: 'failed',
          lastError: error instanceof Error ? error.message : String(error),
          terminal: { shellAlive: false, claudeRunning: false },
        };
        lastSnapshots.set(req.cardId, failed);
        deps.publishSnapshot(failed);
        return;
      }

      const terminal: Terminal = {
        cardId: req.cardId,
        pty,
        buffer: '',
        hookFile,
        hookOffset: 0,
        hookDecoder: new StringDecoder('utf8'),
        pendingHook: '',
        snapshot: initial,
        firstBatch: true,
        pollTimer: setInterval(() => tick(terminal), HOOK_POLL_MS),
        lastActivity: deps.now(),
      };
      terminals.set(req.cardId, terminal);

      pty.onData((data) => {
        terminal.buffer = appendCapped(terminal.buffer, data);
        terminal.lastActivity = deps.now();
        deps.publishEvent({ event: 'terminalData', cardId: req.cardId, data });
      });
      pty.onExit(() => {
        if (terminals.get(req.cardId) !== terminal) return;
        pollHooks(terminal);
        clearInterval(terminal.pollTimer);
        terminals.delete(req.cardId);
        terminal.snapshot = applyPtyExit(terminal.snapshot);
        lastSnapshots.set(req.cardId, terminal.snapshot);
        deps.publishSnapshot(terminal.snapshot);
      });

      deps.publishSnapshot(initial);
    },

    input(cardId, data) {
      const terminal = terminals.get(cardId);
      if (!terminal) return;
      terminal.pty.write(data);
      terminal.lastActivity = deps.now();
    },

    resize(cardId, cols, rows) {
      const terminal = terminals.get(cardId);
      if (!terminal) return;
      try {
        terminal.pty.resize(cols, rows);
      } catch {
        // node-pty throws for a pty that has just exited.
      }
    },

    interrupt(cardId) {
      terminals.get(cardId)?.pty.write('\x1b');
    },

    close(cardId) {
      const terminal = terminals.get(cardId);
      if (terminal) killQuietly(terminal.pty);
    },

    attach(cardId) {
      const terminal = terminals.get(cardId);
      if (!terminal) return;
      deps.publishEvent({
        event: 'terminalReplay',
        cardId,
        data: terminal.buffer,
      });
    },

    closeIdle() {
      terminals.forEach((terminal) => {
        if (isIdleTerminal(terminal.snapshot)) killQuietly(terminal.pty);
      });
    },

    openCount() {
      return terminals.size;
    },

    snapshot(cardId) {
      return terminals.get(cardId)?.snapshot ?? lastSnapshots.get(cardId);
    },

    dispose() {
      terminals.forEach((terminal) => {
        clearInterval(terminal.pollTimer);
        killQuietly(terminal.pty);
      });
      terminals.clear();
      lastSnapshots.clear();
    },
  };
}
