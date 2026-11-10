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

  const idsKey = useMemo(
    () =>
      board?.lists.flatMap((l) => l.cards.map((c) => c.id)).join(',') ?? '',
    [board],
  );

  useEffect(() => {
    if (!open || !range.from || !range.to || range.from > range.to) {
      setDays([]);
      return;
    }
    let cancelled = false;
    api.usage
      .boardDaily(idsKey === '' ? [] : idsKey.split(','), range.from, range.to)
      .then((next) => {
        if (!cancelled) setDays(next);
      })
      .catch(() => {
        if (!cancelled) setDays([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, idsKey, range]);

  const total = days.reduce((sum, d) => sum + d.costUSD, 0);
  const max = Math.max(...days.map((d) => d.costUSD), 0);

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
            Pick a valid date range.
          </p>
        ) : (
          <div
            className="flex h-64 items-end gap-px"
            role="img"
            aria-label="Daily spend bar chart"
          >
            {days.map((d) => (
              <div
                key={d.day}
                className="flex h-full min-w-0 flex-1 items-end"
                title={`${d.day}: ${formatUsd(d.costUSD)}`}
              >
                <div
                  className="w-full rounded-t-sm bg-primary"
                  style={{
                    height: max > 0 ? `${(d.costUSD / max) * 100}%` : 0,
                    minHeight: d.costUSD > 0 ? 2 : 0,
                  }}
                />
              </div>
            ))}
          </div>
        )}
        {days.length > 0 && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{days[0].day}</span>
            <span>Peak {formatUsd(max)}</span>
            <span>{days[days.length - 1].day}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
