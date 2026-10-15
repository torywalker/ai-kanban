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

export const CardSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  notes: z.string().catch(''),
  link: z.string().catch(''),
  variables: z.record(z.string(), z.string()).catch({}),
  copyCount: z.number().catch(0),
  lastCopiedAt: z.string().nullable().catch(null),
  // Optional by design — most prompts never get triaged.
  priority: PrioritySchema.nullable().catch(null),
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
  attachments: z.array(AttachmentMetaSchema).catch([]),
  // Per-card override of the global useWorktrees setting. Null means
  // "inherit from Settings".
  useWorktree: z.boolean().nullable().catch(null),
  // Set when a session has created a git worktree for this card; null
  // until the first such session.
  sessionWorktree: SessionWorktreeSchema.nullable().catch(null),
});

export const ListSchema = z.object({
  id: z.string(),
  name: z.string(),
  cards: z.array(CardSchema),
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
});

export const KanbanDocSchema = z.object({
  version: z.number(),
  tags: z.record(z.string(), TagSchema),
  boards: z.array(BoardSchema),
});

export type Tag = z.infer<typeof TagSchema>;
export type Card = z.infer<typeof CardSchema>;
export type List = z.infer<typeof ListSchema>;
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

  return { ok: true, doc: result.data };
}

export function serializeDoc(doc: KanbanDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
