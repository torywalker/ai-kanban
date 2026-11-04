import { randomUUID } from 'crypto';
import fs from 'fs';
import { cliCostPathFor } from './cliCost';
import path from 'path';
import { StringDecoder } from 'string_decoder';
import type {
  DaemonEvent,
  SessionSnapshot,
  TerminalStartRequest,
} from '@shared/daemonProtocol';
import {
  buildTerminalLaunch,
  claudeResumeLine,
  defaultShell,
} from './terminalLaunch';
import {
  appendCapped,
  applyHookEvent,
  applyInterrupt,
  applyPtyExit,
  applySettle,
  isAwaitingCompletion,
  isIdleTerminal,
  splitHookRecords,
  SUBAGENT_SETTLE_MS,
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
  /** SessionStart: the transcript up to now is history, not a new bill. */
  onTranscriptStart: (cardId: string, transcriptPath: string) => void;
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
  /** The live snapshot, or the last one once the card's pty has exited. */
  snapshot(cardId: string): SessionSnapshot | undefined;
  /** The snapshot of a live pty only. */
  liveSnapshot(cardId: string): SessionSnapshot | undefined;
  /** Drops the card's exited-terminal snapshot. */
  forget(cardId: string): void;
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
  transcriptPath: string | null;
  pollTimer: ReturnType<typeof setInterval>;
  lastActivity: number;
  /** When a card held only for a subagent's completion turn gives up. */
  settleAt: number | null;
  /** A resume command was already typed and Claude has not exited since. */
  resumeSent: boolean;
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

  const billUsage = (terminal: Terminal, transcriptPath: string): void => {
    deps.onUsageBatch(terminal.cardId, transcriptPath, terminal.firstBatch);
    terminal.firstBatch = false;
  };

  /** Returns whether the poll billed a SessionEnd. */
  const pollHooks = (terminal: Terminal): boolean => {
    const text = readNewHookText(terminal);
    if (!text) return false;
    const { events, rest } = splitHookRecords(terminal.pendingHook + text);
    terminal.pendingHook = rest;
    if (events.length === 0) return false;
    const transcriptStarts: string[] = [];
    const usageBatches: string[] = [];
    let billedSessionEnd = false;
    events.forEach((event) => {
      const wasRunning = terminal.snapshot.terminal?.claudeRunning === true;
      terminal.snapshot = applyHookEvent(terminal.snapshot, event);
      const isRunning = terminal.snapshot.terminal?.claudeRunning === true;
      if (wasRunning && !isRunning) terminal.resumeSent = false;
      if (event.transcriptPath) terminal.transcriptPath = event.transcriptPath;
      // A compacted session keeps its transcript, so its tokens are unbilled.
      if (
        event.name === 'SessionStart' &&
        event.transcriptPath &&
        event.source !== 'compact'
      ) {
        transcriptStarts.push(event.transcriptPath);
      }
      if (
        (event.name === 'Stop' || event.name === 'SessionEnd') &&
        event.transcriptPath
      ) {
        usageBatches.push(event.transcriptPath);
        billedSessionEnd = event.name === 'SessionEnd';
      }
    });
    terminal.settleAt = isAwaitingCompletion(terminal.snapshot)
      ? deps.now() + SUBAGENT_SETTLE_MS
      : null;
    deps.publishSnapshot(terminal.snapshot);
    // Prime every SessionStart in this poll before any Stop bills it.
    // A resume appends to a transcript that already holds billed turns.
    transcriptStarts.forEach((transcriptPath) => {
      deps.onTranscriptStart(terminal.cardId, transcriptPath);
    });
    usageBatches.forEach((transcriptPath) =>
      billUsage(terminal, transcriptPath),
    );
    return billedSessionEnd;
  };

  const tick = (terminal: Terminal): void => {
    pollHooks(terminal);
    if (terminal.settleAt !== null && deps.now() >= terminal.settleAt) {
      terminal.settleAt = null;
      terminal.snapshot = applySettle(terminal.snapshot);
      deps.publishSnapshot(terminal.snapshot);
    }
    if (deps.now() - terminal.lastActivity < IDLE_TIMEOUT_MS) return;
    // Restarting the clock means a shell that survives the kill is retried
    // a day later rather than on every poll.
    terminal.lastActivity = deps.now();
    killQuietly(terminal.pty);
  };

  const markInterrupted = (terminal: Terminal): void => {
    const next = applyInterrupt(terminal.snapshot);
    if (next === terminal.snapshot) return;
    terminal.snapshot = next;
    deps.publishSnapshot(next);
  };

  return {
    start(req) {
      const running = terminals.get(req.cardId);
      if (running) {
        const claudeUp = running.snapshot.terminal?.claudeRunning === true;
        // The shell is still open after Claude exited. Typing the resume
        // command brings that session back without a new pty or a new prompt.
        if (!claudeUp && req.sessionId && !running.resumeSent) {
          running.resumeSent = true;
          running.pty.write(
            claudeResumeLine({
              shell: defaultShell(deps.platform, deps.envShell),
              claudeCliPath: req.claudeCliPath,
              prompt: req.prompt,
              model: req.model,
              approvalMode: req.approvalMode,
              sessionId: req.sessionId,
              resume: true,
              hookFile: running.hookFile,
              baseEnv: deps.baseEnv,
            }),
          );
        }
        deps.publishSnapshot(running.snapshot);
        return;
      }
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
        fs.rmSync(cliCostPathFor(hookFile), { force: true });
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
        transcriptPath: null,
        pollTimer: setInterval(() => tick(terminal), HOOK_POLL_MS),
        lastActivity: deps.now(),
        settleAt: null,
        resumeSent: false,
      };
      terminals.set(req.cardId, terminal);
      // The panel drops live output until the first replay. An empty one
      // has to go out before the pty can emit, or a Run that attached
      // early — and a Run after Close — never paints.
      deps.publishEvent({
        event: 'terminalReplay',
        cardId: req.cardId,
        data: '',
      });

      pty.onData((data) => {
        terminal.buffer = appendCapped(terminal.buffer, data);
        terminal.lastActivity = deps.now();
        deps.publishEvent({ event: 'terminalData', cardId: req.cardId, data });
      });
      pty.onExit(() => {
        if (terminals.get(req.cardId) !== terminal) return;
        const billedSessionEnd = pollHooks(terminal);
        // Killing the pty skips Claude's SessionEnd hook.
        if (terminal.transcriptPath && !billedSessionEnd) {
          billUsage(terminal, terminal.transcriptPath);
        }
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
      // Only a lone Escape: arrow and function keys arrive as sequences
      // that start with one.
      if (data === '\x1b') markInterrupted(terminal);
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
      const terminal = terminals.get(cardId);
      if (!terminal) return;
      terminal.pty.write('\x1b');
      markInterrupted(terminal);
    },

    close(cardId) {
      const terminal = terminals.get(cardId);
      if (terminal) killQuietly(terminal.pty);
    },

    attach(cardId) {
      const terminal = terminals.get(cardId);
      deps.publishEvent({
        event: 'terminalReplay',
        cardId,
        data: terminal?.buffer ?? '',
      });
      if (terminal) deps.publishSnapshot(terminal.snapshot);
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

    liveSnapshot(cardId) {
      return terminals.get(cardId)?.snapshot;
    },

    forget(cardId) {
      lastSnapshots.delete(cardId);
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
