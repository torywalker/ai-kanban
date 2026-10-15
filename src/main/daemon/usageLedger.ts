import fs from 'fs';
import path from 'path';
import { UsageEntrySchema, type UsageEntry } from '@shared/usage';

/**
 * The durable record of what every card's sessions have cost.
 *
 * Newline-delimited JSON, appended to and never rewritten. Three reasons
 * that shape rather than a single JSON document: an append is one syscall
 * that cannot lose earlier rows no matter when the process dies (this
 * daemon is detached and unsupervised, so it can die at any moment); a torn
 * final line costs exactly one turn instead of the whole history; and rows
 * carrying their own timestamp are what lets a future by-day/week/month
 * rollup read the file once and group it, without any per-card bookkeeping
 * to keep in sync.
 *
 * Lives beside the socket file — the same directory `sessionCache.ts`
 * reaches for the same reason: this process runs under
 * `ELECTRON_RUN_AS_NODE`, plain Node with no access to Electron's `app`,
 * and the socket's own directory IS `app.getPath('userData')`.
 *
 * Deliberately NOT the user's kanban document. Usage rows would grow that
 * file without bound, ride along in every undo snapshot the renderer keeps,
 * and — worst — make spend accounting undoable: one Ctrl+Z after a turn
 * would quietly revert the record of money already spent.
 */
export function usageLedgerPathFor(socketPath: string): string {
  return path.join(path.dirname(socketPath), 'usage-ledger.jsonl');
}

/**
 * Best-effort append, matching `writeCachedSnapshot`: a ledger write failing
 * (disk full, permissions) must never take down a live session. Losing a
 * cost row is a reporting gap; throwing here would kill the turn that
 * produced it.
 */
export function appendUsageEntries(
  ledgerPath: string,
  entries: UsageEntry[],
): void {
  if (entries.length === 0) return;
  try {
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    // `JSON.stringify` escapes any newline inside a string value, so one
    // row is always exactly one line — the invariant the reader relies on
    // to isolate a torn write to a single row.
    const lines = entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
    fs.appendFileSync(ledgerPath, lines);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('daemon: failed to append usage ledger', error);
  }
}

/**
 * Every valid row in the ledger, oldest first. A missing file reads as an
 * empty history — the normal state before a card has ever run.
 *
 * Rows are validated and bad ones skipped rather than throwing, because
 * this file is append-only and permanent: one unparseable line from a
 * crashed mid-append write would otherwise make a user's entire spend
 * history unreadable forever. Validation is genuinely needed (where
 * `sessionCache.ts` skips it) because nothing can regenerate these rows,
 * and a row whose `costUSD` is not a number would turn every total computed
 * from it into `NaN`.
 */
export function readUsageEntries(ledgerPath: string): UsageEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(ledgerPath, 'utf8');
  } catch {
    return [];
  }

  const entries: UsageEntry[] = [];
  raw.split('\n').forEach((line) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const result = UsageEntrySchema.safeParse(parsed);
    if (result.success) entries.push(result.data);
  });
  return entries;
}
