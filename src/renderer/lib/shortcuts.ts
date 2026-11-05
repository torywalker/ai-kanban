/**
 * Single source of truth for every keyboard shortcut registered across the
 * app -- global ones in AppShell.tsx and CommandPalette.tsx, plus scoped
 * ones like CardComposerDialog.tsx's save shortcut -- so ShortcutsHelpDialog
 * (opened via Cmd/Ctrl+?) can never drift out of sync with what's actually
 * wired up. Add a shortcut, add its entry here, and the help dialog picks it
 * up for free.
 */
export interface ShortcutEntry {
  /** Individual keys rendered as separate <kbd> chips, e.g. ['⌘', 'Z']. */
  keys: string[];
  description: string;
  /** Heading the entry is grouped under in the help dialog. */
  section: string;
}

export const GENERAL_SECTION = 'General';
export const TERMINALS_SECTION = 'Terminals';
export const CARD_VIEW_SECTION = 'While viewing a card';

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['⌘', 'Z'], description: 'Undo', section: GENERAL_SECTION },
  { keys: ['⌘', '⇧', 'Z'], description: 'Redo', section: GENERAL_SECTION },
  { keys: ['⌘', 'N'], description: 'New card', section: GENERAL_SECTION },
  {
    keys: ['⌘', '⌥', 'N'],
    description: 'New prompt from anywhere',
    section: GENERAL_SECTION,
  },
  { keys: ['⌘', 'B'], description: 'Toggle sidebar', section: GENERAL_SECTION },
  {
    keys: ['⌘', '⌥', '↑ / ↓'],
    description: 'Switch board',
    section: GENERAL_SECTION,
  },
  { keys: ['⌘', 'K'], description: 'Search cards', section: GENERAL_SECTION },
  {
    keys: ['⌘', '⇧', 'P'],
    description: 'Open the board scratchpad',
    section: GENERAL_SECTION,
  },
  {
    keys: ['⌘', '⇧', 'S'],
    description: 'Open settings',
    section: GENERAL_SECTION,
  },
  {
    keys: ['⌘', '?'],
    description: 'Show keyboard shortcuts',
    section: GENERAL_SECTION,
  },
  { keys: ['⌘', '⏎'], description: 'Save card', section: GENERAL_SECTION },
  { keys: ['⌘', 'E'], description: 'Edit card', section: CARD_VIEW_SECTION },
  {
    keys: ['⌘', 'X'],
    description: 'Run, or re-connect the terminal',
    section: CARD_VIEW_SECTION,
  },
  { keys: ['⌘', 'C'], description: 'Copy prompt', section: CARD_VIEW_SECTION },
  {
    keys: ['⌘', 'J'],
    description: 'Show or hide comments',
    section: CARD_VIEW_SECTION,
  },
  {
    keys: ['⌘', 'W'],
    description: 'Close a terminal card',
    section: CARD_VIEW_SECTION,
  },
  {
    keys: ['⌘', 'A'],
    description: 'Archive or restore card',
    section: CARD_VIEW_SECTION,
  },
  {
    keys: ['⌘', 'T'],
    description: 'Open terminals, or add a terminal tab',
    section: TERMINALS_SECTION,
  },
  {
    keys: ['⌘', 'W'],
    description: 'Hide terminals',
    section: TERMINALS_SECTION,
  },
  {
    keys: ['⌘', '1–9'],
    description: 'Jump to a terminal tab',
    section: TERMINALS_SECTION,
  },
  {
    keys: ['⌘', '⌥', '←/→'],
    description: 'Previous / next terminal tab',
    section: TERMINALS_SECTION,
  },
];
