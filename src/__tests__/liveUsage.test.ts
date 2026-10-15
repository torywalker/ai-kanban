/**
 * Tokens are visible while a turn is still running; dollars are not.
 *
 * The SDK only computes cost (`modelUsage[...].costUSD`) on a turn's final
 * `result` message. Mid-turn, each `assistant` message carries a raw
 * Messages-API `usage` object — token counts, no price — so a live figure
 * can honestly report tokens climbing and must not invent a dollar amount
 * to go with them. Pricing them here would mean shipping a local rate table
 * that silently goes stale the moment Anthropic changes prices, which is
 * exactly what deferring to the SDK's own `costUSD` avoids.
 *
 * The per-`message.id` keying is the other half of getting this right. Per
 * the SDK's own docs the CLI "emits one assistant message per completed
 * content block, so several consecutive assistant messages can share
 * message.id", and on those "message.usage is not final" — each one reports
 * the running usage of the SAME API request. Summing every message would
 * therefore multiply one request's tokens by its number of content blocks;
 * keeping the latest value per id and summing across ids counts each request
 * once.
 */
import {
  createInitialSnapshot,
  deriveSessionUpdate,
} from '../main/daemon/deriveSessionUpdate';
import { startTurnSnapshot } from '../main/daemon/turnLifecycle';
import { sumLiveUsage } from '../shared/usage';

const usage = (overrides: Record<string, unknown> = {}) => ({
  input_tokens: 100,
  output_tokens: 20,
  cache_read_input_tokens: 5000,
  cache_creation_input_tokens: 300,
  ...overrides,
});

const assistantMessage = (
  id: string,
  uuid: string,
  usageOverrides: Record<string, unknown> = {},
) => ({
  type: 'assistant',
  uuid,
  message: {
    id,
    content: [{ type: 'text', text: 'working on it' }],
    usage: usage(usageOverrides),
  },
});

describe('live turn usage', () => {
  const base = () => createInitialSnapshot('crd_1');

  it('records an assistant message’s token usage against its message id', () => {
    const snapshot = deriveSessionUpdate(
      base(),
      assistantMessage('msg_1', 'evt_1'),
    );

    expect(snapshot.liveUsage).toEqual({
      msg_1: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadInputTokens: 5000,
        cacheCreationInputTokens: 300,
      },
    });
  });

  it('replaces rather than adds when the same request reports again', () => {
    let snapshot = deriveSessionUpdate(
      base(),
      assistantMessage('msg_1', 'evt_1'),
    );
    snapshot = deriveSessionUpdate(
      snapshot,
      assistantMessage('msg_1', 'evt_2', { output_tokens: 90 }),
    );

    // One API request that has now produced more output — not two requests.
    expect(sumLiveUsage(snapshot.liveUsage).outputTokens).toBe(90);
    expect(sumLiveUsage(snapshot.liveUsage).inputTokens).toBe(100);
  });

  it('adds up across separate requests within the turn', () => {
    let snapshot = deriveSessionUpdate(
      base(),
      assistantMessage('msg_1', 'evt_1'),
    );
    snapshot = deriveSessionUpdate(
      snapshot,
      assistantMessage('msg_2', 'evt_2'),
    );

    expect(sumLiveUsage(snapshot.liveUsage).inputTokens).toBe(200);
    expect(sumLiveUsage(snapshot.liveUsage).outputTokens).toBe(40);
  });

  it('ignores an assistant message that carries no usage at all', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'assistant',
      uuid: 'evt_1',
      message: { id: 'msg_1', content: [{ type: 'text', text: 'hi' }] },
    });

    expect(sumLiveUsage(snapshot.liveUsage).inputTokens).toBe(0);
  });

  it('clears the live figure when the turn ends, since the ledger now owns it', () => {
    let snapshot = deriveSessionUpdate(
      base(),
      assistantMessage('msg_1', 'evt_1'),
    );
    expect(sumLiveUsage(snapshot.liveUsage).inputTokens).toBe(100);

    snapshot = deriveSessionUpdate(snapshot, {
      type: 'result',
      subtype: 'success',
      uuid: 'res_1',
      session_id: 'sess_1',
    });

    // Left in place it would be double-counted: the same tokens are now in
    // the durable ledger row the card's total is read from.
    expect(sumLiveUsage(snapshot.liveUsage).inputTokens).toBe(0);
  });

  it('clears the live figure when a failed turn ends too', () => {
    let snapshot = deriveSessionUpdate(
      base(),
      assistantMessage('msg_1', 'evt_1'),
    );
    snapshot = deriveSessionUpdate(snapshot, {
      type: 'result',
      subtype: 'error_during_execution',
      uuid: 'res_1',
    });

    expect(sumLiveUsage(snapshot.liveUsage).inputTokens).toBe(0);
  });

  it('starts each new turn from zero', () => {
    const spent = deriveSessionUpdate(
      base(),
      assistantMessage('msg_1', 'evt_1'),
    );

    expect(
      sumLiveUsage(startTurnSnapshot(spent, 'run').liveUsage).inputTokens,
    ).toBe(0);
    expect(
      sumLiveUsage(startTurnSnapshot(spent, 'reply', 'again').liveUsage)
        .inputTokens,
    ).toBe(0);
  });
});

describe('sumLiveUsage', () => {
  it('totals an empty or absent map as zero', () => {
    const zero = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    };
    expect(sumLiveUsage({})).toEqual(zero);
    // Snapshots cached by a build that predates this field hydrate without
    // it; the cache is deliberately unvalidated, so undefined reaches here.
    expect(sumLiveUsage(undefined)).toEqual(zero);
  });
});
