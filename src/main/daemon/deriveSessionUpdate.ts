import type {
  SessionSnapshot,
  ChecklistItem,
  TranscriptMessage,
  LiveTokenUsage,
} from '@shared/daemonProtocol';

export function createInitialSnapshot(cardId: string): SessionSnapshot {
  return {
    cardId,
    sessionId: null,
    status: 'working',
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
    liveUsage: {},
  };
}

/**
 * Records one API request's token usage against its `message.id`.
 *
 * Assignment, not accumulation: consecutive assistant messages for the same
 * request each restate that request's running usage, so adding them would
 * multiply one request's tokens by its number of content blocks. Storing the
 * latest value per id and summing across ids (`sumLiveUsage`) counts every
 * request exactly once.
 */
function foldLiveUsage(
  current: SessionSnapshot,
  messageId: string | undefined,
  usage: Record<string, unknown> | undefined,
): SessionSnapshot {
  if (!messageId || !usage) return current;
  const next: LiveTokenUsage = {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cacheReadInputTokens: count(usage.cache_read_input_tokens),
    cacheCreationInputTokens: count(usage.cache_creation_input_tokens),
  };
  const previous = current.liveUsage?.[messageId];
  // Every snapshot change is broadcast to every client and written to disk,
  // so an unchanged restatement must not manufacture a new object.
  if (
    previous &&
    previous.inputTokens === next.inputTokens &&
    previous.outputTokens === next.outputTokens &&
    previous.cacheReadInputTokens === next.cacheReadInputTokens &&
    previous.cacheCreationInputTokens === next.cacheCreationInputTokens
  ) {
    return current;
  }
  return { ...current, liveUsage: { ...current.liveUsage, [messageId]: next } };
}

/** A non-numeric token field becomes 0 rather than poisoning the tally with NaN. */
function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Each tool has a different "primary" input field worth surfacing in a
// one-line label; anything not listed here just shows the tool's name.
const LABEL_FIELD: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Bash: 'command',
};

function toolUseLabel(name: string, input: unknown): string {
  const field = LABEL_FIELD[name];
  const value =
    field && typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)[field]
      : undefined;
  return typeof value === 'string' ? `${name}: ${value}` : name;
}

/**
 * Folds one incoming SDK message into the current snapshot, returning a new
 * snapshot (never mutates its input — callers hold the previous snapshot in
 * a map and replace it, same immutable-update shape as the rest of this
 * app's stores).
 */
export function deriveSessionUpdate(
  current: SessionSnapshot,
  // Deliberately `unknown`-shaped rather than importing the SDK's own
  // message type here: this function's contract is "whatever the SDK
  // yields," and pinning an exact imported type would make this file (and
  // its test) depend on the SDK being installed to type-check at all.
  message: {
    type: string;
    subtype?: string;
    session_id?: string;
    // The wrapper message's own id, present on `assistant` messages. Per
    // the SDK's own doc comment on `SDKAssistantMessage`: "the CLI emits
    // one assistant message per completed content block, so several
    // consecutive assistant messages can share message.id and each
    // carries just that block" — this `uuid` (NOT `message.id`, which is
    // shared across the whole turn) is what's actually unique per event,
    // which text/thinking blocks need since — unlike `tool_use` — they
    // carry no id of their own to dedupe by.
    uuid?: string;
    // `message.id` identifies the API REQUEST, shared by every assistant
    // message the CLI emits for that request's content blocks; `usage` is
    // that request's running token count, restated (not incremented) on each
    // one. Raw Messages-API shape, hence snake_case here where the result
    // message's own `modelUsage` is camelCase.
    message?: {
      id?: string;
      content?: Array<Record<string, unknown>>;
      usage?: Record<string, unknown>;
    };
  },
): SessionSnapshot {
  if (message.type === 'system' && message.subtype === 'init') {
    return { ...current, sessionId: message.session_id ?? current.sessionId };
  }

  if (message.type === 'assistant') {
    // Folded in FIRST, and kept out of the early return below: a turn's
    // token spend has to keep climbing on screen even for an assistant
    // message this snapshot has nothing else to show for.
    const withUsage = foldLiveUsage(
      current,
      message.message?.id,
      message.message?.usage,
    );

    const blocks = message.message?.content ?? [];
    const toolUseBlocks = blocks.filter((block) => block.type === 'tool_use');
    const textBlocks = blocks.filter(
      (block) => block.type === 'text' || block.type === 'thinking',
    );
    if (toolUseBlocks.length === 0 && textBlocks.length === 0) return withUsage;

    // Shared counter: tool calls and assistant text interleave in one
    // chronological feed in the View dialog, so both need insertion-order
    // values drawn from the same sequence rather than two independently
    // numbered lists.
    let nextSeq = current.checklist.length + current.messages.length;

    const existingToolIds = new Set(current.checklist.map((item) => item.id));
    const newToolItems: ChecklistItem[] = toolUseBlocks
      .filter((block) => !existingToolIds.has(block.id as string))
      .map((block) => ({
        id: block.id as string,
        label: toolUseLabel(block.name as string, block.input),
        // A tool_use block means the agent has REQUESTED a tool, not that
        // it ran: it may still be awaiting the user's approval, and may end
        // up denied outright. Marking it done here put a permanent green
        // checkmark next to work that never happened. It flips to done only
        // when the matching successful tool_result arrives below.
        done: false,
        seq: nextSeq++,
      }));

    // Dedupe by the wrapper event, not by block: a resumed session
    // (`reply`'s `resume: sessionId`) can replay prior-turn messages before
    // continuing, the same reason `tool_use` blocks need dedup above.
    // Checking the first composite id this event would have produced tells
    // us whether THIS event was already folded in — a message is always
    // processed atomically (all its blocks or none), so index 0 having
    // landed means the rest did too.
    const alreadyProcessed =
      typeof message.uuid === 'string' &&
      current.messages.some((m) => m.id === `${message.uuid}:0`);
    const newMessages: TranscriptMessage[] =
      typeof message.uuid === 'string' && !alreadyProcessed
        ? textBlocks
            .map((block, index): TranscriptMessage | null => {
              const text =
                typeof block.text === 'string'
                  ? block.text
                  : typeof block.thinking === 'string'
                    ? block.thinking
                    : '';
              if (!text) return null;
              return {
                id: `${message.uuid}:${index}`,
                kind: block.type === 'thinking' ? 'thinking' : 'text',
                text,
                seq: nextSeq++,
              };
            })
            .filter((item): item is TranscriptMessage => item !== null)
        : [];

    if (newToolItems.length === 0 && newMessages.length === 0) return withUsage;
    return {
      ...withUsage,
      checklist:
        newToolItems.length > 0
          ? [...current.checklist, ...newToolItems]
          : current.checklist,
      messages:
        newMessages.length > 0
          ? [...current.messages, ...newMessages]
          : current.messages,
    };
  }

  // The SDK reports tool completion as a `user`-role message carrying
  // `tool_result` content blocks, correlated back to the request by
  // `tool_use_id`. This is the only signal that a requested tool actually
  // ran, so it is what marks a checklist item done.
  if (message.type === 'user') {
    const completedIds = new Set(
      (message.message?.content ?? [])
        .filter(
          (block) =>
            block.type === 'tool_result' &&
            // A denied (or failed) tool did not do its work, so the honest
            // representation is to leave the item unfinished rather than
            // claim it completed.
            block.is_error !== true &&
            typeof block.tool_use_id === 'string',
        )
        .map((block) => block.tool_use_id as string),
    );
    if (completedIds.size === 0) return current;

    let changed = false;
    const checklist = current.checklist.map((item) => {
      if (item.done || !completedIds.has(item.id)) return item;
      changed = true;
      return { ...item, done: true };
    });
    // Results for ids this snapshot never saw (or already marked done) must
    // not manufacture a new snapshot object — every snapshot change is
    // broadcast to every client.
    if (!changed) return current;
    return { ...current, checklist };
  }

  /**
   * A `result` message deliberately does NOT settle `status`.
   *
   * It reads like the end of the turn and it is not one: a single
   * `query()` call can yield several, and work keeps streaming in between
   * them. Reproduced live against this SDK/CLI by having the agent launch
   * a Task subagent in the background — the foreground turn finished and
   * emitted `result/success` ten seconds in, then the subagent's own
   * thinking, `Bash` calls and task-progress events kept arriving for
   * another twenty-five seconds, followed by a SECOND `result/success`,
   * and only then did the stream close. Nothing on a `result` distinguishes
   * "the last one" from "one of several" — no `parent_tool_use_id`, no
   * terminal flag — so treating any of them as terminal is what showed a
   * card as "Done" (chime and all) while its checklist was still filling
   * in underneath.
   *
   * The honest end-of-turn signal is the message stream itself ending,
   * which only `runTurn` can observe. It settles the status there via
   * `settleTurnSnapshot`. What a result IS good for is recorded here: the
   * session id, and dropping the live token tally, whose tokens have just
   * been written to the usage ledger by `runTurn` and would otherwise be
   * counted twice — once live, once from the ledger.
   */
  if (message.type === 'result') {
    return {
      ...current,
      sessionId: message.session_id ?? current.sessionId,
      liveUsage: {},
    };
  }

  return current;
}
