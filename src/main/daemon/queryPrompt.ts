import fs from 'fs/promises';
// See index.ts for why this type-only import needs a `resolution-mode`
// attribute: `@anthropic-ai/claude-agent-sdk` is ESM-only and this file
// compiles as CommonJS under this repo's `module: node16` tsconfig. Types
// only — nothing from the SDK is loaded at runtime by this module.
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import type { DaemonImage, TranscriptImageRef } from '@shared/daemonProtocol';

/**
 * Raised when an attachment's file cannot be read. Its own class, not a
 * bare `Error`, so `runTurn` can tell "the user's screenshot is gone" from
 * "the SDK blew up" — the first must fail the turn BEFORE any subprocess is
 * spawned or any tokens are spent.
 */
export class UnreadableImageError extends Error {
  constructor(filename: string) {
    super(`Could not read image ${filename}`);
    this.name = 'UnreadableImageError';
  }
}

/**
 * Strips the absolute path off the images a turn was given, leaving the
 * reference a user transcript entry may keep. `undefined` (never `[]`) for
 * a turn with no images, so the `images` key is simply absent on text-only
 * messages and old cached snapshots stay shape-identical.
 */
export function transcriptImagesFrom(
  images: DaemonImage[] | undefined,
): TranscriptImageRef[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map(({ filename, mimeType, cardId, id }) => ({
    filename,
    mimeType,
    cardId,
    id,
  }));
}

/**
 * The user message a turn should be handed to the SDK, before it is wrapped
 * in {@link createPromptGate}.
 *
 * Text-only turns used to be handed over as a bare string. That is not a
 * harmless shortcut: the SDK branches on `typeof prompt === 'string'` to set
 * its internal `isSingleUserTurn` flag (verified in the installed
 * `sdk.mjs`), and that flag closes the CLI's stdin at the first `result`.
 * A command the model put in the background dies with that process, which
 * is why a card could say it was "running in the background" and then never
 * resume. `runTurn` always streams, and closes the stream itself once
 * background work is actually finished.
 *
 * With images, the message content is every image block in attachment order
 * followed by exactly one text block — images first because the text almost
 * always refers back to them ("what's wrong with this screenshot?").
 *
 * Every file is read up front. The first unreadable one throws, so a turn
 * with a missing attachment never reaches `query()`: a half-sent prompt
 * silently missing one of three screenshots is worse than a failed turn
 * that names the file.
 */
export async function buildQueryPrompt(
  text: string,
  images: DaemonImage[] | undefined,
): Promise<string | SDKUserMessage> {
  if (!images || images.length === 0) return text;

  const imageBlocks = [];
  // Sequential on purpose: the error must name the FIRST failing
  // attachment in the user's own order, which a racing `Promise.all`
  // cannot promise.
  // eslint-disable-next-line no-restricted-syntax
  for (const image of images) {
    let data: string;
    try {
      // eslint-disable-next-line no-await-in-loop
      data = (await fs.readFile(image.path)).toString('base64');
    } catch {
      throw new UnreadableImageError(image.filename);
    }
    imageBlocks.push({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: image.mimeType,
        data,
      },
    });
  }

  // `parent_tool_use_id` and `session_id` are not decoration: the SDK
  // writes each streamed message straight to the CLI as one stream-json
  // line, and its own string-prompt path emits exactly these two fields
  // alongside the message (`session_id: ''`, resolved by the CLI itself).
  return {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    message: {
      role: 'user',
      content: [...imageBlocks, { type: 'text' as const, text }],
    },
  };
}

/**
 * The one user message as the `AsyncIterable` `query()` accepts — its
 * `prompt` is `string | AsyncIterable<SDKUserMessage>`, never a bare
 * message object.
 *
 * Yielding once and returning is the one-shot form: `streamInput` then
 * calls `endInput()`, and a background command dies with the process.
 * {@link createPromptGate} is what `runTurn` actually passes. This remains
 * for the case that genuinely wants that close.
 */
export async function* singleUserMessageStream(
  message: SDKUserMessage,
): AsyncIterable<SDKUserMessage> {
  yield message;
}

/** A text prompt in the same shape `buildQueryPrompt` uses for images. */
export function userMessageFromPrompt(
  prompt: string | SDKUserMessage,
): SDKUserMessage {
  if (typeof prompt !== 'string') return prompt;
  return {
    type: 'user',
    session_id: '',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  };
}

/**
 * An input stream that stays open after the first message.
 *
 * `streamInput` only calls `endInput()` once this iterable finishes. Holding
 * it open is what keeps the Claude process — and any command it backgrounded
 * — alive past the first `result`. `push` delivers a later message into the
 * same process (the "continue" nudge). `release` lets the iterable finish;
 * it is safe to call more than once, and drops anything still queued so a
 * stop does not send one last message into a process that is going away.
 */
export function createPromptGate(first: SDKUserMessage): {
  stream: AsyncIterable<SDKUserMessage>;
  push: (message: SDKUserMessage) => void;
  release: () => void;
} {
  const pending: SDKUserMessage[] = [first];
  let released = false;
  let wake: (() => void) | null = null;

  const stream: AsyncIterable<SDKUserMessage> = {
    async *[Symbol.asyncIterator]() {
      while (!released) {
        if (pending.length === 0) {
          // The assignment is the waiter for this one stream. It is not a
          // per-iteration callback racing a changing binding: `wake` is the
          // slot `push`/`release` fire, and only one next() is outstanding.
          // eslint-disable-next-line no-await-in-loop, no-loop-func
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        } else {
          const next = pending.shift();
          if (next) yield next;
        }
      }
    },
  };

  const resume = (): void => {
    const pendingWake = wake;
    wake = null;
    pendingWake?.();
  };

  return {
    stream,
    push(message) {
      if (released) return;
      pending.push(message);
      resume();
    },
    release() {
      if (released) return;
      released = true;
      pending.length = 0;
      resume();
    },
  };
}
