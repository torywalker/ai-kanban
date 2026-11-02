import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SHORTCUTS, type ShortcutEntry } from '@/lib/shortcuts';

// Groups entries by `section`, preserving first-seen order.
function groupBySection(entries: ShortcutEntry[]) {
  const groups = new Map<string, ShortcutEntry[]>();
  entries.forEach((entry) => {
    groups.set(entry.section, [...(groups.get(entry.section) ?? []), entry]);
  });
  return Array.from(groups.entries());
}

interface ShortcutsHelpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Opened by Cmd/Ctrl+? (see the keydown handler in AppShell.tsx). Renders
// every entry in `SHORTCUTS` (lib/shortcuts.ts) so this list can never drift
// out of sync with what's actually wired up elsewhere.
export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: ShortcutsHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Everything you can do without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {groupBySection(SHORTCUTS).map(([section, entries]) => (
            <section key={section} className="flex flex-col gap-2">
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section}
              </h3>
              <ul className="flex flex-col gap-2">
                {entries.map((shortcut) => (
                  <li
                    key={shortcut.description}
                    className="flex items-center justify-between gap-4 text-sm"
                  >
                    <span>{shortcut.description}</span>
                    <span className="flex shrink-0 gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={key}
                          className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
