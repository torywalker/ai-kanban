import {
  CircleCheck,
  CircleX,
  CloudUpload,
  Hourglass,
  Loader2,
  PackageX,
} from 'lucide-react';
import { summarizeChecks, type BuildStatus } from '@shared/buildStatus';
import { useBuildStatusStore } from '@/store/buildStatusStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

function describe(status: BuildStatus): {
  icon: typeof Loader2;
  color: string;
  label: string;
} | null {
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
    return { icon: CircleCheck, color: 'text-emerald-500', label: 'Build passed' };
  }
  return {
    icon: Loader2,
    color: 'text-sky-500',
    label: `Build running (${total - pending}/${total})`,
  };
}

/** One-glance CI state for a card; click opens the PR or run on GitHub. */
export function BuildStatusBadge({ cardId }: { cardId: string }) {
  const status = useBuildStatusStore((s) => s.statuses[cardId]);
  const shown = status ? describe(status) : null;
  if (!status || !shown) return null;

  const Icon = shown.icon;
  const label = status.stale ? `${shown.label} (may be out of date)` : shown.label;
  const spinning = Icon === Loader2;

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
      <Icon
        className={cn('size-3.5', shown.color, spinning && 'animate-spin')}
      />
    </button>
  );
}
