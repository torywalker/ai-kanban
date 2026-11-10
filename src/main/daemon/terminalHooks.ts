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
  /** SubagentStart/SubagentStop's `agent_id`. */
  agentId: string | null;
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const RECORD_SEPARATOR = '\n\x1e\n';

export const TERMINAL_BUFFER_MAX = 1_000_000;

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
    ...(terminal.foregroundBusy ? { foregroundBusy: true } : {}),
  };
}

/** Records whether a non-shell process holds the pty's foreground. */
export function applyForeground(
  snapshot: SessionSnapshot,
  busy: boolean,
): SessionSnapshot {
  const terminal = terminalOf(snapshot);
  if ((terminal.foregroundBusy === true) === busy) return snapshot;
  const { foregroundBusy, ...rest } = terminal;
  return {
    ...snapshot,
    terminal: busy ? { ...rest, foregroundBusy: true } : rest,
  };
}

function clearPending(terminal: TerminalState): TerminalState {
  return { ...terminal, stopPending: undefined };
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
        // A resume launches Claude with no prompt, so no turn follows to
        // reach Stop: staying `working` would spin until the next message.
        status: event.source === 'resume' ? 'done' : 'working',
        sessionId: event.sessionId ?? snapshot.sessionId,
        terminal: { ...terminal, claudeRunning: true },
      };
    case 'UserPromptSubmit':
      return {
        ...snapshot,
        status: 'working',
        terminal: clearPending(terminal),
      };
    case 'Notification':
      // Claude sends this a minute after finishing; it is not a question.
      if (event.notificationType === 'idle_prompt') return snapshot;
      return { ...snapshot, status: 'waiting' };
    case 'Stop':
      // Background subagents keep the card working past the main turn's Stop.
      if (running(terminal) > 0) {
        return {
          ...snapshot,
          status: 'working',
          terminal: { ...terminal, stopPending: true },
        };
      }
      return { ...snapshot, status: 'done' };
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
      return { ...snapshot, terminal: { ...terminal, subagents } };
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

/**
 * How long a held card waits, after its last subagent stops, for the
 * completion turn that reports it. Observed at about 1s.
 */
export const SUBAGENT_SETTLE_MS = 5000;

/** True while a card is only waiting for the completion turn of a subagent. */
export function isAwaitingCompletion(snapshot: SessionSnapshot): boolean {
  const { terminal } = snapshot;
  return (
    snapshot.status === 'working' &&
    terminal?.stopPending === true &&
    running(terminal) === 0
  );
}

/** Ends the hold when no completion turn followed the last subagent. */
export function applySettle(snapshot: SessionSnapshot): SessionSnapshot {
  if (!isAwaitingCompletion(snapshot)) return snapshot;
  return {
    ...snapshot,
    status: 'done',
    terminal: clearSubagents(terminalOf(snapshot)),
  };
}

/**
 * Claude fires no hook when Escape interrupts it mid-turn. The user did it on
 * purpose, so settle on `done` (check mark) rather than `interrupted`
 * (the "disconnected" icon, reserved for a daemon that lost the session).
 */
export function applyInterrupt(snapshot: SessionSnapshot): SessionSnapshot {
  return snapshot.status === 'working'
    ? {
        ...snapshot,
        status: 'done',
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
  // A foreground process the hooks cannot see may be a hand-attached Claude.
  if (terminal.foregroundBusy) return false;
  if (terminal.shellAlive && !terminal.claudeRunning) return true;
  return (
    snapshot.status === 'waiting' ||
    snapshot.status === 'done' ||
    snapshot.status === 'interrupted'
  );
}
