/**
 * The capture half of per-card usage accounting: turning the Agent SDK's
 * own `result` message into ledger rows.
 *
 * `modelUsage` is the field the SDK's own docs call "the correct field for
 * token/cost accounting" — the sibling `usage` covers the main agent loop
 * only, excluding Task subagents and sidechains, so a card that delegated
 * work would under-report. It is also documented as cumulative across turns
 * *within one `query()` call*; this daemon opens a fresh `query()` per turn
 * (see `runTurn` in `daemon/index.ts`), so each result carries that turn
 * alone and per-turn rows are the correct reading.
 */
import { buildUsageEntries } from '../main/daemon/usageEntry';

const AT = '2026-09-11T10:00:00.000Z';

function modelUsage(overrides: Record<string, unknown> = {}) {
  return {
    inputTokens: 120,
    outputTokens: 40,
    cacheReadInputTokens: 8000,
    cacheCreationInputTokens: 500,
    costUSD: 0.0312,
    canonicalModel: 'claude-opus-5',
    ...overrides,
  };
}

describe('buildUsageEntries', () => {
  it('ignores every message that is not a turn result', () => {
    ['assistant', 'user', 'system', 'stream_event'].forEach((type) => {
      expect(buildUsageEntries('crd_1', 'run', AT, { type })).toEqual([]);
    });
  });

  it('builds one row per model reported by the result', () => {
    const entries = buildUsageEntries('crd_1', 'run', AT, {
      type: 'result',
      subtype: 'success',
      uuid: 'res_abc',
      modelUsage: {
        'claude-opus-5': modelUsage(),
        'claude-haiku-4-5': modelUsage({
          inputTokens: 10,
          outputTokens: 2,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0.0001,
          canonicalModel: 'claude-haiku-4-5',
        }),
      },
    });

    expect(entries).toEqual([
      {
        cardId: 'crd_1',
        turnId: 'res_abc',
        at: AT,
        model: 'claude-opus-5',
        canonicalModel: 'claude-opus-5',
        turnKind: 'run',
        inputTokens: 120,
        outputTokens: 40,
        cacheReadInputTokens: 8000,
        cacheCreationInputTokens: 500,
        costUSD: 0.0312,
      },
      {
        cardId: 'crd_1',
        turnId: 'res_abc',
        at: AT,
        model: 'claude-haiku-4-5',
        canonicalModel: 'claude-haiku-4-5',
        turnKind: 'run',
        inputTokens: 10,
        outputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0.0001,
      },
    ]);
  });

  it('records the turn kind it was given, so a reply is distinguishable from a fresh run', () => {
    const [entry] = buildUsageEntries('crd_1', 'reply', AT, {
      type: 'result',
      subtype: 'success',
      uuid: 'res_abc',
      modelUsage: { 'claude-opus-5': modelUsage() },
    });

    expect(entry.turnKind).toBe('reply');
  });

  it('records usage from a failed turn — tokens spent before the failure were still spent', () => {
    const entries = buildUsageEntries('crd_1', 'run', AT, {
      type: 'result',
      subtype: 'error_during_execution',
      uuid: 'res_err',
      modelUsage: { 'claude-opus-5': modelUsage() },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0].costUSD).toBe(0.0312);
  });

  it('returns nothing for a result that reported no model usage at all', () => {
    expect(
      buildUsageEntries('crd_1', 'run', AT, {
        type: 'result',
        subtype: 'success',
        uuid: 'res_abc',
      }),
    ).toEqual([]);
    expect(
      buildUsageEntries('crd_1', 'run', AT, {
        type: 'result',
        subtype: 'success',
        uuid: 'res_abc',
        modelUsage: {},
      }),
    ).toEqual([]);
  });

  it('drops an all-zero model row, so a zeroed crash result adds no noise to the ledger', () => {
    const entries = buildUsageEntries('crd_1', 'run', AT, {
      type: 'result',
      subtype: 'error_during_execution',
      uuid: 'res_crash',
      modelUsage: {
        'claude-opus-5': {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 0,
        },
      },
    });

    expect(entries).toEqual([]);
  });

  it('skips a result carrying no uuid, which is the only key that makes a row deduplicable', () => {
    expect(
      buildUsageEntries('crd_1', 'run', AT, {
        type: 'result',
        subtype: 'success',
        modelUsage: { 'claude-opus-5': modelUsage() },
      }),
    ).toEqual([]);
  });

  it('leaves canonicalModel null when the SDK did not report one', () => {
    const [entry] = buildUsageEntries('crd_1', 'run', AT, {
      type: 'result',
      subtype: 'success',
      uuid: 'res_abc',
      modelUsage: {
        'some-proxied-model': modelUsage({ canonicalModel: undefined }),
      },
    });

    expect(entry.canonicalModel).toBeNull();
  });

  it('coerces a missing or non-numeric field to zero rather than poisoning the totals with NaN', () => {
    const [entry] = buildUsageEntries('crd_1', 'run', AT, {
      type: 'result',
      subtype: 'success',
      uuid: 'res_abc',
      modelUsage: {
        'claude-opus-5': {
          inputTokens: 5,
          outputTokens: null,
          costUSD: 'oops',
        },
      },
    });

    expect(entry.outputTokens).toBe(0);
    expect(entry.costUSD).toBe(0);
    expect(entry.cacheReadInputTokens).toBe(0);
    expect(entry.inputTokens).toBe(5);
  });
});
