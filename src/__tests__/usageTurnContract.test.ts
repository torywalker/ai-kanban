/**
 * One whole turn, driven through the real modules in the real order, into a
 * real ledger file.
 *
 * This exists because of how this feature first failed. Every unit was
 * tested and green, but the capture path had never actually run — the daemon
 * that was serving the app predated it — so nothing had ever checked that
 * the FIELD NAMES match what the SDK emits. A single wrong key
 * (`model_usage` for `modelUsage`, `uuid` absent) makes `buildUsageEntries`
 * return an empty array, which is indistinguishable from "this turn was
 * free": no error, no row, no number on the card.
 *
 * So this test pins the message shapes, copied from `sdk.d.ts`
 * (`SDKAssistantMessage`, `SDKResultSuccess`, `ModelUsage`), and asserts the
 * dollar figure a card would display at the end. It fails if any link in the
 * chain stops agreeing about a key.
 *
 * Mirrors `runTurn`'s loop in `daemon/index.ts`: each yielded message goes
 * to `deriveSessionUpdate` for the snapshot and to `buildUsageEntries` for
 * the ledger.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createInitialSnapshot,
  deriveSessionUpdate,
} from '../main/daemon/deriveSessionUpdate';
import { buildUsageEntries } from '../main/daemon/usageEntry';
import {
  appendUsageEntries,
  readUsageEntries,
} from '../main/daemon/usageLedger';
import {
  settleTurnSnapshot,
  turnOutcomeFromMessage,
  type TurnOutcome,
} from '../main/daemon/turnLifecycle';
import { cardUsageTotals, sumLiveUsage } from '../shared/usage';
import type { SessionSnapshot } from '../shared/daemonProtocol';

const CARD = 'crd_contract';
const AT = '2026-09-11T13:30:00.000Z';

/**
 * The messages one `run` turn yields, in order. Shapes taken from the SDK's
 * own type declarations — `message.usage` is the raw Messages-API object
 * (snake_case), while the result's `modelUsage` is the SDK's own camelCase
 * summary. That inconsistency is real, and getting it wrong in either
 * direction is precisely what this test is here to catch.
 */
const TURN_MESSAGES: Array<Record<string, unknown>> = [
  { type: 'system', subtype: 'init', session_id: 'sess_contract' },
  {
    type: 'assistant',
    uuid: 'evt_1',
    message: {
      id: 'msg_req_1',
      content: [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'Read',
          input: { file_path: 'a.ts' },
        },
      ],
      usage: {
        input_tokens: 4,
        output_tokens: 88,
        cache_read_input_tokens: 20_000,
        cache_creation_input_tokens: 1_500,
      },
    },
  },
  {
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', is_error: false },
      ],
    },
  },
  {
    type: 'assistant',
    uuid: 'evt_2',
    message: {
      id: 'msg_req_2',
      content: [{ type: 'text', text: 'Done.' }],
      usage: {
        input_tokens: 6,
        output_tokens: 120,
        cache_read_input_tokens: 31_000,
        cache_creation_input_tokens: 0,
      },
    },
  },
  {
    type: 'result',
    subtype: 'success',
    uuid: 'res_contract',
    session_id: 'sess_contract',
    is_error: false,
    num_turns: 1,
    result: 'Done.',
    total_cost_usd: 0.0481,
    modelUsage: {
      'claude-opus-5': {
        inputTokens: 10,
        outputTokens: 208,
        cacheReadInputTokens: 51_000,
        cacheCreationInputTokens: 1_500,
        webSearchRequests: 0,
        costUSD: 0.0481,
        contextWindow: 1_000_000,
        maxOutputTokens: 128_000,
        canonicalModel: 'claude-opus-5',
        costBasis: 'list',
      },
    },
  },
];

describe('one turn, end to end', () => {
  let dir: string;
  let ledger: string;
  let snapshot: SessionSnapshot;
  let outcome: TurnOutcome | null;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-kanban-turn-contract-'));
    ledger = path.join(dir, 'usage-ledger.jsonl');
    snapshot = createInitialSnapshot(CARD);
    outcome = null;
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Exactly what `runTurn` does per yielded message. */
  const pump = (message: Record<string, unknown>) => {
    appendUsageEntries(
      ledger,
      buildUsageEntries(CARD, 'run', AT, message as never),
    );
    outcome = turnOutcomeFromMessage(message as never) ?? outcome;
    snapshot = deriveSessionUpdate(snapshot, message as never);
  };

  /** And what it does once the SDK's stream is exhausted. */
  const endStream = () => {
    snapshot = settleTurnSnapshot(snapshot, outcome);
  };

  it('ends with the turn’s real cost readable back off the card', () => {
    TURN_MESSAGES.forEach(pump);

    const totals = cardUsageTotals(readUsageEntries(ledger), CARD);

    expect(totals.turns).toBe(1);
    expect(totals.costUSD).toBeCloseTo(0.0481, 10);
    expect(totals.inputTokens).toBe(10);
    expect(totals.outputTokens).toBe(208);
    expect(totals.cacheReadInputTokens).toBe(51_000);
    expect(totals.cacheCreationInputTokens).toBe(1_500);
    expect(totals.byModel.map((m) => m.model)).toEqual(['claude-opus-5']);
  });

  it('shows tokens climbing mid-turn, before any cost exists', () => {
    // Up to and including the second assistant message — no result yet.
    TURN_MESSAGES.slice(0, 4).forEach(pump);

    const live = sumLiveUsage(snapshot.liveUsage);
    expect(live.inputTokens).toBe(10);
    expect(live.outputTokens).toBe(208);
    expect(live.cacheReadInputTokens).toBe(51_000);

    // Nothing is priced until the turn lands.
    expect(readUsageEntries(ledger)).toEqual([]);
    expect(cardUsageTotals(readUsageEntries(ledger), CARD).costUSD).toBe(0);
  });

  it('hands the numbers over to the ledger exactly once when the turn lands', () => {
    TURN_MESSAGES.forEach(pump);

    // The live tally is surrendered at the result message, so the same
    // tokens are never shown as both "this turn" and part of the total.
    expect(sumLiveUsage(snapshot.liveUsage).inputTokens).toBe(0);
    expect(readUsageEntries(ledger)).toHaveLength(1);

    // The result handed over the numbers but did not end the turn; the
    // card only reads "done" once the stream behind it has closed.
    expect(snapshot.status).toBe('working');
    endStream();
    expect(snapshot.status).toBe('done');
  });

  it('keeps a second turn’s spend additive rather than replacing the first', () => {
    TURN_MESSAGES.forEach(pump);
    // A reply is a fresh `query()` call, so its result reports that turn
    // alone — the reason per-turn rows are summed rather than overwritten.
    const second = {
      ...TURN_MESSAGES[TURN_MESSAGES.length - 1],
      uuid: 'res_contract_2',
      modelUsage: {
        'claude-opus-5': {
          inputTokens: 5,
          outputTokens: 100,
          cacheReadInputTokens: 9_000,
          cacheCreationInputTokens: 0,
          costUSD: 0.0119,
          canonicalModel: 'claude-opus-5',
        },
      },
    };
    appendUsageEntries(
      ledger,
      buildUsageEntries(CARD, 'reply', AT, second as never),
    );

    const totals = cardUsageTotals(readUsageEntries(ledger), CARD);
    expect(totals.turns).toBe(2);
    expect(totals.costUSD).toBeCloseTo(0.06, 10);
  });
});
