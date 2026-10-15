export interface SlashSnippet {
  id: string;
  /** Command name without the leading slash, stored lowercase. */
  trigger: string;
  expansion: string;
}

export interface SlashQuery {
  /** Index of the leading slash. */
  start: number;
  /** Caret/index immediately after the typed command fragment. */
  end: number;
  query: string;
}

const TRIGGER_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isTriggerChar(char: string): boolean {
  return /[a-z0-9_-]/i.test(char);
}

/**
 * Accepts `grill-me` or `/grill-me` and returns the stored trigger.
 * Anything with spaces or other punctuation is rejected.
 */
export function normalizeTrigger(raw: string): string | null {
  const trigger = raw.trim().replace(/^\//, '').toLowerCase();
  if (!TRIGGER_PATTERN.test(trigger)) return null;
  return trigger;
}

export function sanitizeSlashSnippets(value: unknown): SlashSnippet[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const snippets: SlashSnippet[] = [];
  value.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as {
      id?: unknown;
      trigger?: unknown;
      expansion?: unknown;
    };
    const trigger = normalizeTrigger(
      typeof record.trigger === 'string' ? record.trigger : '',
    );
    const expansion =
      typeof record.expansion === 'string' ? record.expansion : '';
    const id = typeof record.id === 'string' ? record.id : '';
    if (!trigger || !expansion.trim() || !id || seen.has(trigger)) return;
    seen.add(trigger);
    snippets.push({ id, trigger, expansion });
  });
  return snippets;
}

/**
 * The slash-command fragment immediately before the caret. An empty query
 * is intentional: typing `/` is when the full suggestion list should open.
 */
export function slashQueryAtCaret(
  text: string,
  caret: number,
): SlashQuery | null {
  if (caret < 1 || caret > text.length) return null;
  let start = caret;
  while (start > 0 && isTriggerChar(text[start - 1])) start -= 1;
  if (text[start - 1] !== '/') return null;
  const slash = start - 1;
  if (slash > 0 && !/\s/.test(text[slash - 1])) return null;
  return {
    start: slash,
    end: caret,
    query: text.slice(start, caret).toLowerCase(),
  };
}

/** Replaces a partial slash query selected from the suggestion list. */
export function applySlashSnippet(
  text: string,
  query: SlashQuery,
  snippet: SlashSnippet,
): { text: string; caret: number } {
  const next =
    text.slice(0, query.start) + snippet.expansion + text.slice(query.end);
  return {
    text: next,
    caret: query.start + snippet.expansion.length,
  };
}

/**
 * Replaces a slash command that ends at the caret.
 *
 * The command expands on the keystroke that finishes it. A name expands as
 * soon as it matches and no saved command is longer (`/grill-me`). A shorter
 * name that is also the start of a longer one waits for a space or other
 * break (`/grill` stays put while `/grill-me` exists, and `/grill ` expands).
 * The slash has to start the text or follow whitespace, so `https://` is left
 * alone.
 */
export function expandSlashAtCaret(
  text: string,
  caret: number,
  snippets: SlashSnippet[],
): { text: string; caret: number } | null {
  if (caret < 2 || snippets.length === 0) return null;

  let end = caret;
  let boundary = '';
  const last = text[end - 1];
  if (!isTriggerChar(last)) {
    if (end < 3 || !isTriggerChar(text[end - 2])) return null;
    boundary = last;
    end -= 1;
  }

  let start = end;
  while (start > 0 && isTriggerChar(text[start - 1])) start -= 1;
  if (start === end || text[start - 1] !== '/') return null;
  const slash = start - 1;
  if (slash > 0 && !/\s/.test(text[slash - 1])) return null;

  const trigger = text.slice(start, end).toLowerCase();
  const match = snippets.find((snippet) => snippet.trigger === trigger);
  if (!match) return null;
  const hasLonger = snippets.some(
    (snippet) =>
      snippet.trigger !== trigger && snippet.trigger.startsWith(trigger),
  );
  if (hasLonger && !boundary) return null;

  const next = text.slice(0, slash) + match.expansion + text.slice(end);
  if (next === text) return null;
  return {
    text: next,
    caret: slash + match.expansion.length + boundary.length,
  };
}
