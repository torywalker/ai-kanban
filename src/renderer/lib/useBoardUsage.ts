import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSessionStore } from '@/store/sessionStore';
import { EMPTY_USAGE_TOTALS, type UsageTotals } from '@shared/usage';

/**
 * A board's token/cost totals for the cards currently in view — the sum of
 * the ids the caller passed — read from the usage ledger the same way
 * `useCardUsage` reads a single card's. See that hook for why this comes
 * from the ledger rather than any live session snapshot.
 *
 * Refetches whenever any of the board's cards has a turn reach a terminal
 * status, for the same reason `useCardUsage` refetches on its one card's
 * turn boundary: that is the only moment the ledger can have grown.
 */
export function useBoardUsage(cardIds: string[]): UsageTotals {
  // Collapsed to one string so the effect below has a single, stable
  // dependency: any card's turn starting or ending changes this key, and
  // nothing else does — the same "boolean per card, joined" trick that lets
  // `useCardUsage` ignore the busy statuses that move mid-turn.
  const settledKey = useSessionStore((s) =>
    cardIds
      .map((id) => {
        const status = s.sessions[id]?.status;
        return status === 'working' || status === 'waiting' ? '1' : '0';
      })
      .join(''),
  );
  const idsKey = cardIds.join(',');
  const [totals, setTotals] = useState<UsageTotals>(EMPTY_USAGE_TOTALS);

  useEffect(() => {
    // Rebuilt from `idsKey` rather than closing over the `cardIds` prop
    // directly: the caller re-derives that array every render (it is a
    // `flatMap` over the board's lists), so depending on it by reference
    // would refetch on every render instead of only when membership
    // actually changes. Ids never contain commas, so this round-trips
    // exactly.
    const ids = idsKey === '' ? [] : idsKey.split(',');

    // `cancelled` rather than an unguarded `setTotals`: switching boards (or
    // a card's turn settling) starts a new read while the previous one may
    // still be in flight, and the slower of the two must not win and show
    // one board's spend on another.
    let cancelled = false;

    // A board with no cards yet has nothing to ask the ledger for; skipping
    // the round trip also means a fresh board never flickers past a stale
    // total from whichever board was active before it.
    if (ids.length === 0) {
      setTotals(EMPTY_USAGE_TOTALS);
    } else {
      const read = async () => {
        try {
          const next = await api.usage.boardTotals(ids);
          if (!cancelled) setTotals(next);
        } catch {
          // A ledger that cannot be read must not take the board view down
          // with it — see `useCardUsage` for the same reasoning at card
          // scope.
          if (!cancelled) setTotals(EMPTY_USAGE_TOTALS);
        }
      };
      void read();
    }

    return () => {
      cancelled = true;
    };
  }, [idsKey, settledKey]);

  return totals;
}
