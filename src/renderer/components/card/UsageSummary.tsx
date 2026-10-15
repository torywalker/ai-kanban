import {
  formatTokens,
  formatUsageBreakdown,
  formatUsd,
} from '@/lib/formatUsage';
import type { UsageTotals } from '@shared/usage';
import type { LiveTokenUsage } from '@shared/daemonProtocol';

interface Props {
  /** Everything the card has spent across every completed turn. */
  totals: UsageTotals;
  /**
   * Tokens spent so far by the turn currently in flight, if one is. Carries
   * no cost because none exists yet — see `formatUsageBreakdown`.
   */
  live?: LiveTokenUsage | null;
}

/**
 * What a card's sessions have cost, as one compact right-aligned figure for
 * the card's badge row.
 *
 * Takes plain totals rather than reading a store or fetching for itself, so
 * the same numbers can be rendered for a card's lifetime, a single day, or a
 * month once there is a screen asking for those.
 */
export function UsageSummary({ totals, live }: Props) {
  const liveTokens = live
    ? live.inputTokens +
      live.outputTokens +
      live.cacheReadInputTokens +
      live.cacheCreationInputTokens
    : 0;

  return (
    <div
      data-slot="card-usage"
      // `ml-auto` is what right-aligns it: it eats the badge row's free
      // space so the figure sits opposite the priority/colour/tag cluster
      // instead of trailing directly after the last tag.
      className="ml-auto flex shrink-0 items-baseline gap-1.5 text-xs"
      title={formatUsageBreakdown(totals, liveTokens)}
    >
      {/* Always rendered, zero included: hiding it made "this has cost
          nothing yet" indistinguishable from "this card does not track
          cost". */}
      <span className="font-medium tabular-nums">
        {formatUsd(totals.costUSD)}
      </span>
      <span className="text-muted-foreground">
        {totals.turns === 0
          ? 'no runs yet'
          : totals.turns === 1
            ? '1 turn'
            : `${totals.turns} turns`}
      </span>
      {/*
        The turn in flight, in tokens only.

        The Agent SDK computes a turn's cost at its `result` message and not
        before, so there is no honest dollar figure to put here — the choice
        is between naming the tokens and saying the price is still coming, or
        pricing them locally from a rate table that would quietly drift out
        of date. So the token count moves now and the money lands when the
        turn does.
      */}
      {liveTokens > 0 ? (
        <span className="text-muted-foreground tabular-nums italic">
          +{formatTokens(liveTokens)} tok
        </span>
      ) : null}
    </div>
  );
}
