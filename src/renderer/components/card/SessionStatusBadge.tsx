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

interface Props {
  cardId: string;
}

export function SessionStatusBadge({ cardId }: Props) {
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  if (!snapshot) return null;

  const label = STATUS_LABEL[snapshot.status];
  const Icon =
    snapshot.status === 'working'
      ? Loader2
      : snapshot.status === 'done'
        ? CircleCheck
        : snapshot.status === 'interrupted'
          ? Unplug
          : CircleAlert;

  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon
        role="img"
        aria-label={label}
        className={`size-3.5 ${STATUS_COLOR[snapshot.status]} ${snapshot.status === 'working' ? 'animate-spin' : ''}`}
      />
    </span>
  );
}
