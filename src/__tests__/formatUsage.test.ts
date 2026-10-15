/**
 * Agent-session costs live at an awkward scale: a single cheap turn can be
 * a few hundredths of a cent, while a long card can run into dollars. Two
 * decimal places would render most real turns as "$0.00" — which reads as
 * "this was free" rather than "this was small" — so the formatter has to
 * change precision with magnitude.
 */
import { formatTokens, formatUsageBreakdown, formatUsd } from '@/lib/formatUsage';
import { EMPTY_USAGE_TOTALS, type UsageTotals } from '@shared/usage';

describe('formatUsd', () => {
  it('shows four decimals for the sub-dollar costs most turns land at', () => {
    expect(formatUsd(0.0312)).toBe('$0.0312');
    expect(formatUsd(0.5)).toBe('$0.5000');
  });

  it('shows two decimals once the cost passes a dollar, where cents are the useful unit', () => {
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(12.3456)).toBe('$12.35');
  });

  it('never rounds a real cost down to nothing', () => {
    expect(formatUsd(0.00001)).toBe('<$0.0001');
  });

  it('shows an exact zero as a plain zero, not as "less than"', () => {
    expect(formatUsd(0)).toBe('$0.00');
  });
});

describe('formatTokens', () => {
  it('groups thousands so six-figure counts stay readable', () => {
    expect(formatTokens(8000)).toBe('8,000');
    expect(formatTokens(1234567)).toBe('1,234,567');
  });

  it('leaves small counts alone', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(40)).toBe('40');
  });
});

describe('formatUsageBreakdown', () => {
  it('says nothing has been spent when there are no turns', () => {
    expect(formatUsageBreakdown(EMPTY_USAGE_TOTALS)).toBe(
      'No tokens spent yet.',
    );
  });

  it('leads with the cost-over-turns line and includes per-model attribution', () => {
    const totals: UsageTotals = {
      turns: 2,
      inputTokens: 300,
      outputTokens: 60,
      cacheReadInputTokens: 15000,
      cacheCreationInputTokens: 900,
      costUSD: 0.053,
      lastRunAt: '2026-09-11T10:00:00.000Z',
      byModel: [
        {
          model: 'claude-opus-5',
          turns: 1,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 5000,
          cacheCreationInputTokens: 300,
          costUSD: 0.05,
        },
      ],
    };

    const breakdown = formatUsageBreakdown(totals);

    expect(breakdown).toContain('$0.0530 across 2 turns');
    expect(breakdown).toContain('claude-opus-5: $0.0500');
  });

  it('appends the in-flight turn as tokens only, never a cost', () => {
    expect(formatUsageBreakdown(EMPTY_USAGE_TOTALS, 500)).toContain(
      'This turn so far: 500 tokens — cost settles when the turn ends.',
    );
  });

  it('omits the in-flight line when nothing is live', () => {
    expect(formatUsageBreakdown(EMPTY_USAGE_TOTALS, 0)).not.toContain(
      'This turn so far',
    );
  });
});
