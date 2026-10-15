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
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: ['⌘', 'Z'], description: 'Undo' },
  { keys: ['⌘', '⇧', 'Z'], description: 'Redo' },
  { keys: ['⌘', 'N'], description: 'New card' },
  { keys: ['⌘', 'B'], description: 'Toggle sidebar' },
  { keys: ['⌘', '⌥', '↑ / ↓'], description: 'Switch board' },
  { keys: ['⌘', 'K'], description: 'Search cards' },
  { keys: ['⌘', '⇧', 'P'], description: 'Open the board scratchpad' },
  { keys: ['⌘', '⇧', 'S'], description: 'Open settings' },
  { keys: ['⌘', '?'], description: 'Show keyboard shortcuts' },
  { keys: ['⌘', '⏎'], description: 'Save card' },
];
