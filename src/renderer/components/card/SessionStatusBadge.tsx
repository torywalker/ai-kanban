import {
  Loader2,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Unplug,
} from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';
import type { SessionStatus } from '@shared/daemonProtocol';

const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'Working',
  waiting: 'Waiting on input',
  done: 'Done',
  failed: 'Failed',
  interrupted: 'Interrupted — reply or Run again to continue',
};

const STATUS_COLOR: Record<SessionStatus, string> = {
  working: 'text-sky-500',
  waiting: 'text-amber-500',
  done: 'text-emerald-500',
  failed: 'text-destructive',
  // Deliberately not destructive-red: nothing failed, this daemon just
  // doesn't have this card's session in memory — see SessionStatus's own
  // doc comment.
  interrupted: 'text-muted-foreground',
};

function statusLabel(status: SessionStatus, backgroundLabel: string): string {
  if (backgroundLabel === 'finished') {
    return 'Background command finished, waiting for Claude';
  }
  if (backgroundLabel) return `Background: ${backgroundLabel}`;
  return STATUS_LABEL[status];
}

interface Props {
  cardId: string;
  /** User-paused card: overrides the "done" check mark with a pause icon. */
  paused?: boolean;
}

export function SessionStatusBadge({ cardId, paused }: Props) {
  const status = useSessionStore((s) => s.sessions[cardId]?.status);
  const backgroundLabel = useSessionStore((s) => {
    const session = s.sessions[cardId];
    if (!session?.backgroundTasks?.length) {
      return session?.backgroundContinuing ? 'finished' : '';
    }
    return session.backgroundTasks.map((task) => task.description).join(', ');
  });
  // A terminal card whose Claude CLI has exited (or was never reattached
  // after an app restart) keeps its last `done` status, so the check would
  // claim a live connection. `foregroundBusy` is a hand-started Claude the
  // hooks can't see, so it still counts as connected.
  const disconnected = useSessionStore((s) => {
    const terminal = s.sessions[cardId]?.terminal;
    return !!terminal && !terminal.claudeRunning && !terminal.foregroundBusy;
  });
  if (!status) return null;

  if (paused) {
    return (
      <span title="Paused" className="inline-flex shrink-0">
        <CirclePause
          role="img"
          aria-label="Paused"
          className="size-3.5 text-violet-500"
        />
      </span>
    );
  }

  const showDisconnected = status === 'done' && disconnected;
  const label = showDisconnected
    ? 'Disconnected — Re-connect to continue'
    : statusLabel(status, backgroundLabel);
  const Icon =
    status === 'working'
      ? Loader2
      : showDisconnected || status === 'interrupted'
        ? Unplug
        : status === 'done'
          ? CircleCheck
          : CircleAlert;

  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon
        role="img"
        aria-label={label}
        className={`size-3.5 ${showDisconnected ? STATUS_COLOR.interrupted : STATUS_COLOR[status]} ${status === 'working' ? 'animate-spin' : ''}`}
      />
    </span>
  );
}
