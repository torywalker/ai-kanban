import fs from 'fs';
import type { UsageEntry } from '@shared/usage';

/** Where the statusLine command drops the CLI's latest status JSON. */
export function cliCostPathFor(hookFile: string): string {
  return `${hookFile}.cost`;
}

/**
 * The CLI's own running session cost (`cost.total_cost_usd`, the number
 * `/cost` shows), or null when the file is missing or unreadable.
 */
export function readCliCost(hookFile: string): number | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(cliCostPathFor(hookFile), 'utf8'),
    );
    const total = parsed?.cost?.total_cost_usd;
    return typeof total === 'number' && Number.isFinite(total) && total >= 0
      ? total
      : null;
  } catch {
    return null;
  }
}

/**
 * Replaces the transcript estimate with the CLI's real cost. The CLI total
 * includes subagents and pricing rules the transcript cannot show, so each
 * batch is billed `total - alreadyBilled`, spread over the batch's rows in
 * proportion to their estimates. The statusLine can lag a Stop hook; a batch
 * that sees no new cost keeps its estimate, and the next one corrects for it
 * because `billed` counts what was actually written.
 */
export function createCliCostReconciler(): {
  apply: (
    cardId: string,
    total: number | null,
    entries: UsageEntry[],
  ) => UsageEntry[];
} {
  const state = new Map<string, { seen: number; billed: number }>();
  return {
    apply(cardId, total, entries) {
      if (entries.length === 0) return entries;
      const cur = state.get(cardId) ?? { seen: 0, billed: 0 };
      state.set(cardId, cur);
      // A lower total means a new CLI process (resume) restarted the count.
      if (total !== null && total < cur.seen) {
        cur.seen = 0;
        cur.billed = 0;
      }
      const delta = total === null ? 0 : total - cur.billed;
      if (total === null || delta <= 1e-9) {
        cur.billed += entries.reduce((sum, e) => sum + e.costUSD, 0);
        return entries;
      }
      cur.seen = total;
      cur.billed = total;
      const estimate = entries.reduce((sum, e) => sum + e.costUSD, 0);
      return entries.map((entry, i) => {
        const share = estimate > 0 ? entry.costUSD / estimate : Number(i === 0);
        const { estimated: _estimated, ...exact } = entry;
        return { ...exact, costUSD: delta * share };
      });
    },
  };
}
