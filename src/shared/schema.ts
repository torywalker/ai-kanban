import { z } from 'zod';
import { AttachmentMetaSchema } from './attachments';
import { SessionWorktreeSchema } from './worktree';

export const CURRENT_VERSION = 1;

export const TagSchema = z.object({
  color: z.string(),
  // Display name shown in the UI. Falls back to the tag's key (its
  // normalized identity, e.g. "not-ready") whenever this is empty, which
  // covers both omission and pre-existing files written before labels
  // existed.
  label: z.string().catch(''),
});

export const PRIORITY_VALUES = ['low', 'medium', 'high', 'critical'] as const;
export const PrioritySchema = z.enum(PRIORITY_VALUES);
export type Priority = z.infer<typeof PrioritySchema>;

// Ten hand-picked hues, stored as names rather than hex so the same card
// can be tinted differently in light and dark mode (see globals.css) and so
// a card is never carrying a color that a future theme cannot render.
export const CARD_COLOR_VALUES = [
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'indigo',
  'violet',
  'pink',
  'slate',
] as const;
export const CardColorSchema = z.enum(CARD_COLOR_VALUES);
export type CardColor = z.infer<typeof CardColorSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  editedAt: z.string().optional(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CardSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  notes: z.string().catch(''),
  // The user's own timestamped status log for the card. `.catch([])` covers
  // files written before comments existed and any malformed value.
  comments: z.array(CommentSchema).catch([]),
  link: z.string().catch(''),
  variables: z.record(z.string(), z.string()).catch({}),
  copyCount: z.number().catch(0),
  lastCopiedAt: z.string().nullable().catch(null),
  // Optional by design — most prompts never get triaged.
  priority: PrioritySchema.nullable().catch(null),
  // Calendar date only ("YYYY-MM-DD"), not a timestamp: a due date is a day,
  // not a moment, so it is compared against the local calendar date rather
  // than parsed as an instant that would shift with the reader's timezone.
  dueDate: z.string().nullable().catch(null),
  // Purely visual, and optional: a color is how a card is made to stand out
  // in a crowded list, not a second priority axis. `.catch(null)` covers
  // both files written before colors existed and a color name added by a
  // newer build — either way the card opens, just untinted.
  color: CardColorSchema.nullable().catch(null),
  // All three are session-related, all optional/nullable — a card that has
  // never had a session looks exactly as it did before this feature.
  // sessionTool exists for forward compatibility with a future second
  // driver; today it is only ever 'claude' or null, and no UI offers any
  // other choice.
  sessionTool: z.enum(['claude']).nullable().catch(null),
  sessionRepo: z.string().nullable().catch(null),
  sessionId: z.string().nullable().catch(null),
  // Per-card override of the global default model (Settings). Unlike
  // `sessionRepo`/`defaultRepo`, the model's global home is app Settings,
  // not the Board, since a preferred model is more a personal/API-usage
  // choice than something naturally shared by every card on one board.
  sessionModel: z.string().nullable().catch(null),
  // Soft-delete: the card stays on disk (and in its list) so notes, session
  // history, and undo still have something to point at. Hidden from the
  // board unless the user asks to see archived cards. `.catch(false)` covers
  // files written before this field existed.
  archived: z.boolean().catch(false),
  // User-set "parked for now" flag on a card that has been run. Purely a
  // visual/UX marker (pause icon on the board, controls disabled); it does
  // not touch the underlying session. `.catch(false)` covers older files.
  paused: z.boolean().optional().catch(undefined),
  attachments: z.array(AttachmentMetaSchema).catch([]),
  // Per-card override of the global useWorktrees setting. Null means
  // "inherit from Settings".
  useWorktree: z.boolean().nullable().catch(null),
  // Per-card override of the global session engine. Null inherits Settings.
  // `.catch(null)` covers files written before this field and a value this
  // build does not know.
  sessionEngine: z.enum(['sdk', 'terminal']).nullable().catch(null),
  // Set when a session has created a git worktree for this card; null
  // until the first such session.
  sessionWorktree: SessionWorktreeSchema.nullable().catch(null),
  // Whether the most recently *started* run used a worktree, recorded at
  // the moment that run kicked off. Unlike `sessionWorktree`, this never
  // gets cleared when the worktree is later removed (e.g. after Ship), so
  // it answers "was a worktree used" even once none exists any more. Null
  // until a card's first run has started.
  usedWorktree: z.boolean().nullable().catch(null),
  // Recorded when Ship merges this card into a branch locally: the merged
  // commit and where it went. Build monitoring follows that commit onto the
  // remote, so it must outlive `sessionWorktree` (deleted after Ship).
  shipRecord: z
    .object({ sha: z.string(), targetBranch: z.string() })
    .optional()
    .catch(undefined),
  // ISO time of the last Ship that landed. Lives on the card, not on
  // `sessionWorktree`, because that is cleared when the worktree is deleted.
  lastShippedAt: z.string().optional().catch(undefined),
});

export const ListSchema = z.object({
  id: z.string(),
  name: z.string(),
  cards: z.array(CardSchema),
});

export const BoardTerminalSchema = z.object({
  id: z.string(),
  name: z.string(),
  // Last directory the tab's shell was seen in; restarts reopen it there.
  // `.catch(undefined)` covers files written before this field existed.
  cwd: z.string().optional().catch(undefined),
});

export const BoardSchema = z.object({
  id: z.string(),
  name: z.string(),
  lists: z.array(ListSchema),
  defaultRepo: z.string().nullable().catch(null),
  // Soft-hide: the board stays in the file so its lists, cards, and undo
  // history are still there. Hidden from the sidebar and the board view
  // until it is unarchived from Settings. `.catch(false)` covers files
  // written before this field existed.
  archived: z.boolean().catch(false),
  // Free-form notes for this board only. `.catch('')` keeps files written
  // before scratchpads existed opening with an empty pad.
  scratchpad: z.string().catch(''),
  // General-terminal tabs for this board. `.catch([])` covers files written
  // before they existed.
  terminals: z.array(BoardTerminalSchema).catch([]),
  // Per-board override of the prompt Ship gives the agent to resolve merge
  // conflicts. Absent means the built-in SHIP_CONFLICT_PROMPT.
  shipConflictPrompt: z.string().optional().catch(undefined),
});

export const KanbanDocSchema = z.object({
  version: z.number(),
  tags: z.record(z.string(), TagSchema),
  boards: z.array(BoardSchema),
});

export type Tag = z.infer<typeof TagSchema>;
export type Card = z.infer<typeof CardSchema>;
export type List = z.infer<typeof ListSchema>;
export type BoardTerminal = z.infer<typeof BoardTerminalSchema>;
export type Board = z.infer<typeof BoardSchema>;
export type KanbanDoc = z.infer<typeof KanbanDocSchema>;

export type ParseResult =
  | { ok: true; doc: KanbanDoc }
  | { ok: false; error: string };

/**
 * Validates an already-JSON-parsed value against the document schema.
 *
 * A version higher than this build understands is refused rather than
 * coerced: silently rewriting a newer file into an older shape would
 * destroy fields this build does not know about.
 */
export function parseDoc(raw: unknown): ParseResult {
  const versionCheck = z.object({ version: z.number() }).safeParse(raw);

  if (versionCheck.success && versionCheck.data.version > CURRENT_VERSION) {
    return {
      ok: false,
      error:
        `This file uses format version ${versionCheck.data.version}, but ` +
        `this version of AI Kanban only understands version ` +
        `${CURRENT_VERSION}. Update the app to open it.`,
    };
  }

  const result = KanbanDocSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.join('.') || '(root)';
    return { ok: false, error: `${path}: ${first.message}` };
  }

  return { ok: true, doc: dropDuplicateCards(result.data) };
}

/**
 * Card IDs must be unique across the document: drag-and-drop and React both
 * key cards by ID, so a repeated ID breaks the board mid-drag. When a file
 * already carries duplicates, one copy per ID survives — the first live
 * copy, or the first copy if every copy is archived.
 */
function dropDuplicateCards(doc: KanbanDoc): KanbanDoc {
  const allCards = doc.boards.flatMap((board) =>
    board.lists.flatMap((list) => list.cards),
  );
  const keep = new Map<string, Card>();
  allCards.forEach((card) => {
    const kept = keep.get(card.id);
    if (!kept || (kept.archived && !card.archived)) keep.set(card.id, card);
  });
  if (keep.size === allCards.length) return doc;

  doc.boards.forEach((board) => {
    board.lists.forEach((list) => {
      list.cards = list.cards.filter((card) => keep.get(card.id) === card);
    });
  });
  return doc;
}

export function serializeDoc(doc: KanbanDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
