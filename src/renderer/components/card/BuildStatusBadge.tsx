import {
  CircleCheck,
  CircleX,
  CloudUpload,
  Hourglass,
  PackageX,
  type LucideIcon,
} from 'lucide-react';
import { summarizeChecks, type BuildStatus } from '@shared/buildStatus';
import { useBuildStatusStore } from '@/store/buildStatusStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// A ring with nothing drawn looks like a missing icon, so a build that has
// only just started still shows a sliver.
const MIN_FILL = 0.1;

/**
 * Determinate progress ring: it fills as checks finish and does not rotate,
 * so it can't be mistaken for the card's own session spinner.
 */
function ProgressRing({ fraction }: { fraction: number }) {
  const fill = Math.max(fraction, MIN_FILL) * CIRCUMFERENCE;
  return (
    <svg viewBox="0 0 14 14" className="size-3.5 text-sky-500" aria-hidden>
      <circle
        cx="7"
        cy="7"
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="1.75"
      />
      <circle
        cx="7"
        cy="7"
        r={RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeDasharray={`${fill} ${CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
      <circle
        cx="7"
        cy="7"
        r="1.5"
        fill="currentColor"
        className="animate-pulse"
      />
    </svg>
  );
}

type Shown =
  | { icon: LucideIcon; color: string; label: string }
  | { ring: number; label: string };

function describe(status: BuildStatus): Shown | null {
  const { failing, finished, pending, total } = summarizeChecks(status.checks);
  switch (status.kind) {
    case 'unpushed':
      return {
        icon: CloudUpload,
        color: 'text-amber-500',
        label: 'Shipped locally, not pushed yet',
      };
    case 'waiting':
      return {
        icon: Hourglass,
        color: 'text-sky-500',
        label: 'Pushed, waiting for a build to start',
      };
    case 'no-builds':
      return {
        icon: PackageX,
        color: 'text-muted-foreground',
        label: 'Pushed, but no builds ran',
      };
    case 'none':
      return null;
    default:
  }
  if (failing.length > 0) {
    return {
      icon: CircleX,
      color: 'text-destructive',
      label: `Build failed: ${failing.map((c) => c.name).join(', ')}`,
    };
  }
  if (finished) {
    return {
      icon: CircleCheck,
      color: 'text-emerald-500',
      label: 'Build passed',
    };
  }
  if (total === 0) {
    return {
      icon: Hourglass,
      color: 'text-sky-500',
      label: 'Waiting for checks to start',
    };
  }
  const running = status.checks.filter((c) => c.state === 'pending');
  const names = running
    .slice(0, 3)
    .map((c) => c.name)
    .join(', ');
  const more = running.length > 3 ? ` +${running.length - 3} more` : '';
  const done = total - pending;
  return {
    ring: done / total,
    label: `Running ${done}/${total}: ${names}${more}`,
  };
}

/** One-glance CI state for a card; click opens the PR or run on GitHub. */
export function BuildStatusBadge({ cardId }: { cardId: string }) {
  const status = useBuildStatusStore((s) => s.statuses[cardId]);
  const shown = status ? describe(status) : null;
  if (!status || !shown) return null;

  const label = status.stale
    ? `${shown.label} (may be out of date)`
    : shown.label;

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={!status.url}
      className={cn('inline-flex shrink-0', status.stale && 'opacity-50')}
      onClick={(event) => {
        event.stopPropagation();
        if (status.url) api.shell.openExternal(status.url);
      }}
    >
      {'ring' in shown ? (
        <ProgressRing fraction={shown.ring} />
      ) : (
        <shown.icon className={cn('size-3.5', shown.color)} />
      )}
    </button>
  );
}
