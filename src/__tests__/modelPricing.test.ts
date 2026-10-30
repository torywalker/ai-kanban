/**
 * Local USD rates for Claude CLI transcripts, which report token counts and
 * no price. The table and the Sonnet 5 worked example are spec §5.
 */
import { estimateCostUSD, priceFor } from '../shared/modelPricing';

const ZERO_CACHE = {
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
};

describe('estimateCostUSD', () => {
  it('prices the spec §5 Sonnet 5 turn', () => {
    const cost = estimateCostUSD('claude-sonnet-5', {
      input: 6,
      output: 1490,
      cacheRead: 115493,
      cacheWrite5m: 0,
      cacheWrite1h: 27434,
    });
    // Exact product of the §5 rates, and the SDK figure the spec cites
    // ($0.1477466). The spec's "$0.14774" is that number rounded in prose.
    // toBeCloseTo(0.14774, 5) excludes it: Jest's tolerance is 5e-6 and the
    // delta is 6.6e-6. Precision 4 is the tightest check that still holds.
    expect(cost).toBeCloseTo(0.1477466, 5);
    expect(cost).toBeCloseTo(0.14774, 4);
  });

  it('prices an unknown model at zero', () => {
    expect(priceFor('gpt-x', 0)).toBeNull();
    expect(
      estimateCostUSD('gpt-x', {
        input: 10,
        output: 10,
        cacheRead: 10,
        cacheWrite5m: 10,
        cacheWrite1h: 10,
      }),
    ).toBe(0);
  });
});

describe('priceFor', () => {
  it('matches the longest prefix, so a dated Opus 4.5 id is not Opus 4', () => {
    expect(priceFor('claude-opus-4-5-20251101', 0)?.input).toBe(5);
    expect(priceFor('claude-opus-4-1', 0)?.input).toBe(15);
  });

  it('keeps Haiku 5.5 on the short-prompt tier at 100,000 tokens and the long tier above it', () => {
    expect(priceFor('claude-haiku-5-5', 100_000)?.input).toBe(0.1);
    expect(priceFor('claude-haiku-5-5', 100_001)?.input).toBe(0.5);
  });

  it.each([
    ['claude-fable-5-1', 0, 50],
    ['claude-mythos-5-1', 0, 50],
    ['claude-fable-5', 0, 50],
    ['claude-mythos-5', 0, 50],
    ['claude-opus-5-5', 0, 20],
    ['claude-opus-5', 0, 25],
    ['claude-opus-4-8', 0, 25],
    ['claude-opus-4-7', 0, 25],
    ['claude-opus-4-6', 0, 25],
    ['claude-opus-4-5', 0, 25],
    ['claude-opus-4-1', 0, 75],
    ['claude-opus-4', 0, 75],
    ['claude-sonnet-5-5', 0, 10],
    ['claude-sonnet-5', 0, 10],
    ['claude-sonnet-4-6', 0, 15],
    ['claude-sonnet-4-5', 0, 15],
    ['claude-sonnet-4', 0, 15],
    ['claude-haiku-5-5', 100_000, 0.5],
    ['claude-haiku-5-5', 100_001, 2.5],
    ['claude-haiku-4-5', 0, 5],
    ['claude-haiku-3-5', 0, 4],
  ])(
    '%s at %s prompt tokens has output price %s',
    (model, promptTokens, output) => {
      expect(priceFor(model, promptTokens)?.output).toBe(output);
    },
  );
});

describe('estimateCostUSD token weights', () => {
  it('charges each bucket at its per-million rate', () => {
    // claude-haiku-4-5: input 1, 5m 1.25, 1h 2, cache read 0.1, output 5.
    expect(
      estimateCostUSD('claude-haiku-4-5', {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite5m: 1_000_000,
        cacheWrite1h: 1_000_000,
      }),
    ).toBeCloseTo(1 + 5 + 0.1 + 1.25 + 2, 10);
    expect(
      estimateCostUSD('claude-haiku-4-5', {
        input: 0,
        output: 0,
        ...ZERO_CACHE,
      }),
    ).toBe(0);
  });
});
