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
      return { ...snapshot, status: 'working' };
    case 'Notification':
      // Claude sends this a minute after finishing; it is not a question.
      if (event.notificationType === 'idle_prompt') return snapshot;
      return { ...snapshot, status: 'waiting' };
    case 'Stop':
      return { ...snapshot, status: 'done' };
    case 'SessionEnd':
      return {
        ...snapshot,
        status: settled(snapshot.status),
        terminal: { ...terminal, claudeRunning: false },
      };
    default:
      return snapshot;
  }
}

/** Claude fires no hook when Escape interrupts it mid-turn. */
export function applyInterrupt(snapshot: SessionSnapshot): SessionSnapshot {
  return snapshot.status === 'working'
    ? { ...snapshot, status: 'interrupted' }
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
