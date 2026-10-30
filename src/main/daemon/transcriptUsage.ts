import fs from 'fs';
import { estimateCostUSD, type RequestUsage } from '@shared/modelPricing';
import type { UsageEntry } from '@shared/usage';

interface TranscriptCursor {
  offset: number;
  recordedIds: Set<string>;
}

interface ParsedMessage {
  id: string;
  model: string;
  usage: RequestUsage;
  cacheCreation: number;
}

interface ModelSum {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  costUSD: number;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * `cache_creation` splits 5-minute and 1-hour writes. When that object is
 * absent the transcript only has a combined count, and the price table bills
 * the whole of it as a 5-minute write.
 */
function cacheWrites(usage: Record<string, unknown>): {
  write5m: number;
  write1h: number;
  creation: number;
} {
  const nested = usage.cache_creation;
  if (typeof nested === 'object' && nested !== null) {
    const creation = nested as Record<string, unknown>;
    const write5m = count(creation.ephemeral_5m_input_tokens);
    const write1h = count(creation.ephemeral_1h_input_tokens);
    return { write5m, write1h, creation: write5m + write1h };
  }
  const flat = count(usage.cache_creation_input_tokens);
  return { write5m: flat, write1h: 0, creation: flat };
}

function parseAssistant(line: string): ParsedMessage | null {
  if (!line) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  if (record.type !== 'assistant') return null;
  const { message } = record;
  if (typeof message !== 'object' || message === null) return null;
  const msg = message as Record<string, unknown>;
  if (typeof msg.id !== 'string' || !msg.id) return null;
  if (typeof msg.model !== 'string' || !msg.model) return null;
  if (msg.model === '<synthetic>') return null;
  const usageRaw = msg.usage;
  const usage =
    typeof usageRaw === 'object' && usageRaw !== null
      ? (usageRaw as Record<string, unknown>)
      : {};
  const writes = cacheWrites(usage);
  return {
    id: msg.id,
    model: msg.model,
    usage: {
      input: count(usage.input_tokens),
      output: count(usage.output_tokens),
      cacheRead: count(usage.cache_read_input_tokens),
      cacheWrite5m: writes.write5m,
      cacheWrite1h: writes.write1h,
    },
    cacheCreation: writes.creation,
  };
}

/**
 * Bytes after the last newline are a line the writer has not finished.
 * Consuming them would bill a partial JSON line and skip the real one once
 * the rest arrives, because the offset would already be past it.
 */
function readCompleteLines(
  transcriptPath: string,
  offset: number,
): { text: string; nextOffset: number } | null {
  let fd: number;
  try {
    fd = fs.openSync(transcriptPath, 'r');
  } catch {
    return null;
  }
  try {
    const { size } = fs.fstatSync(fd);
    if (size <= offset) return { text: '', nextOffset: offset };
    const buf = Buffer.alloc(size - offset);
    const read = fs.readSync(fd, buf, 0, buf.length, offset);
    const bytes = buf.subarray(0, read);
    const lastNewline = bytes.lastIndexOf(0x0a);
    if (lastNewline < 0) return { text: '', nextOffset: offset };
    const complete = bytes.subarray(0, lastNewline + 1);
    return {
      text: complete.toString('utf8'),
      nextOffset: offset + complete.length,
    };
  } finally {
    fs.closeSync(fd);
  }
}

function emptySum(): ModelSum {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUSD: 0 };
}

export interface TranscriptUsageReader {
  read: (
    cardId: string,
    transcriptPath: string,
    first: boolean,
    at: string,
  ) => UsageEntry[];
}

/**
 * Reads new assistant usage from one Claude CLI transcript. The cursor is
 * per path: a byte offset (so a re-read does not bill the same lines) and
 * the message ids already turned into ledger rows (a later line for an id
 * is a streamed duplicate, not new spend).
 */
export function createTranscriptUsageReader(): TranscriptUsageReader {
  const cursors = new Map<string, TranscriptCursor>();

  return {
    read(cardId, transcriptPath, first, at) {
      const cursor = cursors.get(transcriptPath) ?? {
        offset: 0,
        recordedIds: new Set<string>(),
      };
      cursors.set(transcriptPath, cursor);

      let chunk: { text: string; nextOffset: number } | null;
      try {
        chunk = readCompleteLines(transcriptPath, cursor.offset);
      } catch {
        return [];
      }
      if (!chunk) return [];
      cursor.offset = chunk.nextOffset;

      const byId = new Map<string, ParsedMessage>();
      const order: string[] = [];
      let lastId = '';
      chunk.text.split('\n').forEach((line) => {
        const parsed = parseAssistant(line);
        if (!parsed || cursor.recordedIds.has(parsed.id)) return;
        if (!byId.has(parsed.id)) order.push(parsed.id);
        byId.set(parsed.id, parsed);
        lastId = parsed.id;
      });
      order.forEach((id) => cursor.recordedIds.add(id));
      if (order.length === 0) return [];
      const sums = new Map<string, ModelSum>();
      const models: string[] = [];
      order.forEach((id) => {
        const message = byId.get(id);
        if (!message) return;
        const sum = sums.get(message.model) ?? emptySum();
        if (!sums.has(message.model)) models.push(message.model);
        sum.input += message.usage.input;
        sum.output += message.usage.output;
        sum.cacheRead += message.usage.cacheRead;
        sum.cacheCreation += message.cacheCreation;
        sum.costUSD += estimateCostUSD(message.model, message.usage);
        sums.set(message.model, sum);
      });

      return models
        .map((model) => {
          const sum = sums.get(model) ?? emptySum();
          return {
            cardId,
            turnId: `terminal:${lastId}`,
            at,
            model,
            canonicalModel: null,
            turnKind: first ? ('run' as const) : ('reply' as const),
            estimated: true,
            inputTokens: sum.input,
            outputTokens: sum.output,
            cacheReadInputTokens: sum.cacheRead,
            cacheCreationInputTokens: sum.cacheCreation,
            costUSD: sum.costUSD,
          };
        })
        .filter(
          (entry) =>
            entry.inputTokens > 0 ||
            entry.outputTokens > 0 ||
            entry.cacheReadInputTokens > 0 ||
            entry.cacheCreationInputTokens > 0 ||
            entry.costUSD > 0,
        );
    },
  };
}
