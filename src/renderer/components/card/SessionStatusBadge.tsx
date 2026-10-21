import { Loader2, CircleAlert, CircleCheck, Unplug } from 'lucide-react';
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
}

export function SessionStatusBadge({ cardId }: Props) {
  const status = useSessionStore((s) => s.sessions[cardId]?.status);
  const backgroundLabel = useSessionStore((s) => {
    const session = s.sessions[cardId];
    if (!session?.backgroundTasks?.length) {
      return session?.backgroundContinuing ? 'finished' : '';
    }
    return session.backgroundTasks.map((task) => task.description).join(', ');
  });
  if (!status) return null;

  const label = statusLabel(status, backgroundLabel);
  const Icon =
    status === 'working'
      ? Loader2
      : status === 'done'
        ? CircleCheck
        : status === 'interrupted'
          ? Unplug
          : CircleAlert;

  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon
        role="img"
        aria-label={label}
        className={`size-3.5 ${STATUS_COLOR[status]} ${status === 'working' ? 'animate-spin' : ''}`}
      />
    </span>
  );
}
