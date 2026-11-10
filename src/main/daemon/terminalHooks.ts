import type {
  SessionSnapshot,
  SessionStatus,
  TerminalState,
} from '@shared/daemonProtocol';

/** One Claude hook invocation, as recorded in a card's hook file. */
export interface HookEvent {
  name: string;
  sessionId: string | null;
  transcriptPath: string | null;
  /** Notification's `notification_type`, e.g. `idle_prompt`. */
  notificationType: string | null;
  /** SessionStart's `source`: `startup`, `resume`, `clear` or `compact`. */
  source: string | null;
  /** Set on hooks that fire inside a subagent; null for the main agent. */
  agentId: string | null;
  /** Stop's `background_tasks` still running: shells, subagents, monitors... */
  runningTasks: number;
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const RECORD_SEPARATOR = '\n\x1e\n';

export const TERMINAL_BUFFER_MAX = 1_000_000;

function countRunning(tasks: unknown): number {
  if (!Array.isArray(tasks)) return 0;
  return tasks.filter((task) => task?.status === 'running').length;
}

function parseRecord(text: string): HookEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.hook_event_name !== 'string') return null;
  return {
    name: record.hook_event_name,
    sessionId: stringOrNull(record.session_id),
    transcriptPath: stringOrNull(record.transcript_path),
    notificationType: stringOrNull(record.notification_type),
    source: stringOrNull(record.source),
    agentId: stringOrNull(record.agent_id),
    runningTasks: countRunning(record.background_tasks),
  };
}

/**
 * Splits complete records off the front of the unread hook-file text. A
 * record is complete only once its separator line has been written, so a
 * hook caught mid-`cat` stays in `rest` for the next poll.
 */
export function splitHookRecords(pending: string): {
  events: HookEvent[];
  rest: string;
} {
  const events: HookEvent[] = [];
  let rest = pending;
  let end = rest.indexOf(RECORD_SEPARATOR);
  while (end !== -1) {
    const event = parseRecord(rest.slice(0, end));
    if (event) events.push(event);
    rest = rest.slice(end + RECORD_SEPARATOR.length);
    end = rest.indexOf(RECORD_SEPARATOR);
  }
  return { events, rest };
}

function terminalOf(snapshot: SessionSnapshot): TerminalState {
  return snapshot.terminal ?? { shellAlive: true, claudeRunning: false };
}

function running(terminal: TerminalState): number {
  return terminal.subagents?.length ?? 0;
}

/** Drops the background-subagent fields so idle state keeps its plain shape. */
function clearSubagents(terminal: TerminalState): TerminalState {
  return {
    shellAlive: terminal.shellAlive,
    claudeRunning: terminal.claudeRunning,
  };
}

function clearHold(terminal: TerminalState): TerminalState {
  return { ...terminal, hold: undefined };
}

function settled(status: SessionStatus): SessionStatus {
  return status === 'working' || status === 'waiting' ? 'done' : status;
}

/** Spec §4.3: how each Claude hook moves a terminal card's snapshot. */
export function applyHookEvent(
  snapshot: SessionSnapshot,
  event: HookEvent,
): SessionSnapshot {
  const terminal = terminalOf(snapshot);
  switch (event.name) {
    case 'SessionStart':
      return {
        ...snapshot,
        status: 'working',
        sessionId: event.sessionId ?? snapshot.sessionId,
        terminal: { ...terminal, claudeRunning: true },
      };
    case 'UserPromptSubmit':
      return {
        ...snapshot,
        status: 'working',
        terminal: clearHold(terminal),
      };
    case 'Notification':
      // Claude sends this a minute after finishing; it is not a question.
      if (event.notificationType === 'idle_prompt') return snapshot;
      return { ...snapshot, status: 'waiting' };
    case 'Stop':
      // Claude's own list of running background work decides the hold; the
      // tracked ids cover a SubagentStart that lands after this Stop.
      if (running(terminal) > 0 || event.runningTasks > 0) {
        return {
          ...snapshot,
          status: 'working',
          terminal: { ...terminal, hold: 'running' },
        };
      }
      return { ...snapshot, status: 'done', terminal: clearHold(terminal) };
    case 'PreToolUse':
      // Claude wakes for a finished shell or subagent with no prompt hook.
      // Only the main agent counts: a subagent's tools are not a new turn.
      if (event.agentId || snapshot.status !== 'done') return snapshot;
      return { ...snapshot, status: 'working' };
    case 'SubagentStart': {
      if (!event.agentId) return snapshot;
      const subagents = [...(terminal.subagents ?? [])];
      if (!subagents.includes(event.agentId)) subagents.push(event.agentId);
      return { ...snapshot, terminal: { ...terminal, subagents } };
    }
    case 'SubagentStop': {
      // Claude's internal agents fire a Stop with no matching Start.
      if (!event.agentId || !terminal.subagents?.includes(event.agentId)) {
        return snapshot;
      }
      const subagents = terminal.subagents.filter((id) => id !== event.agentId);
      // The completion arrives as a new turn about a second later. Stay
      // working until then; `applySettle` covers a turn that never comes.
      const drained = subagents.length === 0 && terminal.hold === 'running';
      return {
        ...snapshot,
        terminal: {
          ...terminal,
          subagents,
          hold: drained ? 'draining' : terminal.hold,
        },
      };
    }
    case 'SessionEnd':
      return {
        ...snapshot,
        status: settled(snapshot.status),
        terminal: { ...clearSubagents(terminal), claudeRunning: false },
      };
    default:
      return snapshot;
  }
}

/** After the last subagent stops, its completion turn followed in about 1s. */
export const SUBAGENT_SETTLE_MS = 5000;

/**
 * A hold with no tracked subagent behind it (a shell, or a subagent whose
 * Start was missed) has no end signal of its own, so a dev server left
 * running cannot pin the spinner forever.
 */
export const HOLD_MAX_MS = 30 * 60 * 1000;

/** How long the card's current hold may last, or null if it has no limit. */
export function holdTimeoutMs(snapshot: SessionSnapshot): number | null {
  const { terminal } = snapshot;
  if (snapshot.status !== 'working' || !terminal?.hold) return null;
  if (terminal.hold === 'draining') return SUBAGENT_SETTLE_MS;
  return running(terminal) > 0 ? null : HOLD_MAX_MS;
}

/** Ends a hold whose timeout passed without a completion turn. */
export function applySettle(snapshot: SessionSnapshot): SessionSnapshot {
  if (holdTimeoutMs(snapshot) === null) return snapshot;
  return {
    ...snapshot,
    status: 'done',
    terminal: clearSubagents(terminalOf(snapshot)),
  };
}

/** Claude fires no hook when Escape interrupts it mid-turn. */
export function applyInterrupt(snapshot: SessionSnapshot): SessionSnapshot {
  return snapshot.status === 'working'
    ? {
        ...snapshot,
        status: 'interrupted',
        terminal: clearSubagents(terminalOf(snapshot)),
      }
    : snapshot;
}

export function applyPtyExit(snapshot: SessionSnapshot): SessionSnapshot {
  return {
    ...snapshot,
    status: settled(snapshot.status),
    terminal: { shellAlive: false, claudeRunning: false },
  };
}

/** Appends pty output, keeping only the newest `max` characters. */
export function appendCapped(
  buffer: string,
  chunk: string,
  max: number = TERMINAL_BUFFER_MAX,
): string {
  const combined = buffer + chunk;
  return combined.length > max ? combined.slice(-max) : combined;
}

/**
 * Safe to close without interrupting Claude mid-task: either Claude is not
 * running in the shell, or it is waiting on the user or has finished.
 */
export function isIdleTerminal(snapshot: SessionSnapshot): boolean {
  const terminal = terminalOf(snapshot);
  if (terminal.shellAlive && !terminal.claudeRunning) return true;
  return (
    snapshot.status === 'waiting' ||
    snapshot.status === 'done' ||
    snapshot.status === 'interrupted'
  );
}
