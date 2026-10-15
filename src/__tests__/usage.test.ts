/**
 * The aggregation half of per-card usage accounting. The ledger stores one
 * row per model per turn (see `usageEntry.ts` for why per-model), so every
 * number the card's View dialog shows — and every number a future
 * by-day/week/month rollup will show — comes out of this function rather
 * than being accumulated anywhere stateful.
 *
 * `turns` is the reason entries carry a `turnId`: a single turn that ran
 * work on two models produces two rows, so counting rows would double-count
 * the turn. Grouping by the result message's own uuid counts what a user
 * would call a turn.
 */
import {
  boardUsageTotals,
  cardUsageTotals,
  sumUsageEntries,
  type UsageEntry,
} from '../shared/usage';

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    cardId: 'crd_1',
    turnId: 'res_1',
    at: '2026-09-11T10:00:00.000Z',
    model: 'claude-opus-5',
    canonicalModel: 'claude-opus-5',
    turnKind: 'run',
    inputTokens: 100,
    outputTokens: 20,
    cacheReadInputTokens: 5000,
    cacheCreationInputTokens: 300,
    costUSD: 0.01,
    ...overrides,
  };
}

describe('sumUsageEntries', () => {
  it('reports an all-zero, turn-less total for a card that has never run', () => {
    expect(sumUsageEntries([])).toEqual({
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUSD: 0,
      lastRunAt: null,
      byModel: [],
    });
  });

  it('adds every token bucket and the cost across turns', () => {
    const totals = sumUsageEntries([
      entry({ turnId: 'res_1' }),
      entry({
        turnId: 'res_2',
        inputTokens: 7,
        outputTokens: 3,
        costUSD: 0.02,
      }),
    ]);

    expect(totals.inputTokens).toBe(107);
    expect(totals.outputTokens).toBe(23);
    expect(totals.cacheReadInputTokens).toBe(10000);
    expect(totals.cacheCreationInputTokens).toBe(600);
    expect(totals.costUSD).toBeCloseTo(0.03, 10);
  });

  it('counts one turn per turnId, not one per row', () => {
    const totals = sumUsageEntries([
      entry({ turnId: 'res_1', model: 'claude-opus-5' }),
      // Same turn, second model: a Task subagent or compaction call.
      entry({ turnId: 'res_1', model: 'claude-haiku-4-5' }),
      entry({ turnId: 'res_2', model: 'claude-opus-5' }),
    ]);

    expect(totals.turns).toBe(2);
  });

  it('reports the newest entry time as lastRunAt regardless of row order', () => {
    const totals = sumUsageEntries([
      entry({ turnId: 'res_2', at: '2026-09-11T12:00:00.000Z' }),
      entry({ turnId: 'res_1', at: '2026-09-11T09:00:00.000Z' }),
    ]);

    expect(totals.lastRunAt).toBe('2026-09-11T12:00:00.000Z');
  });

  it('breaks the totals down per model, most expensive first', () => {
    const totals = sumUsageEntries([
      entry({ turnId: 'res_1', model: 'claude-haiku-4-5', costUSD: 0.001 }),
      entry({ turnId: 'res_1', model: 'claude-opus-5', costUSD: 0.05 }),
      entry({ turnId: 'res_2', model: 'claude-haiku-4-5', costUSD: 0.002 }),
    ]);

    expect(totals.byModel).toEqual([
      {
        model: 'claude-opus-5',
        turns: 1,
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 300,
        costUSD: 0.05,
      },
      {
        model: 'claude-haiku-4-5',
        turns: 2,
        inputTokens: 200,
        outputTokens: 40,
        cacheReadInputTokens: 10000,
        cacheCreationInputTokens: 600,
        costUSD: 0.003,
      },
    ]);
  });

  it('ignores a duplicated row so a re-appended ledger line cannot inflate spend', () => {
    const once = sumUsageEntries([entry()]);
    const twice = sumUsageEntries([entry(), entry()]);

    expect(twice).toEqual(once);
  });
});

/**
 * The ledger is one file for every card on every board, so the card's own
 * total is a filtered read of it. Keeping that filter here — rather than in
 * the IPC handler — is what lets it be tested without a live main process.
 */
describe('cardUsageTotals', () => {
  it('counts only the requested card', () => {
    const totals = cardUsageTotals(
      [
        entry({ cardId: 'crd_mine', turnId: 'res_1', costUSD: 0.01 }),
        entry({ cardId: 'crd_other', turnId: 'res_2', costUSD: 9.99 }),
        entry({ cardId: 'crd_mine', turnId: 'res_3', costUSD: 0.02 }),
      ],
      'crd_mine',
    );

    expect(totals.turns).toBe(2);
    expect(totals.costUSD).toBeCloseTo(0.03, 10);
  });

  it('reports empty totals for a card with no rows at all', () => {
    expect(
      cardUsageTotals([entry({ cardId: 'crd_other' })], 'crd_mine'),
    ).toEqual(sumUsageEntries([]));
  });
});

/**
 * Same filtered-sum shape as `cardUsageTotals`, but against a set of ids —
 * what a board's header total needs, since a board is a set of cards rather
 * than one.
 */
describe('boardUsageTotals', () => {
  it('counts every card on the board and ignores cards on other boards', () => {
    const totals = boardUsageTotals(
      [
        entry({ cardId: 'crd_a', turnId: 'res_1', costUSD: 0.01 }),
        entry({ cardId: 'crd_b', turnId: 'res_2', costUSD: 0.02 }),
        entry({ cardId: 'crd_other_board', turnId: 'res_3', costUSD: 9.99 }),
      ],
      ['crd_a', 'crd_b'],
    );

    expect(totals.turns).toBe(2);
    expect(totals.costUSD).toBeCloseTo(0.03, 10);
  });

  it('reports empty totals for a board with no cards', () => {
    expect(
      boardUsageTotals([entry({ cardId: 'crd_a' })], []),
    ).toEqual(sumUsageEntries([]));
  });
});
