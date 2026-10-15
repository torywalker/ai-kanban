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
 * The `prompt` a turn should be handed to the SDK.
 *
 * Text-only turns keep the literal string they have always used. That is
 * not cosmetic: the SDK branches on `typeof prompt === 'string'` to set its
 * internal `isSingleUserTurn` flag (verified in the installed
 * `sdk.mjs`), which is what closes the CLI's stdin once the first `result`
 * message arrives — i.e. what makes the turn end at all. The streamed form
 * below reaches the same end state by a different route (see
 * {@link singleUserMessageStream}), but there is no reason to take it when
 * there are no images.
 *
 * With images, the turn becomes one user message whose content is every
 * image block in attachment order followed by exactly one text block —
 * images first because the text almost always refers back to them
 * ("what's wrong with this screenshot?").
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
 * Wraps the one user message in the `AsyncIterable` the SDK's `query()`
 * actually accepts — its `prompt` is `string | AsyncIterable<
 * SDKUserMessage>`, never a bare message object.
 *
 * Ending the iterable after a single message is what keeps this a one-shot
 * turn: the SDK's `streamInput` writes the message and then calls
 * `endInput()` unconditionally once the iterable is exhausted, so the CLI's
 * stdin always closes and the output iterator always ends. Nothing here can
 * hang waiting for a second message that will never come.
 *
 * `hasBidirectionalNeeds()` (true whenever `canUseTool` is set, which
 * `buildSessionPermissionOptions` guarantees) only changes WHEN that close
 * happens: it defers it until the first `result` arrives, which is what
 * keeps the control channel open for tool-approval round trips mid-turn —
 * the same point at which a plain string prompt closes stdin. Losing
 * `canUseTool` would close stdin sooner, not leave the turn hanging; the
 * cost would be approvals, not liveness. `SessionPermissionOptions` types
 * `canUseTool` as required and `daemonPermissionConfig.test.ts` asserts the
 * exact option keys, so it cannot quietly go missing.
 */
export async function* singleUserMessageStream(
  message: SDKUserMessage,
): AsyncIterable<SDKUserMessage> {
  yield message;
}
