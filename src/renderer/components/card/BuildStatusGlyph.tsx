import {
  CircleX,
  CloudUpload,
  Hourglass,
  PackageX,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { summarizeChecks, type BuildStatus } from '@shared/buildStatus';
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
function ProgressRing({
  fraction,
  className,
}: {
  fraction: number;
  className?: string;
}) {
  const fill = Math.max(fraction, MIN_FILL) * CIRCUMFERENCE;
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn('size-3.5 text-sky-500', className)}
      aria-hidden
    >
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

export type BuildView = {
  /** Accessible name for the badge. */
  label: string;
  /** Tooltip headline. */
  title: string;
  /** Tooltip one-liner under the headline. */
  summary: string;
} & ({ icon: LucideIcon; color: string } | { ring: number });

export function describeBuild(status: BuildStatus): BuildView | null {
  const { failing, finished, pending, passed, total } = summarizeChecks(
    status.checks,
  );
  switch (status.kind) {
    case 'unpushed':
      return {
        icon: CloudUpload,
        color: 'text-amber-500',
        label: 'Shipped locally, not pushed yet',
        title: 'Not pushed yet',
        summary: 'Shipped locally. Push the branch to start a build.',
      };
    case 'waiting':
      return {
        icon: Hourglass,
        color: 'text-sky-500',
        label: 'Pushed, waiting for a build to start',
        title: 'Waiting for a build',
        summary: 'Pushed, but GitHub has not started any runs yet.',
      };
    case 'no-builds':
      return {
        icon: PackageX,
        color: 'text-muted-foreground',
        label: 'Pushed, but no builds ran',
        title: 'No builds ran',
        summary: 'Pushed, but no workflow runs matched this commit.',
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
      title: 'Build failed',
      summary: [
        `${failing.length} failed`,
        pending > 0 && `${pending} running`,
        passed > 0 && `${passed} passed`,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  if (finished) {
    return {
      icon: ShieldCheck,
      color: 'text-emerald-500',
      label: 'Build passed',
      title: 'Build passed',
      summary: `All ${total} checks passed`,
    };
  }
  if (total === 0) {
    return {
      icon: Hourglass,
      color: 'text-sky-500',
      label: 'Waiting for checks to start',
      title: 'Waiting for checks',
      summary: 'No checks have been reported yet.',
    };
  }
  const done = total - pending;
  const names = status.checks
    .filter((c) => c.state === 'pending')
    .slice(0, 3)
    .map((c) => c.name)
    .join(', ');
  const more = pending > 3 ? ` +${pending - 3} more` : '';
  return {
    ring: done / total,
    label: `Running ${done}/${total}: ${names}${more}`,
    title: 'Build running',
    summary: `${done} of ${total} checks done`,
  };
}

export function BuildGlyph({
  view,
  className,
}: {
  view: BuildView;
  className?: string;
}) {
  if ('ring' in view) {
    return <ProgressRing fraction={view.ring} className={className} />;
  }
  const Icon = view.icon;
  return <Icon className={cn('size-3.5', view.color, className)} />;
}
