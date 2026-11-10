import { CircleX } from 'lucide-react';
import {
  summarizeChecks,
  type BuildCheck,
  type BuildStatus,
} from '@shared/buildStatus';
import { BuildGlyph, type BuildView } from './BuildStatusGlyph';

const MAX_ROWS = 5;

/** Passed / failed / running as one slim bar, so the mix reads at a glance. */
function SegmentBar({ checks }: { checks: BuildCheck[] }) {
  const { failing, pending, passed, total } = summarizeChecks(checks);
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div
      aria-hidden
      className="flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-muted"
    >
      <div className="bg-indigo-500" style={{ width: pct(passed) }} />
      <div className="bg-destructive" style={{ width: pct(failing.length) }} />
      <div className="bg-sky-500/40" style={{ width: pct(pending) }} />
    </div>
  );
}

function CheckRow({ check }: { check: BuildCheck }) {
  return (
    <li className="flex items-center gap-2">
      {check.state === 'fail' ? (
        <CircleX className="size-3 shrink-0 text-destructive" />
      ) : (
        <span className="flex size-3 shrink-0 items-center justify-center">
          <span className="size-1.5 animate-pulse rounded-full bg-sky-500" />
        </span>
      )}
      <span className="truncate">{check.name}</span>
    </li>
  );
}

/** Failing steps first, then running ones; passed steps are only counted. */
function CheckList({ checks }: { checks: BuildCheck[] }) {
  const shown = [
    ...checks.filter((c) => c.state === 'fail'),
    ...checks.filter((c) => c.state === 'pending'),
  ];
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 border-t pt-2">
      {shown.slice(0, MAX_ROWS).map((check) => (
        <CheckRow key={`${check.name}|${check.url}`} check={check} />
      ))}
      {shown.length > MAX_ROWS ? (
        <li className="pl-5 text-muted-foreground">
          +{shown.length - MAX_ROWS} more
        </li>
      ) : null}
    </ul>
  );
}

/** The rich body of the build badge's tooltip. */
export function BuildStatusDetails({
  status,
  view,
}: {
  status: BuildStatus;
  view: BuildView;
}) {
  return (
    <div className="flex min-w-52 flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <BuildGlyph view={view} className="size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight">
            {view.title}
          </p>
          <p className="mt-0.5 text-muted-foreground">{view.summary}</p>
        </div>
      </div>
      <SegmentBar checks={status.checks} />
      <CheckList checks={status.checks} />
      {status.stale ? (
        <p className="text-amber-600 dark:text-amber-400">
          Couldn’t refresh just now. This may be out of date.
        </p>
      ) : null}
      {status.url ? (
        <p className="text-[11px] text-muted-foreground">
          Click to open on GitHub
        </p>
      ) : null}
    </div>
  );
}
