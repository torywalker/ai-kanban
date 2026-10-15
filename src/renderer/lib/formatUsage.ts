/**
 * Display helpers for token/cost figures, kept out of the components that
 * show them so the future cross-card rollup renders the same numbers the
 * same way — a card reading "$0.0312" while a monthly total rounds the same
 * turn to "$0.00" would look like a bug in the accounting rather than in the
 * formatting.
 */
import type { UsageTotals } from '@shared/usage';
import { relativeTime } from './relativeTime';

/**
 * Precision follows magnitude. Most single turns cost a few hundredths of a
 * cent, and a fixed two decimals would print those as "$0.00" — indistinct
 * from free, and indistinct from each other. Above a dollar the extra digits
 * stop earning their width, so cents take over.
 */
export function formatUsd(costUSD: number): string {
  if (costUSD === 0) return '$0.00';
  // A cost too small for four decimals is still a real cost; saying "less
  // than" keeps it from reading as nothing at all.
  if (costUSD < 0.0001) return '<$0.0001';
  if (costUSD < 1) return `$${costUSD.toFixed(4)}`;
  return `$${costUSD.toFixed(2)}`;
}

/**
 * Grouped digits rather than a compact "8K"/"1.2M": these numbers exist to
 * be compared and audited, and compact notation hides exactly the precision
 * someone reviewing spend came for.
 */
export function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US');
}

/**
 * The full breakdown behind a totals figure, as hover text — shared by any
 * display that shows just the headline dollar amount (a card's badge row, a
 * board header's total) but wants the buckets that explain it one hover
 * away rather than duplicated inline.
 *
 * `liveTokens` is optional: it only makes sense for a single card's
 * in-flight turn, not a board total spanning many cards with independent
 * sessions.
 */
export function formatUsageBreakdown(
  totals: UsageTotals,
  liveTokens = 0,
): string {
  const lines: string[] = [];

  if (totals.turns === 0) {
    lines.push('No tokens spent yet.');
  } else {
    lines.push(
      `${formatUsd(totals.costUSD)} across ${totals.turns === 1 ? '1 turn' : `${totals.turns} turns`}`,
      `Input ${formatTokens(totals.inputTokens)} · Output ${formatTokens(totals.outputTokens)}`,
      `Cache read ${formatTokens(totals.cacheReadInputTokens)} · Cache write ${formatTokens(totals.cacheCreationInputTokens)}`,
    );
    // Per-model attribution earns its lines whenever the work spanned
    // models — the model was changed between turns, or a Task subagent ran
    // on a cheaper one — and which model spent what is then the whole story.
    totals.byModel.forEach((model) => {
      lines.push(`${model.model}: ${formatUsd(model.costUSD)}`);
    });
    if (totals.lastRunAt)
      lines.push(`Last run ${relativeTime(totals.lastRunAt)}`);
  }

  if (liveTokens > 0) {
    lines.push(
      `This turn so far: ${formatTokens(liveTokens)} tokens — cost settles when the turn ends.`,
    );
  }

  return lines.join('\n');
}
