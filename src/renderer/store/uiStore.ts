import { create } from 'zustand';
import { EMPTY_FILTER, type FilterState } from '@/domain/filter';

const COMMENTS_OPEN_KEY = 'ai-kanban.commentsOpen';

// Stored as the list of open card ids. Storage can be missing, blocked or
// corrupt; every failure just means "nothing was remembered".
function readCommentsOpen(): Record<string, boolean> {
  try {
    const ids: unknown = JSON.parse(
      window.localStorage.getItem(COMMENTS_OPEN_KEY) ?? '[]',
    );
    if (!Array.isArray(ids)) return {};
    return Object.fromEntries(
      ids.filter((id) => typeof id === 'string').map((id) => [id, true]),
    );
  } catch {
    return {};
  }
}

function writeCommentsOpen(open: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(
      COMMENTS_OPEN_KEY,
      JSON.stringify(Object.keys(open).filter((id) => open[id])),
    );
  } catch {
    // Not remembered across relaunches; this session still works.
  }
}

interface UiStore {
  filter: FilterState;
  paletteOpen: boolean;
  /** Transient view preference for the Cmd/Ctrl+? shortcuts-help dialog. */
  shortcutsHelpOpen: boolean;
  /** Whether the active board's scratchpad dialog is open. */
  scratchpadOpen: boolean;
  /** Whether the active board's general terminals dialog is open. */
  terminalsOpen: boolean;
  /** Whether the settings dialog is open. */
  settingsOpen: boolean;
  focusCardId: string | null;
  /** Card whose view dialog should open (e.g. from a native notification click). */
  openCardId: string | null;
  externalChange: boolean;
  /**
   * Whether each card's view dialog renders at its near-fullscreen size, to
   * give the AI chat room to be read. Keyed by cardId so every card's dialog
   * remembers its own choice independently — expanding one card's dialog
   * should not force every other card open expanded too.
   *
   * Lives here rather than in `CardViewDialog` because `PromptCard` renders
   * one dialog instance per card: component-local state would reset the
   * choice every time the dialog remounts (e.g. closing and reopening the
   * same card). Deliberately NOT in `docStore`'s persisted settings — it is
   * a transient view preference like `paletteOpen`, not part of the
   * document or the user's saved config.
   */
  cardDialogExpanded: Record<string, boolean>;
  /**
   * Transient view preference: archived cards stay in the document but are
   * hidden from lists until this is flipped. Not persisted, same as
   * `paletteOpen`.
   */
  showArchived: boolean;
  /**
   * Whether each card's comments sidebar is open, keyed by cardId. Per card
   * so opening it on one card doesn't open it on every other. A view
   * preference, not document data: remembered across relaunches in
   * localStorage.
   */
  commentsOpen: Record<string, boolean>;
  /** Whether each card's prompt is collapsed to one line in the view dialog, keyed by cardId. */
  promptCollapsed: Record<string, boolean>;

  /** Cards multi-selected with Shift-click, to be dragged together. */
  selectedCardIds: string[];
  toggleCardSelected: (cardId: string) => void;
  clearCardSelection: () => void;

  setFilterText: (text: string) => void;
  toggleFilterTag: (tag: string) => void;
  clearFilter: () => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setScratchpadOpen: (open: boolean) => void;
  setTerminalsOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setFocusCardId: (cardId: string | null) => void;
  setOpenCardId: (cardId: string | null) => void;
  setExternalChange: (value: boolean) => void;
  setCardDialogExpanded: (cardId: string, expanded: boolean) => void;
  setShowArchived: (show: boolean) => void;
  setCommentsOpen: (cardId: string, open: boolean) => void;
  setPromptCollapsed: (cardId: string, collapsed: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  filter: EMPTY_FILTER,
  paletteOpen: false,
  shortcutsHelpOpen: false,
  scratchpadOpen: false,
  terminalsOpen: false,
  settingsOpen: false,
  focusCardId: null,
  openCardId: null,
  externalChange: false,
  cardDialogExpanded: {},
  showArchived: false,
  commentsOpen: readCommentsOpen(),
  promptCollapsed: {},
  selectedCardIds: [],

  toggleCardSelected: (cardId) =>
    set((state) => ({
      selectedCardIds: state.selectedCardIds.includes(cardId)
        ? state.selectedCardIds.filter((id) => id !== cardId)
        : [...state.selectedCardIds, cardId],
    })),
  clearCardSelection: () =>
    set((state) =>
      state.selectedCardIds.length ? { selectedCardIds: [] } : state,
    ),

  setFilterText: (text) =>
    set((state) => ({ filter: { ...state.filter, text } })),

  toggleFilterTag: (tag) =>
    set((state) => ({
      filter: {
        ...state.filter,
        tags: state.filter.tags.includes(tag)
          ? state.filter.tags.filter((t) => t !== tag)
          : [...state.filter.tags, tag],
      },
    })),

  clearFilter: () => set({ filter: EMPTY_FILTER }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
  setScratchpadOpen: (scratchpadOpen) => set({ scratchpadOpen }),
  setTerminalsOpen: (terminalsOpen) => set({ terminalsOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setFocusCardId: (focusCardId) => set({ focusCardId }),
  setOpenCardId: (openCardId) => set({ openCardId }),
  setExternalChange: (externalChange) => set({ externalChange }),
  setCardDialogExpanded: (cardId, expanded) =>
    set((state) => ({
      cardDialogExpanded: { ...state.cardDialogExpanded, [cardId]: expanded },
    })),
  setShowArchived: (showArchived) => set({ showArchived }),
  setCommentsOpen: (cardId, open) =>
    set((state) => {
      const commentsOpen = { ...state.commentsOpen, [cardId]: open };
      writeCommentsOpen(commentsOpen);
      return { commentsOpen };
    }),
  setPromptCollapsed: (cardId, collapsed) =>
    set((state) => ({
      promptCollapsed: { ...state.promptCollapsed, [cardId]: collapsed },
    })),
}));
