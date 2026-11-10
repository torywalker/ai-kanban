import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocStore } from '@/store/docStore';
import { selectActiveBoard } from '@/store/selectors';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/formatUsage';
import { localDayKey, type DailySpend } from '@shared/usage';

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: localDayKey(new Date(now.getFullYear(), now.getMonth(), 1)),
    to: localDayKey(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  return ([1, 2, 5, 10].find((step) => n <= step) ?? 10) * pow;
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

interface SpendDashboardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Per-day spend for the active board — archived cards included — over a chosen date range. */
export function SpendDashboardDialog({
  open,
  onOpenChange,
}: SpendDashboardDialogProps) {
  const board = useDocStore(selectActiveBoard);
  const [range, setRange] = useState(currentMonthRange);
  const [days, setDays] = useState<DailySpend[]>([]);
  const [error, setError] = useState<string | null>(null);
  const validRange = !!range.from && !!range.to && range.from <= range.to;

  const idsKey = useMemo(
    () => board?.lists.flatMap((l) => l.cards.map((c) => c.id)).join(',') ?? '',
    [board],
  );

  useEffect(() => {
    setError(null);
    if (!open || !validRange) {
      setDays([]);
      return;
    }
    let cancelled = false;
    api.usage
      .boardDaily(idsKey === '' ? [] : idsKey.split(','), range.from, range.to)
      .then((next) => {
        if (!cancelled) setDays(next);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setDays([]);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, idsKey, range, validRange]);

  let emptyMessage = 'Pick a valid date range.';
  if (error) emptyMessage = `Couldn't load spend: ${error}`;
  else if (validRange) emptyMessage = 'Loading…';

  const total = days.reduce((sum, d) => sum + d.costUSD, 0);
  const max = Math.max(...days.map((d) => d.costUSD), 0);
  // Round the axis top up to 1/2/5 × 10^n so the gridlines land on clean values.
  const top = niceCeil(max);
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i);
  const labelEvery = Math.ceil(days.length / 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex w-full flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Spend</DialogTitle>
          <DialogDescription>
            {board ? `Daily spend for ${board.name}.` : 'Daily spend.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-3">
          <div className="grid gap-1">
            <Label htmlFor="spend-from">From</Label>
            <Input
              id="spend-from"
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="spend-to">To</Label>
            <Input
              id="spend-to"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <span className="ml-auto text-sm font-medium tabular-nums">
            Total {formatUsd(total)}
          </span>
        </div>
        {days.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <div className="flex gap-2">
            <span className="text-xs text-muted-foreground [writing-mode:vertical-rl] rotate-180 self-center">
              Spend per day (USD)
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-64">
                <div className="relative w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {ticks.map((t) => (
                    <span
                      key={t}
                      className="absolute right-2 -translate-y-1/2"
                      style={{ bottom: `${(t / top) * 100}%` }}
                    >
                      {formatUsd(t)}
                    </span>
                  ))}
                </div>
                <div
                  className="relative flex min-w-0 flex-1 items-end gap-px border-b border-l border-border"
                  role="img"
                  aria-label="Daily spend bar chart"
                >
                  {ticks.slice(1).map((t) => (
                    <div
                      key={t}
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/60"
                      style={{ bottom: `${(t / top) * 100}%` }}
                    />
                  ))}
                  {days.map((d) => (
                    <div
                      key={d.day}
                      className="relative flex h-full min-w-0 flex-1 items-end"
                      title={`${d.day}: ${formatUsd(d.costUSD)}`}
                    >
                      <div
                        className="w-full rounded-t-sm bg-primary"
                        style={{
                          height: `${(d.costUSD / top) * 100}%`,
                          minHeight: d.costUSD > 0 ? 2 : 0,
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ml-14 flex pt-1 text-xs text-muted-foreground">
                {days.map((d, i) => (
                  <span
                    key={d.day}
                    className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center"
                  >
                    {i % labelEvery === 0 ? dayLabel(d.day) : ''}
                  </span>
                ))}
              </div>
              <span className="ml-14 pt-1 text-center text-xs text-muted-foreground">
                Date
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
