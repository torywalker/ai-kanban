import type { AttachmentMeta } from './attachments';
import type { IpcResult } from './ipc';
import type { Card, CardColor, KanbanDoc, Priority } from './schema';
import type { SlashSnippet } from './slashSnippets';
import { nextTagColor, normalizeTagName } from '../renderer/domain/tags';

/** System-wide. Command+N is "New" in almost every other app. Alt is Option on a Mac. */
export const QUICK_ADD_ACCELERATOR = 'CommandOrControl+Alt+N';

export interface QuickAddBoardChoice {
  id: string;
  name: string;
  /** The column a new card lands in: the board's first list. */
  listId: string;
}

export interface QuickAddCardFields {
  id?: string;
  title: string;
  prompt: string;
  attachments?: AttachmentMeta[];
  tags?: string[];
  notes?: string;
  link?: string;
  priority?: Priority | null;
  color?: CardColor | null;
  dueDate?: string | null;
  sessionRepo?: string | null;
  sessionModel?: string | null;
  useWorktree?: boolean | null;
}

export interface QuickAddContextValue {
  doc: KanbanDoc;
  activeBoardId: string | null;
  defaultModel: string | null;
  useWorktrees: boolean;
  slashSnippets: SlashSnippet[];
}

export interface QuickAddCommitRequest {
  boardId: string;
  listId: string;
  fields: QuickAddCardFields;
}

export interface QuickAddAsk {
  requestId: string;
  kind: 'context' | 'commit';
  commit?: QuickAddCommitRequest;
}

export interface QuickAddReply {
  requestId: string;
  result: IpcResult<QuickAddContextValue | null>;
}

export interface QuickAddWindowOptions {
  alwaysOnTop: true;
  alwaysOnTopLevel: 'floating';
  fullscreenable: false;
  skipTaskbar: true;
  minimizable: false;
  maximizable: false;
  show: false;
  /** macOS panel so the window can float. Never parented to the main window. */
  type: 'panel' | undefined;
  parent: null;
}

/**
 * Boards a quick-add card can land on. Archived boards and boards with no
 * column are skipped. The list is the board's first column, matching Cmd+N.
 */
export function quickAddBoards(doc: KanbanDoc): QuickAddBoardChoice[] {
  return doc.boards.flatMap((board) => {
    const list = board.lists[0];
    if (board.archived || !list) return [];
    return [{ id: board.id, name: board.name, listId: list.id }];
  });
}

export function defaultQuickAddBoardId(
  boards: QuickAddBoardChoice[],
  activeBoardId: string | null,
): string | null {
  if (activeBoardId && boards.some((board) => board.id === activeBoardId)) {
    return activeBoardId;
  }
  return boards[0]?.id ?? null;
}

export type InsertNewCardResult =
  | { ok: true; doc: KanbanDoc; id: string }
  | { ok: false; error: string };

/**
 * Adds a card without touching the input document. Used when the main window
 * is closed and the quick-add panel has to write the file itself. Tag
 * registration matches `addCard` in the renderer store.
 */
export function insertNewCard(
  doc: KanbanDoc,
  boardId: string,
  listId: string,
  fields: QuickAddCardFields,
  now: string,
): InsertNewCardResult {
  const next = JSON.parse(JSON.stringify(doc)) as KanbanDoc;
  const list = next.boards
    .find((board) => board.id === boardId)
    ?.lists.find((candidate) => candidate.id === listId);
  if (!list) {
    return { ok: false, error: 'That board no longer has a column.' };
  }
  const id = fields.id ?? `crd_${now}`;
  const idTaken = next.boards.some((board) =>
    board.lists.some((candidate) => candidate.cards.some((c) => c.id === id)),
  );
  if (idTaken) {
    return { ok: false, error: 'A card with that ID already exists.' };
  }
  const normalizedTags = Array.from(
    new Set((fields.tags ?? []).map(normalizeTagName).filter(Boolean)),
  );
  normalizedTags.forEach((name) => {
    if (!next.tags[name]) {
      next.tags[name] = { color: nextTagColor(next), label: name };
    }
  });
  const card: Card = {
    id,
    title: fields.title.trim() || 'Untitled prompt',
    prompt: fields.prompt,
    tags: normalizedTags,
    notes: fields.notes ?? '',
    link: fields.link ?? '',
    priority: fields.priority ?? null,
    color: fields.color ?? null,
    dueDate: fields.dueDate ?? null,
    sessionRepo: fields.sessionRepo ?? null,
    sessionModel: fields.sessionModel ?? null,
    sessionTool: null,
    sessionId: null,
    useWorktree: fields.useWorktree ?? null,
    sessionWorktree: null,
    usedWorktree: null,
    archived: false,
    attachments: fields.attachments ?? [],
    variables: {},
    copyCount: 0,
    lastCopiedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  list.cards.push(card);
  return { ok: true, doc: next, id };
}

export function quickAddWindowOptions(platform: string): QuickAddWindowOptions {
  return {
    alwaysOnTop: true,
    alwaysOnTopLevel: 'floating',
    fullscreenable: false,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    show: false,
    type: platform === 'darwin' ? 'panel' : undefined,
    parent: null,
  };
}
