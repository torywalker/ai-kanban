import fs from 'fs';
import os from 'os';
import path from 'path';
import type { UsageEntry } from '@shared/usage';
import { createCliCostReconciler, readCliCost } from '../main/daemon/cliCost';

const row = (costUSD: number, model = 'm'): UsageEntry => ({
  cardId: 'c',
  turnId: 't',
  at: 'now',
  model,
  canonicalModel: null,
  turnKind: 'run',
  estimated: true,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUSD,
});
const sum = (rows: UsageEntry[]) => rows.reduce((s, r) => s + r.costUSD, 0);

describe('createCliCostReconciler', () => {
  it('bills the CLI delta, split by estimate, and drops the estimated flag', () => {
    const r = createCliCostReconciler();
    const out = r.apply('c', 10, [row(1, 'a'), row(3, 'b')]);
    expect(out.map((e) => e.costUSD)).toEqual([2.5, 7.5]);
    expect(out[0].estimated).toBeUndefined();
    expect(sum(r.apply('c', 12, [row(1)]))).toBeCloseTo(2);
  });

  it('keeps the estimate when there is no CLI cost, and corrects later', () => {
    const r = createCliCostReconciler();
    expect(sum(r.apply('c', null, [row(1)]))).toBe(1);
    expect(sum(r.apply('c', 5, [row(1)]))).toBeCloseTo(4);
  });

  it('treats a lower total as a restarted CLI process', () => {
    const r = createCliCostReconciler();
    r.apply('c', 10, [row(1)]);
    expect(sum(r.apply('c', 2, [row(1)]))).toBeCloseTo(2);
  });
});

describe('readCliCost', () => {
  it('reads cost.total_cost_usd and tolerates a missing file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
    const hook = path.join(dir, 'c.log');
    expect(readCliCost(hook)).toBeNull();
    fs.writeFileSync(`${hook}.cost`, '{"cost":{"total_cost_usd":1.5}}');
    expect(readCliCost(hook)).toBe(1.5);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
