/**
 * Claude CLI transcripts are JSONL with no costUSD. Streamed content blocks
 * repeat a message id; the last line for that id is the one that carries the
 * finished usage. An incomplete trailing line is a write still in progress.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { UsageEntrySchema } from '../shared/usage';
import { createTranscriptUsageReader } from '../main/daemon/transcriptUsage';

const AT = '2026-10-30T12:00:00.000Z';

function assistantLine(
  id: string,
  model: string,
  usage: Record<string, unknown>,
): string {
  return JSON.stringify({ type: 'assistant', message: { id, model, usage } });
}

describe('createTranscriptUsageReader', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-usage-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the last line per id and emits one row per model', () => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      file,
      `${[
        JSON.stringify({ type: 'user', message: { content: 'hi' } }),
        assistantLine('msg_a', 'claude-sonnet-5', {
          input_tokens: 1,
          output_tokens: 10,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
        assistantLine('msg_a', 'claude-sonnet-5', {
          input_tokens: 4,
          output_tokens: 20,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 0,
        }),
        assistantLine('msg_b', 'claude-sonnet-5', {
          input_tokens: 3,
          output_tokens: 7,
          cache_read_input_tokens: 1,
          cache_creation_input_tokens: 0,
        }),
        assistantLine('msg_c', 'claude-haiku-4-5', {
          input_tokens: 8,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
      ].join('\n')}\n`,
    );

    const rows = createTranscriptUsageReader().read('crd_1', file, true, AT);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      cardId: 'crd_1',
      turnId: 'terminal:msg_c',
      at: AT,
      model: 'claude-sonnet-5',
      canonicalModel: null,
      turnKind: 'run',
      estimated: true,
      inputTokens: 7,
      outputTokens: 27,
      cacheReadInputTokens: 3,
      cacheCreationInputTokens: 0,
    });
    expect(rows[1]).toMatchObject({
      cardId: 'crd_1',
      turnId: 'terminal:msg_c',
      model: 'claude-haiku-4-5',
      canonicalModel: null,
      turnKind: 'run',
      estimated: true,
      outputTokens: 1,
    });
  });

  it('uses the id of the last fresh line as the batch turn id', () => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      file,
      `${[
        assistantLine('msg_a', 'claude-sonnet-5', {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
        assistantLine('msg_b', 'claude-sonnet-5', {
          input_tokens: 1,
          output_tokens: 2,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
        assistantLine('msg_a', 'claude-sonnet-5', {
          input_tokens: 1,
          output_tokens: 3,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
      ].join('\n')}\n`,
    );

    const [row] = createTranscriptUsageReader().read('crd_1', file, true, AT);
    expect(row.turnId).toBe('terminal:msg_a');
    expect(row.outputTokens).toBe(5);
  });

  it('prices split cache writes when cache_creation is present, otherwise all creation as 5-minute writes', () => {
    const splitFile = path.join(dir, 'split.jsonl');
    const flatFile = path.join(dir, 'flat.jsonl');
    fs.writeFileSync(
      splitFile,
      `${assistantLine('msg_a', 'claude-sonnet-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 99,
        cache_creation: {
          ephemeral_5m_input_tokens: 3,
          ephemeral_1h_input_tokens: 4,
        },
      })}\n`,
    );
    fs.writeFileSync(
      flatFile,
      `${assistantLine('msg_a', 'claude-sonnet-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 7,
      })}\n`,
    );

    const reader = createTranscriptUsageReader();
    const split = reader.read('crd_1', splitFile, true, AT)[0];
    const flat = reader.read('crd_1', flatFile, true, AT)[0];

    // claude-sonnet-5: 5m write $2.5 / MTok, 1h write $4 / MTok.
    expect(split.cacheCreationInputTokens).toBe(7);
    expect(flat.cacheCreationInputTokens).toBe(7);
    expect(split.costUSD).toBeCloseTo((3 * 2.5 + 4 * 4) / 1e6, 10);
    expect(flat.costUSD).toBeCloseTo((7 * 2.5) / 1e6, 10);
  });

  it('skips a second read of the same bytes and an already-recorded id, and marks a later id as a reply', () => {
    const file = path.join(dir, 'session.jsonl');
    const firstLine = `${assistantLine('msg_a', 'claude-sonnet-5', {
      input_tokens: 1,
      output_tokens: 4,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })}\n`;
    fs.writeFileSync(file, firstLine);
    const reader = createTranscriptUsageReader();

    expect(reader.read('crd_1', file, true, AT)).toHaveLength(1);
    expect(reader.read('crd_1', file, false, AT)).toEqual([]);

    fs.appendFileSync(
      file,
      `${assistantLine('msg_a', 'claude-sonnet-5', {
        input_tokens: 1,
        output_tokens: 9,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      })}\n`,
    );
    expect(reader.read('crd_1', file, false, AT)).toEqual([]);

    fs.appendFileSync(
      file,
      `${assistantLine('msg_c', 'claude-haiku-4-5', {
        input_tokens: 1,
        output_tokens: 3,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      })}\n`,
    );
    const rows = reader.read('crd_1', file, false, AT);
    expect(rows).toEqual([
      expect.objectContaining({
        turnId: 'terminal:msg_c',
        turnKind: 'reply',
        model: 'claude-haiku-4-5',
        outputTokens: 3,
        estimated: true,
      }),
    ]);
  });

  it('returns nothing for a synthetic model or a missing file', () => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      file,
      `${assistantLine('msg_a', '<synthetic>', {
        input_tokens: 5,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      })}\n`,
    );
    const reader = createTranscriptUsageReader();
    expect(reader.read('crd_1', file, true, AT)).toEqual([]);
    expect(
      reader.read('crd_1', path.join(dir, 'missing.jsonl'), true, AT),
    ).toEqual([]);
  });

  it('does not consume an incomplete trailing line', () => {
    const file = path.join(dir, 'session.jsonl');
    const complete = `${assistantLine('msg_a', 'claude-sonnet-5', {
      input_tokens: 1,
      output_tokens: 2,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    })}\n`;
    const partial = assistantLine('msg_b', 'claude-sonnet-5', {
      input_tokens: 1,
      output_tokens: 8,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    fs.writeFileSync(file, complete + partial);
    const reader = createTranscriptUsageReader();

    const first = reader.read('crd_1', file, true, AT);
    expect(first.map((row) => row.outputTokens)).toEqual([2]);
    expect(reader.read('crd_1', file, false, AT)).toEqual([]);

    fs.appendFileSync(file, '\n');
    const second = reader.read('crd_1', file, false, AT);
    expect(second).toEqual([
      expect.objectContaining({
        turnId: 'terminal:msg_b',
        turnKind: 'reply',
        outputTokens: 8,
      }),
    ]);
  });

  it('skips a malformed line instead of throwing', () => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      file,
      `not-json\n${assistantLine('msg_a', 'claude-sonnet-5', {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      })}\n`,
    );
    expect(
      createTranscriptUsageReader()
        .read('crd_1', file, true, AT)
        .map((row) => row.outputTokens),
    ).toEqual([2]);
  });

  it('chooses the Haiku 5.5 tier per message, not on the summed prompt', () => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      file,
      `${[
        assistantLine('msg_short', 'claude-haiku-5-5', {
          input_tokens: 100_000,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
        assistantLine('msg_long', 'claude-haiku-5-5', {
          input_tokens: 100_001,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        }),
      ].join('\n')}\n`,
    );

    const [row] = createTranscriptUsageReader().read('crd_1', file, true, AT);
    // Short tier $0.1 and long tier $0.5 per MTok, each on its own request.
    const perRequest = (100_000 * 0.1) / 1e6 + (100_001 * 0.5) / 1e6;
    expect(row.inputTokens).toBe(200_001);
    expect(row.costUSD).toBeCloseTo(perRequest, 10);
  });

  it('bills only messages appended after prime', () => {
    const file = path.join(dir, 'session.jsonl');
    const usage = {
      input_tokens: 1,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    fs.writeFileSync(
      file,
      `${[
        assistantLine('msg_old_1', 'claude-sonnet-5', {
          ...usage,
          output_tokens: 10,
        }),
        assistantLine('msg_old_2', 'claude-sonnet-5', {
          ...usage,
          output_tokens: 20,
        }),
      ].join('\n')}\n`,
    );
    const reader = createTranscriptUsageReader();
    reader.prime(file);
    fs.appendFileSync(
      file,
      `${assistantLine('msg_new', 'claude-sonnet-5', {
        ...usage,
        output_tokens: 3,
      })}\n`,
    );

    const rows = reader.read('crd_1', file, true, AT);
    expect(rows).toEqual([
      expect.objectContaining({
        turnId: 'terminal:msg_new',
        outputTokens: 3,
        estimated: true,
      }),
    ]);
  });

  it('primes a missing file at offset 0 without throwing', () => {
    const file = path.join(dir, 'missing.jsonl');
    const reader = createTranscriptUsageReader();
    expect(() => reader.prime(file)).not.toThrow();
    fs.writeFileSync(
      file,
      `${assistantLine('msg_a', 'claude-sonnet-5', {
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      })}\n`,
    );
    expect(reader.read('crd_1', file, true, AT)).toEqual([
      expect.objectContaining({ turnId: 'terminal:msg_a', outputTokens: 2 }),
    ]);
  });

  it('records an unknown model with its tokens and a zero cost', () => {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(
      file,
      `${assistantLine('msg_a', 'gpt-x', {
        input_tokens: 4,
        output_tokens: 6,
        cache_read_input_tokens: 1,
        cache_creation_input_tokens: 2,
      })}\n`,
    );
    expect(createTranscriptUsageReader().read('crd_1', file, true, AT)).toEqual(
      [
        expect.objectContaining({
          model: 'gpt-x',
          inputTokens: 4,
          outputTokens: 6,
          cacheReadInputTokens: 1,
          cacheCreationInputTokens: 2,
          costUSD: 0,
          estimated: true,
          canonicalModel: null,
        }),
      ],
    );
  });
});

describe('UsageEntrySchema estimated', () => {
  const row = {
    cardId: 'crd_1',
    turnId: 'res_1',
    at: AT,
    model: 'claude-opus-5',
    canonicalModel: 'claude-opus-5',
    turnKind: 'run' as const,
    inputTokens: 1,
    outputTokens: 1,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUSD: 0.01,
  };

  it('accepts a ledger row that omits estimated', () => {
    expect(UsageEntrySchema.parse(row).estimated).toBeUndefined();
  });

  it('keeps estimated when a terminal row sets it', () => {
    expect(UsageEntrySchema.parse({ ...row, estimated: true }).estimated).toBe(
      true,
    );
  });
});
