import { create } from 'zustand';
import { EMPTY_FILTER, type FilterState } from '@/domain/filter';

interface UiStore {
  filter: FilterState;
  paletteOpen: boolean;
  /** Transient view preference for the Cmd/Ctrl+? shortcuts-help dialog. */
  shortcutsHelpOpen: boolean;
  /** Whether the active board's scratchpad dialog is open. */
  scratchpadOpen: boolean;
  /** Whether the settings dialog is open. */
  settingsOpen: boolean;
  focusCardId: string | null;
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

  setFilterText: (text: string) => void;
  toggleFilterTag: (tag: string) => void;
  clearFilter: () => void;
  setPaletteOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setScratchpadOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setFocusCardId: (cardId: string | null) => void;
  setExternalChange: (value: boolean) => void;
  setCardDialogExpanded: (cardId: string, expanded: boolean) => void;
  setShowArchived: (show: boolean) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  filter: EMPTY_FILTER,
  paletteOpen: false,
  shortcutsHelpOpen: false,
  scratchpadOpen: false,
  settingsOpen: false,
  focusCardId: null,
  externalChange: false,
  cardDialogExpanded: {},
  showArchived: false,

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
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setFocusCardId: (focusCardId) => set({ focusCardId }),
  setExternalChange: (externalChange) => set({ externalChange }),
  setCardDialogExpanded: (cardId, expanded) =>
    set((state) => ({
      cardDialogExpanded: { ...state.cardDialogExpanded, [cardId]: expanded },
    })),
  setShowArchived: (showArchived) => set({ showArchived }),
}));
