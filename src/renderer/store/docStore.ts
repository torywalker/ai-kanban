import { create } from 'zustand';
import { produce } from 'immer';
import type { DropResult } from '@hello-pangea/dnd';
import {
  parseDoc,
  serializeDoc,
  type Card,
  type CardColor,
  type KanbanDoc,
  type Priority,
} from '@shared/schema';
import type { ApprovalMode } from '@shared/daemonProtocol';
import type { AttachmentMeta } from '@shared/attachments';
import { normalizeTrigger, type SlashSnippet } from '@shared/slashSnippets';
import { api } from '@/lib/api';
import { createSeedDoc } from '@/domain/seed';
import { newId } from '@/domain/ids';
import { applyDragEnd, type DragOptions } from '@/domain/dragEnd';
import { moveCardToBoard as moveCardToBoardDomain } from '@/domain/moveCard';
import { normalizeTagName, nextTagColor } from '@/domain/tags';

export type LoadStatus =
  | { kind: 'loading' }
  | { kind: 'welcome' }
  | { kind: 'error'; message: string; file: string }
  | { kind: 'ready' };

export interface NewCardFields {
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

const MAX_HISTORY = 50;

function parseSlashSnippet(
  triggerRaw: string,
  expansionRaw: string,
):
  | { ok: true; trigger: string; expansion: string }
  | { ok: false; error: string } {
  const trigger = normalizeTrigger(triggerRaw);
  const expansion = expansionRaw.trim();
  if (!trigger) {
    return {
      ok: false,
      error: 'Use a name like grill-me: letters, numbers, and hyphens.',
    };
  }
  if (!expansion) {
    return { ok: false, error: 'Write the text this command expands to.' };
  }
  return { ok: true, trigger, expansion };
}

function newSnippetId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `snp_${suffix}`;
}

/**
 * Scratchpad text is document data, but it is not an undo checkpoint.
 * Restoring an older snapshot would otherwise throw away notes typed after
 * that snapshot was taken.
 */
function withLiveScratchpads(restored: KanbanDoc, live: KanbanDoc): KanbanDoc {
  const pads = new Map(
    live.boards.map((board) => [board.id, board.scratchpad]),
  );
  let changed = false;
  const boards = restored.boards.map((board) => {
    const scratchpad = pads.get(board.id);
    if (scratchpad === undefined || scratchpad === board.scratchpad)
      return board;
    changed = true;
    return { ...board, scratchpad };
  });
  return changed ? { ...restored, boards } : restored;
}

/** The first board still shown in the sidebar, skipping archived ones. */
function firstVisibleBoardId(
  boards: { id: string; archived: boolean }[],
): string | null {
  return boards.find((board) => !board.archived)?.id ?? null;
}

interface DocStore {
  status: LoadStatus;
  doc: KanbanDoc | null;
  filePath: string | null;
  activeBoardId: string | null;
  savedSnapshot: string | null;
  past: KanbanDoc[];
  future: KanbanDoc[];
  canUndo: boolean;
  canRedo: boolean;
  approvalMode: ApprovalMode;
  defaultModel: string | null;
  useWorktrees: boolean;
  soundEnabled: boolean;
  sidebarCollapsed: boolean;
  slashSnippets: SlashSnippet[];

  bootstrap: () => Promise<void>;
  createAt: (file: string) => Promise<void>;
  openAt: (file: string) => Promise<void>;
  reload: () => Promise<void>;
  setActiveBoard: (boardId: string) => void;
  setFilePath: (file: string) => void;
  commit: (next: KanbanDoc) => void;
  mutate: (recipe: (draft: KanbanDoc) => void) => void;
  applyDrag: (result: DropResult, options?: DragOptions) => void;
  undo: () => void;
  redo: () => void;
  addBoard: (name: string) => string;
  renameBoard: (boardId: string, name: string) => void;
  deleteBoard: (boardId: string) => void;
  archiveBoard: (boardId: string) => void;
  unarchiveBoard: (boardId: string) => void;
  addList: (boardId: string, name: string) => string;
  renameList: (boardId: string, listId: string, name: string) => void;
  moveList: (boardId: string, listId: string, toIndex: number) => void;
  deleteList: (boardId: string, listId: string) => void;
  addCard: (boardId: string, listId: string, fields: NewCardFields) => string;
  updateCard: (
    boardId: string,
    listId: string,
    cardId: string,
    patch: Partial<Card>,
  ) => void;
  deleteCard: (boardId: string, listId: string, cardId: string) => void;
  moveCardToBoard: (
    fromBoardId: string,
    fromListId: string,
    cardId: string,
    toBoardId: string,
    toListId: string,
  ) => void;
  archiveCard: (boardId: string, listId: string, cardId: string) => void;
  unarchiveCard: (boardId: string, listId: string, cardId: string) => void;
  archiveAllCardsInList: (boardId: string, listId: string) => void;
  recordCopy: (boardId: string, listId: string, cardId: string) => void;
  setCardSessionRepo: (
    boardId: string,
    listId: string,
    cardId: string,
    repo: string | null,
  ) => void;
  setCardSessionId: (
    boardId: string,
    listId: string,
    cardId: string,
    sessionId: string | null,
  ) => void;
  setCardSessionModel: (
    boardId: string,
    listId: string,
    cardId: string,
    model: string | null,
  ) => void;
  setBoardDefaultRepo: (boardId: string, repo: string | null) => void;
  setBoardScratchpad: (boardId: string, text: string) => void;
  setApprovalMode: (mode: ApprovalMode) => void;
  setDefaultModel: (model: string | null) => void;
  setUseWorktrees: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  addSlashSnippet: (
    trigger: string,
    expansion: string,
  ) => { ok: true } | { ok: false; error: string };
  updateSlashSnippet: (
    id: string,
    trigger: string,
    expansion: string,
  ) => { ok: true } | { ok: false; error: string };
  deleteSlashSnippet: (id: string) => void;
  ensureTag: (name: string) => string;
  setCardTags: (
    boardId: string,
    listId: string,
    cardId: string,
    tags: string[],
  ) => void;
  renameTag: (from: string, to: string) => void;
  deleteTag: (name: string) => void;
  setTagLabel: (key: string, label: string) => void;
  setTagColor: (key: string, color: string) => void;
}

export const useDocStore = create<DocStore>((set, get) => ({
  status: { kind: 'loading' },
  doc: null,
  filePath: null,
  activeBoardId: null,
  savedSnapshot: null,
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,
  approvalMode: 'ask',
  defaultModel: null,
  useWorktrees: false,
  soundEnabled: true,
  sidebarCollapsed: false,
  slashSnippets: [],

  /**
   * Decides the opening screen. No stored path, or a stored path whose file
   * has vanished, both mean the welcome screen.
   */
  bootstrap: async () => {
    const settings = await api.settings.read();
    set({
      approvalMode: settings.approvalMode,
      defaultModel: settings.defaultModel,
      useWorktrees: settings.useWorktrees,
      soundEnabled: settings.soundEnabled,
      sidebarCollapsed: settings.sidebarCollapsed,
      slashSnippets: settings.slashSnippets ?? [],
    });
    if (!settings.dataFilePath) {
      set({ status: { kind: 'welcome' } });
      return;
    }
    await get().openAt(settings.dataFilePath);
    const doc = get().doc;
    if (!doc || get().status.kind !== 'ready') return;
    // A saved selection that points at an archived (or deleted) board would
    // reopen onto something the sidebar no longer shows. Fall back to the
    // first board that is still visible.
    const preferred = doc.boards.find(
      (b) => b.id === settings.activeBoardId && !b.archived,
    );
    const next = preferred?.id ?? firstVisibleBoardId(doc.boards);
    set({ activeBoardId: next });
    if (settings.activeBoardId && settings.activeBoardId !== next) {
      void api.settings.write({ activeBoardId: next });
    }
  },

  createAt: async (file) => {
    const doc = createSeedDoc();
    const written = await api.data.write(file, serializeDoc(doc));
    if (!written.ok) {
      set({ status: { kind: 'error', message: written.error, file } });
      return;
    }
    const activeBoardId = firstVisibleBoardId(doc.boards);
    await api.settings.write({
      dataFilePath: file,
      activeBoardId,
    });
    set({
      doc,
      filePath: file,
      activeBoardId,
      savedSnapshot: serializeDoc(doc),
      status: { kind: 'ready' },
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    });
  },

  openAt: async (file) => {
    set({ status: { kind: 'loading' } });
    const read = await api.data.read(file);

    if (!read.ok) {
      set({ status: { kind: 'error', message: read.error, file } });
      return;
    }

    // A configured path pointing at nothing: treat as first run for that
    // path rather than an error, and seed it.
    if (read.value === null) {
      await get().createAt(file);
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(read.value);
    } catch (error) {
      set({
        status: {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
          file,
        },
      });
      return;
    }

    const parsed = parseDoc(raw);
    if (!parsed.ok) {
      set({ status: { kind: 'error', message: parsed.error, file } });
      return;
    }

    await api.settings.write({ dataFilePath: file });
    set({
      doc: parsed.doc,
      filePath: file,
      activeBoardId: firstVisibleBoardId(parsed.doc.boards),
      savedSnapshot: serializeDoc(parsed.doc),
      status: { kind: 'ready' },
      past: [],
      future: [],
      canUndo: false,
      canRedo: false,
    });
  },

  reload: async () => {
    const file = get().filePath;
    if (!file) return;
    // openAt already handles parse failure, resets history, and refreshes
    // savedSnapshot. Reuse it rather than duplicating the load pipeline.
    await get().openAt(file);
  },

  setActiveBoard: (boardId) => {
    set({ activeBoardId: boardId });
    void api.settings.write({ activeBoardId: boardId });
  },

  setFilePath: (file) => {
    set({ filePath: file });
    void api.settings.write({ dataFilePath: file });
  },

  /**
   * The single entry point for every document change. Task 16 adds undo
   * history capture here and nowhere else.
   */
  commit: (next) => {
    const current = get().doc;
    if (!current || current === next) return;
    const past = [...get().past, current].slice(-MAX_HISTORY);
    set({
      doc: next,
      past,
      // Any new change invalidates the redo branch.
      future: [],
      canUndo: past.length > 0,
      canRedo: false,
    });
  },

  mutate: (recipe) => {
    const current = get().doc;
    if (!current) return;
    get().commit(produce(current, recipe));
  },

  applyDrag: (result, options) => {
    const current = get().doc;
    if (!current) return;
    const next = applyDragEnd(current, result, get().activeBoardId, options);
    // Identical reference means a no-op drag; skip the commit entirely so it
    // does not consume an undo slot or trigger a write.
    if (next === current) return;
    get().commit(next);
  },

  // Deliberately bypasses `commit`: an undo must not itself become a new
  // undoable step, or pressing undo twice would toggle instead of stepping
  // further back.
  undo: () => {
    const { past, doc } = get();
    const previous = past[past.length - 1];
    if (!previous || !doc) return;
    const nextPast = past.slice(0, -1);
    const nextFuture = [doc, ...get().future].slice(0, MAX_HISTORY);
    set({
      doc: withLiveScratchpads(previous, doc),
      past: nextPast,
      future: nextFuture,
      canUndo: nextPast.length > 0,
      canRedo: nextFuture.length > 0,
    });
  },

  redo: () => {
    const { future, doc } = get();
    const next = future[0];
    if (!next || !doc) return;
    const nextPast = [...get().past, doc].slice(-MAX_HISTORY);
    const nextFuture = future.slice(1);
    set({
      doc: withLiveScratchpads(next, doc),
      past: nextPast,
      future: nextFuture,
      canUndo: nextPast.length > 0,
      canRedo: nextFuture.length > 0,
    });
  },

  addBoard: (name) => {
    const id = newId('brd');
    get().mutate((draft) => {
      draft.boards.push({
        id,
        name,
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [
          { id: newId('lst'), name: 'Waiting', cards: [] },
          { id: newId('lst'), name: 'In Flight', cards: [] },
          { id: newId('lst'), name: 'Done', cards: [] },
        ],
      });
    });
    get().setActiveBoard(id);
    return id;
  },

  renameBoard: (boardId, name) => {
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.name = name;
    });
  },

  deleteBoard: (boardId) => {
    const remaining = (get().doc?.boards ?? []).filter((b) => b.id !== boardId);
    get().mutate((draft) => {
      draft.boards = draft.boards.filter((b) => b.id !== boardId);
    });
    // Deleting the active board must leave a valid selection, or null when
    // nothing is left. Null renders the empty state, never the welcome screen.
    if (get().activeBoardId === boardId) {
      const next = firstVisibleBoardId(remaining);
      set({ activeBoardId: next });
      void api.settings.write({ activeBoardId: next });
    }
  },

  archiveBoard: (boardId) => {
    const current = get().doc?.boards.find((b) => b.id === boardId);
    if (!current || current.archived) return;
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.archived = true;
    });
    // The board view follows the sidebar: leave an archived board and land
    // on the next one that is still visible, or the empty state.
    if (get().activeBoardId === boardId) {
      const next = firstVisibleBoardId(get().doc?.boards ?? []);
      set({ activeBoardId: next });
      void api.settings.write({ activeBoardId: next });
    }
  },

  unarchiveBoard: (boardId) => {
    const current = get().doc?.boards.find((b) => b.id === boardId);
    if (!current || !current.archived) return;
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.archived = false;
    });
  },

  addList: (boardId, name) => {
    const id = newId('lst');
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.lists.push({ id, name, cards: [] });
    });
    return id;
  },

  renameList: (boardId, listId, name) => {
    get().mutate((draft) => {
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      if (list) list.name = name;
    });
  },

  moveList: (boardId, listId, toIndex) => {
    get().mutate((draft) => {
      const board = draft.boards.find((candidate) => candidate.id === boardId);
      if (!board) return;
      const fromIndex = board.lists.findIndex((list) => list.id === listId);
      if (fromIndex === -1) return;
      const clamped = Math.max(0, Math.min(toIndex, board.lists.length - 1));
      if (fromIndex === clamped) return;
      const [moved] = board.lists.splice(fromIndex, 1);
      if (moved) board.lists.splice(clamped, 0, moved);
    });
  },

  deleteList: (boardId, listId) => {
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.lists = board.lists.filter((l) => l.id !== listId);
    });
  },

  // Tags are registered in `draft.tags` inside the SAME mutate recipe as
  // the card write below, so one addCard call produces exactly one
  // `commit` (one undo step), instead of the card write and tag
  // registration racking up two separate history entries.
  addCard: (boardId, listId, fields) => {
    // Creation flows that write card-scoped assets before Save reserve their
    // ID up front, so the metadata and files already agree on their owner.
    // Every other caller keeps the original store-generated ID behavior.
    const id = fields.id ?? newId('crd');
    const now = new Date().toISOString();
    const normalizedTags = Array.from(
      new Set((fields.tags ?? []).map(normalizeTagName).filter(Boolean)),
    );
    get().mutate((draft) => {
      normalizedTags.forEach((name) => {
        if (!draft.tags[name]) {
          draft.tags[name] = { color: nextTagColor(draft), label: name };
        }
      });
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      if (!list) return;
      list.cards.push({
        id,
        title: fields.title,
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
        archived: false,
        attachments: fields.attachments ?? [],
        variables: {},
        copyCount: 0,
        lastCopiedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    return id;
  },

  // Same reasoning as addCard above: when `patch.tags` is present, new tag
  // names are registered in `draft.tags` inside the same mutate recipe as
  // the field update, so a card edit that also changes tags is one commit,
  // not two.
  updateCard: (boardId, listId, cardId, patch) => {
    const normalizedTags = patch.tags
      ? Array.from(new Set(patch.tags.map(normalizeTagName).filter(Boolean)))
      : undefined;
    get().mutate((draft) => {
      if (normalizedTags) {
        normalizedTags.forEach((name) => {
          if (!draft.tags[name]) {
            draft.tags[name] = { color: nextTagColor(draft), label: name };
          }
        });
      }
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      const card = list?.cards.find((c) => c.id === cardId);
      if (!card) return;
      Object.assign(
        card,
        patch,
        normalizedTags ? { tags: normalizedTags } : {},
        { updatedAt: new Date().toISOString() },
      );
    });
  },

  deleteCard: (boardId, listId, cardId) => {
    get().mutate((draft) => {
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      if (list) list.cards = list.cards.filter((c) => c.id !== cardId);
    });
  },

  // Delegates to the pure `moveCardToBoard` domain function (same
  // reference-equality no-op convention `applyDrag` uses) rather than an
  // inline `mutate` recipe, since a cross-board splice is more involved than
  // the single-list find-and-assign every other action here does, and
  // keeping it in `domain/` makes it unit-testable without the store.
  moveCardToBoard: (fromBoardId, fromListId, cardId, toBoardId, toListId) => {
    const current = get().doc;
    if (!current) return;
    const next = moveCardToBoardDomain(
      current,
      fromBoardId,
      fromListId,
      cardId,
      toBoardId,
      toListId,
    );
    if (next === current) return;
    get().commit(next);
  },

  archiveCard: (boardId, listId, cardId) => {
    get().updateCard(boardId, listId, cardId, { archived: true });
  },

  unarchiveCard: (boardId, listId, cardId) => {
    get().updateCard(boardId, listId, cardId, { archived: false });
  },

  archiveAllCardsInList: (boardId, listId) => {
    get().mutate((draft) => {
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      if (!list) return;
      const now = new Date().toISOString();
      list.cards.forEach((card) => {
        card.archived = true;
        card.updatedAt = now;
      });
    });
  },

  // Deliberately does not touch `updatedAt`. Copying is not editing, and
  // conflating them would make "recently changed" meaningless.
  recordCopy: (boardId, listId, cardId) => {
    get().mutate((draft) => {
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (!card) return;
      card.copyCount += 1;
      card.lastCopiedAt = new Date().toISOString();
    });
  },

  setCardSessionRepo: (boardId, listId, cardId, repo) => {
    get().mutate((draft) => {
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (card) card.sessionRepo = repo;
    });
  },

  setCardSessionModel: (boardId, listId, cardId, model) => {
    get().mutate((draft) => {
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (card) card.sessionModel = model;
    });
  },

  /**
   * Deliberately bypasses `commit` (and therefore `mutate`): this is written
   * by the app itself when the daemon reports the real session id, never by
   * a user action.
   *
   * Routing it through `commit` pushed an undo frame nobody asked for and
   * cleared the redo branch on every session start. Worse, CardViewDialog's
   * effect re-fires the instant `undo` restores an older document whose
   * session id differs again, so undo could never step back past the point
   * a session id was first recorded — the first press already destroyed
   * redo, and every subsequent press was immediately re-committed over.
   *
   * Writing `doc` directly still produces a NEW document reference, so
   * `startPersistence()`'s doc-change subscription still picks it up and
   * debounce-writes it to kanban.json — which is what Task 9's
   * reattach-on-relaunch flow reads back. It simply is not an undo
   * checkpoint. Undoing back past "Run" therefore falls back to whatever
   * `sessionId`/`sessionTool` the older snapshot held, which spec §4
   * explicitly accepts ("undoing back past 'Run' is expected to forget
   * which session a card was on").
   */
  setCardSessionId: (boardId, listId, cardId, sessionId) => {
    const current = get().doc;
    if (!current) return;
    const next = produce(current, (draft) => {
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (!card) return;
      card.sessionId = sessionId;
      // The session id and the tool that produced it are discovered
      // together, and this is the only place the app ever learns a card
      // actually ran under Claude — `addCard` can only write null. Without
      // this, `sessionTool` could never distinguish "had a session" from
      // "never had one".
      if (sessionId) card.sessionTool = 'claude';
    });
    // Immer returns the same reference when the recipe changed nothing
    // (unknown card, or the id was already what we were about to write) —
    // skip the set so no spurious persistence write is triggered.
    if (next === current) return;
    set({ doc: next });
  },

  setBoardDefaultRepo: (boardId, repo) => {
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.defaultRepo = repo;
    });
  },

  // Same bypass as `setCardSessionId`: a scratchpad is saved as the user
  // types, and each keystroke must not become its own undo step. Disk
  // persistence still debounces off the new document reference.
  setBoardScratchpad: (boardId, text) => {
    const current = get().doc;
    if (!current) return;
    const next = produce(current, (draft) => {
      const board = draft.boards.find((candidate) => candidate.id === boardId);
      if (board && board.scratchpad !== text) board.scratchpad = text;
    });
    if (next === current) return;
    set({ doc: next });
  },

  // These three are app Settings (settings.json, main-process), not document
  // fields — they never go through `mutate`/undo, the same reasoning as
  // `activeBoardId` above.
  setApprovalMode: (mode) => {
    set({ approvalMode: mode });
    void api.settings.write({ approvalMode: mode });
  },

  setDefaultModel: (model) => {
    set({ defaultModel: model });
    void api.settings.write({ defaultModel: model });
  },

  // The global default only; a card's own `useWorktree` still overrides it,
  // and changing this never moves a session that has already started.
  setUseWorktrees: (enabled) => {
    set({ useWorktrees: enabled });
    void api.settings.write({ useWorktrees: enabled });
  },

  setSoundEnabled: (enabled) => {
    set({ soundEnabled: enabled });
    void api.settings.write({ soundEnabled: enabled });
  },

  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    void api.settings.write({ sidebarCollapsed: collapsed });
  },

  addSlashSnippet: (triggerRaw, expansionRaw) => {
    const parsed = parseSlashSnippet(triggerRaw, expansionRaw);
    if (!parsed.ok) return parsed;
    if (
      get().slashSnippets.some((snippet) => snippet.trigger === parsed.trigger)
    ) {
      return { ok: false, error: `/${parsed.trigger} already exists.` };
    }
    const slashSnippets = [
      ...get().slashSnippets,
      {
        id: newSnippetId(),
        trigger: parsed.trigger,
        expansion: parsed.expansion,
      },
    ];
    set({ slashSnippets });
    void api.settings.write({ slashSnippets });
    return { ok: true };
  },

  updateSlashSnippet: (id, triggerRaw, expansionRaw) => {
    const current = get().slashSnippets.find((snippet) => snippet.id === id);
    if (!current) return { ok: false, error: 'That command no longer exists.' };
    const parsed = parseSlashSnippet(triggerRaw, expansionRaw);
    if (!parsed.ok) return parsed;
    if (
      get().slashSnippets.some(
        (snippet) => snippet.id !== id && snippet.trigger === parsed.trigger,
      )
    ) {
      return { ok: false, error: `/${parsed.trigger} already exists.` };
    }
    const slashSnippets = get().slashSnippets.map((snippet) =>
      snippet.id === id
        ? { ...snippet, trigger: parsed.trigger, expansion: parsed.expansion }
        : snippet,
    );
    set({ slashSnippets });
    void api.settings.write({ slashSnippets });
    return { ok: true };
  },

  deleteSlashSnippet: (id) => {
    const slashSnippets = get().slashSnippets.filter(
      (snippet) => snippet.id !== id,
    );
    set({ slashSnippets });
    void api.settings.write({ slashSnippets });
  },

  // `name` is the raw, as-typed text (e.g. "Not ready"), so this is the
  // one place a tag's display label can be captured from what the user
  // actually typed — normalizeTagName only ever produces the identity key.
  ensureTag: (name) => {
    const normalized = normalizeTagName(name);
    if (!normalized) return '';
    const label = name.trim() || normalized;
    get().mutate((draft) => {
      if (!draft.tags[normalized]) {
        draft.tags[normalized] = { color: nextTagColor(draft), label };
      }
    });
    return normalized;
  },

  setCardTags: (boardId, listId, cardId, tags) => {
    const normalized = Array.from(
      new Set(tags.map(normalizeTagName).filter(Boolean)),
    );
    get().mutate((draft) => {
      normalized.forEach((name) => {
        if (!draft.tags[name]) {
          draft.tags[name] = { color: nextTagColor(draft), label: name };
        }
      });
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (!card) return;
      card.tags = normalized;
      card.updatedAt = new Date().toISOString();
    });
  },

  /**
   * Renaming sweeps every card. Cards store tag names, which is what keeps
   * the data file readable; the cost is this O(n) pass on a rare action.
   */
  renameTag: (from, to) => {
    const target = normalizeTagName(to);
    if (!target || target === from) return;
    get().mutate((draft) => {
      const existing = draft.tags[from];
      if (!existing) return;
      delete draft.tags[from];
      draft.tags[target] = draft.tags[target] ?? existing;
      draft.boards.forEach((board) =>
        board.lists.forEach((list) =>
          list.cards.forEach((card) => {
            if (!card.tags.includes(from)) return;
            card.tags = Array.from(
              new Set(card.tags.map((t) => (t === from ? target : t))),
            );
          }),
        ),
      );
    });
  },

  deleteTag: (name) => {
    get().mutate((draft) => {
      delete draft.tags[name];
      draft.boards.forEach((board) =>
        board.lists.forEach((list) =>
          list.cards.forEach((card) => {
            card.tags = card.tags.filter((t) => t !== name);
          }),
        ),
      );
    });
  },

  // Label-only: the tag's identity key never changes here, unlike
  // renameTag (which changes the key and sweeps every card). Editing the
  // display name a user sees has no reason to touch any card.
  setTagLabel: (key, label) => {
    get().mutate((draft) => {
      const tag = draft.tags[key];
      if (!tag) return;
      tag.label = label.trim() || key;
    });
  },

  setTagColor: (key, color) => {
    get().mutate((draft) => {
      const tag = draft.tags[key];
      if (!tag) return;
      tag.color = color;
    });
  },
}));
