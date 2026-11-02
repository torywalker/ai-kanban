/**
 * USD per million tokens for Claude CLI transcripts, which carry counts and
 * no price. Rates are Anthropic's public table on 2026-10-30 (spec §5).
 * Model ids match by longest prefix (`claude-opus-4-5-20251101` is 4.5, not 4).
 */

export interface ModelPrice {
  input: number;
  write5m: number;
  write1h: number;
  cacheRead: number;
  output: number;
}

export interface RequestUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
}

/** Haiku 5.5's second rate starts strictly above this many prompt tokens. */
const HAIKU_55_LONG_PROMPT = 100_000;

function rate(
  input: number,
  write5m: number,
  write1h: number,
  cacheRead: number,
  output: number,
): ModelPrice {
  return { input, write5m, write1h, cacheRead, output };
}

const PRICES: {
  prefix: string;
  price: ModelPrice;
  longPrompt?: ModelPrice;
}[] = [
  { prefix: 'claude-fable-5-1', price: rate(10, 12.5, 20, 0.25, 50) },
  { prefix: 'claude-mythos-5-1', price: rate(10, 12.5, 20, 0.25, 50) },
  { prefix: 'claude-fable-5', price: rate(10, 12.5, 20, 1, 50) },
  { prefix: 'claude-mythos-5', price: rate(10, 12.5, 20, 1, 50) },
  { prefix: 'claude-opus-5-5', price: rate(4, 5, 8, 0.2, 20) },
  { prefix: 'claude-opus-5', price: rate(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-8', price: rate(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-7', price: rate(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-6', price: rate(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-5', price: rate(5, 6.25, 10, 0.5, 25) },
  { prefix: 'claude-opus-4-1', price: rate(15, 18.75, 30, 1.5, 75) },
  { prefix: 'claude-opus-4', price: rate(15, 18.75, 30, 1.5, 75) },
  { prefix: 'claude-sonnet-5-5', price: rate(2, 2.5, 4, 0.1, 10) },
  { prefix: 'claude-sonnet-5', price: rate(2, 2.5, 4, 0.2, 10) },
  { prefix: 'claude-sonnet-4-6', price: rate(3, 3.75, 6, 0.3, 15) },
  { prefix: 'claude-sonnet-4-5', price: rate(3, 3.75, 6, 0.3, 15) },
  { prefix: 'claude-sonnet-4', price: rate(3, 3.75, 6, 0.3, 15) },
  {
    prefix: 'claude-haiku-5-5',
    price: rate(0.1, 0.125, 0.2, 0.01, 0.5),
    longPrompt: rate(0.5, 0.625, 1, 0.05, 2.5),
  },
  { prefix: 'claude-haiku-4-5', price: rate(1, 1.25, 2, 0.1, 5) },
  { prefix: 'claude-haiku-3-5', price: rate(0.8, 1, 1.6, 0.08, 4) },
];

export function priceFor(
  model: string,
  promptTokens: number,
): ModelPrice | null {
  const match = PRICES.reduce<{
    prefix: string;
    price: ModelPrice;
    longPrompt?: ModelPrice;
  } | null>((best, row) => {
    if (!model.startsWith(row.prefix)) return best;
    if (!best || row.prefix.length > best.prefix.length) return row;
    return best;
  }, null);
  if (!match) return null;
  if (match.longPrompt && promptTokens > HAIKU_55_LONG_PROMPT) {
    return match.longPrompt;
  }
  return match.price;
}

export function estimateCostUSD(model: string, usage: RequestUsage): number {
  const promptTokens =
    usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h;
  const price = priceFor(model, promptTokens);
  if (!price) return 0;
  return (
    (usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheWrite5m * price.write5m +
      usage.cacheWrite1h * price.write1h) /
    1_000_000
  );
}
