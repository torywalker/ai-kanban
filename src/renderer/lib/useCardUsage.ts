import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSessionStore } from '@/store/sessionStore';
import { EMPTY_USAGE_TOTALS, type UsageTotals } from '@shared/usage';

/**
 * A card's lifetime token/cost totals, read from the usage ledger.
 *
 * Read over IPC rather than taken from the card's session snapshot, because
 * usage is durable history and a snapshot is live state: a card whose
 * session ran under a daemon that has since died — or before the app was
 * last relaunched — has no snapshot at all, and must still be able to say
 * what it cost.
 *
 * Refetches when the card's turn reaches a terminal status. Cost is only
 * knowable at a turn's `result` message, which is also the moment the daemon
 * appends the row, so that transition is precisely the signal that there is
 * something new to read. Statuses that move within a turn
 * (`working` <-> `waiting`, as tool approvals come and go) deliberately do
 * not trigger a read: the ledger cannot have changed, and re-parsing the
 * whole file on every tool call would be pure waste.
 */
export function useCardUsage(cardId: string): UsageTotals {
  const status = useSessionStore((s) => s.sessions[cardId]?.status);
  const [totals, setTotals] = useState<UsageTotals>(EMPTY_USAGE_TOTALS);

  // Collapsing the status to a boolean is what limits refetches to turn
  // boundaries: every mid-turn status maps to the same value, so the effect's
  // dependency only changes when a turn actually starts or ends. `undefined`
  // (no session in this process's memory) counts as settled — nothing is
  // running, so whatever the ledger holds is final.
  const turnSettled = status !== 'working' && status !== 'waiting';

  useEffect(() => {
    // `cancelled` rather than an unguarded `setTotals`: switching cards (or
    // a turn settling) starts a new read while the previous one may still be
    // in flight, and the slower of the two must not win and show one card's
    // spend on another.
    let cancelled = false;
    const read = async () => {
      try {
        const next = await api.usage.cardTotals(cardId);
        if (!cancelled) setTotals(next);
      } catch {
        // A ledger that cannot be read (permissions, a corrupt directory)
        // must not take the card down with it. Usage is informational; the
        // card's prompt, transcript and controls are not, and they are what
        // the dialog exists for. Falling back to empty totals hides the
        // section rather than rendering a broken one.
        if (!cancelled) setTotals(EMPTY_USAGE_TOTALS);
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [cardId, turnSettled]);

  return totals;
}
