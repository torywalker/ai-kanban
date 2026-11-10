import { useBuildStatusStore } from '@/store/buildStatusStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { BuildGlyph, describeBuild } from './BuildStatusGlyph';
import { BuildStatusDetails } from './BuildStatusDetails';

/** One-glance CI state for a card; click opens the PR or run on GitHub. */
export function BuildStatusBadge({ cardId }: { cardId: string }) {
  const status = useBuildStatusStore((s) => s.statuses[cardId]);
  const view = status ? describeBuild(status) : null;
  if (!status || !view) return null;

  const label = status.stale
    ? `${view.label} (may be out of date)`
    : view.label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          // Not `disabled`: a disabled button never fires the pointer events
          // the tooltip needs, and the no-URL states are the ones worth explaining.
          aria-disabled={!status.url}
          className={cn(
            'inline-flex shrink-0',
            !status.url && 'cursor-default',
            status.stale && 'opacity-50',
          )}
          onClick={(event) => {
            event.stopPropagation();
            if (status.url) api.shell.openExternal(status.url);
          }}
        >
          <BuildGlyph view={view} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="start">
        <BuildStatusDetails status={status} view={view} />
      </TooltipContent>
    </Tooltip>
  );
}
