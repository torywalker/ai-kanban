/**
 * The ledger is the durable record of what every card's sessions cost — the
 * one piece of this feature that is NOT regenerable. That is the difference
 * between it and `sessionCache.ts`, which deliberately skips validation
 * because a corrupt entry there can simply be rebuilt: a row lost or
 * mis-parsed here is spend the user can never see again, and a row that
 * parses into garbage would poison every total computed from it.
 *
 * Real filesystem rather than a mocked `fs`, matching `sessionCache.test.ts`:
 * these are thin wrappers over append/read, and a genuine round trip through
 * a temp directory is both simpler and more convincing than asserting on a
 * mock's call log.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { UsageEntry } from '../shared/usage';
import {
  appendUsageEntries,
  readUsageEntries,
  usageLedgerPathFor,
} from '../main/daemon/usageLedger';

function entry(overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    cardId: 'crd_1',
    turnId: 'res_1',
    at: '2026-09-11T10:00:00.000Z',
    model: 'claude-opus-5',
    canonicalModel: 'claude-opus-5',
    turnKind: 'run',
    inputTokens: 120,
    outputTokens: 40,
    cacheReadInputTokens: 8000,
    cacheCreationInputTokens: 500,
    costUSD: 0.0312,
    ...overrides,
  };
}

describe('usageLedgerPathFor', () => {
  it('sits beside the socket file, in the same directory the session cache uses', () => {
    expect(usageLedgerPathFor('/some/userData/session-daemon.sock')).toBe(
      '/some/userData/usage-ledger.jsonl',
    );
  });
});

describe('appendUsageEntries + readUsageEntries', () => {
  let dir: string;
  let ledger: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ai-kanban-usage-ledger-test-'),
    );
    ledger = path.join(dir, 'usage-ledger.jsonl');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips a row exactly', () => {
    appendUsageEntries(ledger, [entry()]);
    expect(readUsageEntries(ledger)).toEqual([entry()]);
  });

  it('appends rather than overwrites, so earlier turns survive later ones', () => {
    appendUsageEntries(ledger, [entry({ turnId: 'res_1' })]);
    appendUsageEntries(ledger, [entry({ turnId: 'res_2' })]);
    appendUsageEntries(ledger, [entry({ turnId: 'res_3' })]);

    expect(readUsageEntries(ledger).map((item) => item.turnId)).toEqual([
      'res_1',
      'res_2',
      'res_3',
    ]);
  });

  it('writes one line per row so a partial write can only ever cost the last row', () => {
    appendUsageEntries(ledger, [
      entry({ model: 'claude-opus-5' }),
      entry({ model: 'claude-haiku-4-5' }),
    ]);

    const lines = fs.readFileSync(ledger, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('creates the containing directory if it does not exist yet', () => {
    const nested = path.join(dir, 'not-created-yet', 'usage-ledger.jsonl');
    appendUsageEntries(nested, [entry()]);
    expect(readUsageEntries(nested)).toHaveLength(1);
  });

  it('writes nothing at all when handed no rows', () => {
    appendUsageEntries(ledger, []);
    expect(fs.existsSync(ledger)).toBe(false);
  });

  it('reads an empty list for a ledger that has never been written', () => {
    expect(readUsageEntries(path.join(dir, 'absent.jsonl'))).toEqual([]);
  });

  it('skips a torn or malformed line and keeps every good row around it', () => {
    appendUsageEntries(ledger, [entry({ turnId: 'res_1' })]);
    fs.appendFileSync(ledger, '{"cardId":"crd_1","turnId":"res_tor\n');
    appendUsageEntries(ledger, [entry({ turnId: 'res_2' })]);

    expect(readUsageEntries(ledger).map((item) => item.turnId)).toEqual([
      'res_1',
      'res_2',
    ]);
  });

  it('skips a row whose shape is wrong, so a bad field can never become a NaN total', () => {
    appendUsageEntries(ledger, [entry({ turnId: 'res_good' })]);
    fs.appendFileSync(
      ledger,
      `${JSON.stringify({ ...entry({ turnId: 'res_bad' }), costUSD: 'free' })}\n`,
    );

    expect(readUsageEntries(ledger).map((item) => item.turnId)).toEqual([
      'res_good',
    ]);
  });
});
