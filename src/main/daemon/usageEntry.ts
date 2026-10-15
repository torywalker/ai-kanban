import type { UsageEntry } from '@shared/usage';

/**
 * Any non-finite or non-numeric field becomes 0. One `NaN` anywhere would
 * propagate through every sum that ever touches this row and render the
 * card's cost as "$NaN" permanently, since the ledger is append-only.
 */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Turns one yielded SDK message into the ledger rows it deserves — none for
 * anything but a turn's `result`, one per model for that.
 *
 * Pure, and deliberately separate from the append that follows it, for the
 * same reason `deriveSessionUpdate` and `turnLifecycle` are pure: the
 * decision of what a message means is testable data transformation, while
 * the write is an effect at the edge of `runTurn`.
 */
export function buildUsageEntries(
  cardId: string,
  turnKind: 'run' | 'reply',
  at: string,
  // Shaped `unknown`-ly rather than importing the SDK's `SDKResultMessage`,
  // matching `deriveSessionUpdate`: this function's contract is "whatever
  // the SDK yields", and pinning the exact imported type would make the
  // file and its test depend on the SDK being installed to type-check.
  message: {
    type: string;
    subtype?: string;
    uuid?: string;
    modelUsage?: Record<string, unknown>;
  },
): UsageEntry[] {
  if (message.type !== 'result') return [];

  // Both result subtypes are recorded, success and error alike: a turn that
  // failed partway through still burned every token it had spent up to that
  // point, and omitting those would make the card under-report real money.
  const turnId = message.uuid;
  // A row with no turn id cannot be deduplicated or counted as a turn, and
  // `uuid` is mandatory on the SDK's own result types — so an absent one
  // means a producer this code does not understand. Dropping the row loses
  // a turn's usage; keeping it risks silently inflating the user's reported
  // spend on any re-append. Under-reporting is the safer failure.
  if (typeof turnId !== 'string' || !turnId) return [];

  const { modelUsage } = message;
  if (!modelUsage || typeof modelUsage !== 'object') return [];

  return (
    Object.entries(modelUsage)
      .map(([model, raw]) => {
        const usage = (raw ?? {}) as Record<string, unknown>;
        const canonical = usage.canonicalModel;
        return {
          cardId,
          turnId,
          at,
          model,
          canonicalModel: typeof canonical === 'string' ? canonical : null,
          turnKind,
          inputTokens: count(usage.inputTokens),
          outputTokens: count(usage.outputTokens),
          cacheReadInputTokens: count(usage.cacheReadInputTokens),
          cacheCreationInputTokens: count(usage.cacheCreationInputTokens),
          costUSD: count(usage.costUSD),
        };
      })
      // A crash or startup-error result can carry a fully zeroed usage record.
      // Those rows would count as turns and clutter the per-model breakdown
      // while adding nothing to any total.
      .filter(
        (entry) =>
          entry.inputTokens > 0 ||
          entry.outputTokens > 0 ||
          entry.cacheReadInputTokens > 0 ||
          entry.cacheCreationInputTokens > 0 ||
          entry.costUSD > 0,
      )
  );
}
