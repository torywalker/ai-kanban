/**
 * What a card shows about what it cost.
 *
 * It lives on the card's badge row (priority, colour, tags), pushed to the
 * right edge, which is what makes it a single compact line rather than a
 * stacked block: cost and turn count are always visible, and the full token
 * breakdown moves into the hover title — the same `title` pattern
 * `SessionStatusBadge` already uses for detail that would otherwise crowd
 * the row.
 *
 * Deliberately a standalone component taking plain totals rather than
 * reading a store: the cross-card by-day/week/month rollup will want exactly
 * these numbers over a different range, and a component coupled to one
 * card's fetch could not be reused there.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { UsageSummary } from '@/components/card/UsageSummary';
import { EMPTY_USAGE_TOTALS, type UsageTotals } from '@shared/usage';

function totals(overrides: Partial<UsageTotals> = {}): UsageTotals {
  return {
    ...EMPTY_USAGE_TOTALS,
    turns: 3,
    inputTokens: 1200,
    outputTokens: 450,
    cacheReadInputTokens: 84000,
    cacheCreationInputTokens: 6100,
    costUSD: 0.0312,
    lastRunAt: new Date().toISOString(),
    byModel: [
      {
        model: 'claude-opus-5',
        turns: 3,
        inputTokens: 1200,
        outputTokens: 450,
        cacheReadInputTokens: 84000,
        cacheCreationInputTokens: 6100,
        costUSD: 0.0312,
      },
    ],
    ...overrides,
  };
}

const detailOf = (container: HTMLElement) =>
  container.querySelector('[data-slot="card-usage"]')?.getAttribute('title') ??
  '';

describe('UsageSummary', () => {
  it('leads with the cost, which is the number the user actually came for', () => {
    render(<UsageSummary totals={totals()} />);
    expect(screen.getByText('$0.0312')).toBeInTheDocument();
  });

  it('reports how many turns the cost covers', () => {
    render(<UsageSummary totals={totals({ turns: 3 })} />);
    expect(screen.getByText(/3 turns/)).toBeInTheDocument();
  });

  it('says "turn" in the singular for a card that has run exactly once', () => {
    render(<UsageSummary totals={totals({ turns: 1 })} />);
    expect(screen.getByText(/1 turn(?!s)/)).toBeInTheDocument();
  });

  /**
   * This deliberately replaces an earlier "renders nothing when there is
   * nothing to show" rule. Hiding the block until a card had run made the
   * absence of a cost and the absence of the feature look identical — and
   * the point is to glance at a card and know what it has cost so far,
   * including when the honest answer is "nothing yet".
   */
  it('still shows a zero cost for a card that has never run, rather than hiding', () => {
    render(<UsageSummary totals={EMPTY_USAGE_TOTALS} />);

    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.getByText(/no runs yet/)).toBeInTheDocument();
  });

  it('pushes itself to the right edge of whatever row it is placed on', () => {
    const { container } = render(<UsageSummary totals={totals()} />);
    // `ml-auto` is the mechanism: it consumes the badge row's free space so
    // the figure sits opposite the priority/colour/tag cluster.
    expect(container.querySelector('[data-slot="card-usage"]')).toHaveClass(
      'ml-auto',
    );
  });

  describe('the token breakdown, on hover', () => {
    it('separates input, output and cache rather than giving one total', () => {
      const { container } = render(<UsageSummary totals={totals()} />);
      const detail = detailOf(container);

      expect(detail).toContain('1,200');
      expect(detail).toContain('450');
      // Cache reads are the bulk of an agent session and cost ~10x less; a
      // single merged "tokens" figure would badly overstate the work.
      expect(detail).toContain('84,000');
      expect(detail).toContain('6,100');
    });

    it('names the model when a single model did all the work', () => {
      const { container } = render(<UsageSummary totals={totals()} />);
      expect(detailOf(container)).toContain('claude-opus-5');
    });

    it('attributes cost per model once more than one was used', () => {
      const { container } = render(
        <UsageSummary
          totals={totals({
            costUSD: 0.0322,
            byModel: [
              {
                model: 'claude-opus-5',
                turns: 2,
                inputTokens: 1000,
                outputTokens: 400,
                cacheReadInputTokens: 80000,
                cacheCreationInputTokens: 6000,
                costUSD: 0.0312,
              },
              {
                model: 'claude-haiku-4-5',
                turns: 1,
                inputTokens: 200,
                outputTokens: 50,
                cacheReadInputTokens: 4000,
                cacheCreationInputTokens: 100,
                costUSD: 0.001,
              },
            ],
          })}
        />,
      );
      const detail = detailOf(container);

      expect(detail).toContain('claude-opus-5: $0.0312');
      expect(detail).toContain('claude-haiku-4-5: $0.0010');
    });

    it('says so plainly when the card has never run', () => {
      const { container } = render(
        <UsageSummary totals={EMPTY_USAGE_TOTALS} />,
      );
      expect(detailOf(container)).toContain('No tokens spent yet');
    });
  });

  describe('a turn in flight', () => {
    const live = {
      inputTokens: 300,
      outputTokens: 40,
      cacheReadInputTokens: 12000,
      cacheCreationInputTokens: 0,
    };

    it('shows tokens accumulating for the current turn', () => {
      render(<UsageSummary totals={totals()} live={live} />);
      // 300 + 40 + 12,000: enough to show the number moving as work happens.
      expect(screen.getByText(/12,340/)).toBeInTheDocument();
    });

    it('says the cost of the turn in flight has not settled yet', () => {
      // The SDK only prices a turn at its result message, so promising a
      // dollar figure mid-turn would mean inventing one.
      const { container } = render(
        <UsageSummary totals={totals()} live={live} />,
      );
      expect(detailOf(container)).toContain('settles when the turn ends');
    });

    it('shows the live figure on a card whose very first turn is still running', () => {
      render(<UsageSummary totals={EMPTY_USAGE_TOTALS} live={live} />);
      expect(screen.getByText(/12,340/)).toBeInTheDocument();
    });

    it('drops the live figure once the turn settles and the tally is cleared', () => {
      render(
        <UsageSummary
          totals={totals()}
          live={{
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          }}
        />,
      );
      expect(screen.queryByText(/tok/)).not.toBeInTheDocument();
    });
  });
});
