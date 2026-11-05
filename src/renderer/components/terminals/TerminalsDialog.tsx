import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDocStore } from '@/store/docStore';
import { selectActiveBoard } from '@/store/selectors';
import { useConfirm } from '@/components/common/useConfirm';
import { TerminalPanel } from '@/components/card/TerminalPanel';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { TerminalTabs } from './TerminalTabs';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The panel fits the pty to its real size once it mounts. */
const START_COLS = 80;
const START_ROWS = 24;
/** A shell that exits sooner than this is not respawned. */
const MIN_LIFETIME_MS = 1000;

/**
 * The active board's general terminals: one plain login shell per tab, kept
 * alive by the daemon while the dialog is hidden. Only the active tab has a
 * mounted panel; `attach` replays the buffer when switching back.
 */
export function TerminalsDialog({ open, onOpenChange }: Props) {
  const board = useDocStore(selectActiveBoard);
  const addBoardTerminal = useDocStore((s) => s.addBoardTerminal);
  const renameBoardTerminal = useDocStore((s) => s.renameBoardTerminal);
  const removeBoardTerminal = useDocStore((s) => s.removeBoardTerminal);
  const moveBoardTerminal = useDocStore((s) => s.moveBoardTerminal);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const boardId = board?.id ?? null;
  const defaultRepo = board?.defaultRepo ?? '';
  const boardTabs = board?.terminals;
  const tabs = useMemo(() => boardTabs ?? [], [boardTabs]);
  const tabKey = tabs.map((tab) => tab.id).join(',');
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null;

  // Undo can restore a board with no tabs; always show at least one.
  useEffect(() => {
    if (open && boardId && tabKey === '') addBoardTerminal(boardId);
  }, [open, boardId, tabKey, addBoardTerminal]);

  const startedAt = useRef(new Map<string, number>());
  const startShell = useCallback((id: string, cwd: string) => {
    startedAt.current.set(id, Date.now());
    window.electron?.terminal
      ?.startShell?.({ id, cwd, cols: START_COLS, rows: START_ROWS })
      ?.catch(() => undefined);
  }, []);

  // The daemon's `start` is idempotent, so every tab can be (re)started.
  useEffect(() => {
    if (!open || tabKey === '') return;
    tabKey.split(',').forEach((id) => startShell(id, defaultRepo));
  }, [open, tabKey, defaultRepo, startShell]);

  useEffect(() => {
    if (!open) return undefined;
    const unsubscribe = window.electron?.terminal?.onShellState?.(
      (id, alive, busy) => {
        setBusyIds((prev) => {
          if (prev.has(id) === (alive && busy)) return prev;
          const next = new Set(prev);
          if (alive && busy) next.add(id);
          else next.delete(id);
          return next;
        });
        if (alive) return;
        // A shell that exited (say, `exit`) comes back, unless its tab is
        // gone. One that died within a second (a broken $SHELL or profile)
        // stays dead, or it would respawn in a loop; reopening restarts it.
        const lived = Date.now() - (startedAt.current.get(id) ?? 0);
        const current = selectActiveBoard(useDocStore.getState());
        if (
          lived > MIN_LIFETIME_MS &&
          current?.terminals.some((t) => t.id === id)
        ) {
          startShell(id, current.defaultRepo ?? '');
        }
      },
    );
    return () => unsubscribe?.();
  }, [open, startShell]);

  const closeNow = useCallback(
    (id: string) => {
      if (!boardId) return;
      const index = tabs.findIndex((tab) => tab.id === id);
      const neighbor = tabs[index + 1] ?? tabs[index - 1];
      if (id === active?.id && neighbor) setActiveId(neighbor.id);
      removeBoardTerminal(boardId, id);
      window.electron?.terminal?.close?.(id)?.catch(() => undefined);
    },
    [boardId, tabs, active?.id, removeBoardTerminal],
  );

  const closeTab = useCallback(
    (id: string) => {
      if (!busyIds.has(id)) {
        closeNow(id);
        return;
      }
      confirm({
        title: 'Close this terminal?',
        body: 'A command is still running in it. Closing the tab ends it.',
        confirmLabel: 'Close terminal',
        onConfirm: () => closeNow(id),
      });
    },
    [busyIds, closeNow, confirm],
  );

  const addTab = useCallback(() => {
    if (boardId) setActiveId(addBoardTerminal(boardId));
  }, [boardId, addBoardTerminal]);

  // AppShell's shortcuts skip while a dialog is open, so this one listens
  // itself, in the capture phase so xterm never sees the keys.
  const latest = useRef({ tabs, addTab, onOpenChange });
  latest.current = { tabs, addTab, onOpenChange };
  const activeIdRef = useRef<string | undefined>(undefined);
  activeIdRef.current = active?.id;
  useEffect(() => {
    if (!open) return undefined;
    // Meta only: Ctrl+T and Ctrl+W are real keys in a shell.
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey) return;
      if (document.querySelector('[role="alertdialog"]')) return;
      if (event.altKey) {
        // Cmd+Option+Left/Right: previous/next tab, wrapping.
        if (event.shiftKey || !event.key.startsWith('Arrow')) return;
        const { tabs: all } = latest.current;
        const step =
          event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step || all.length === 0) return;
        const from = all.findIndex((t) => t.id === activeIdRef.current);
        const next = all[(Math.max(from, 0) + step + all.length) % all.length];
        setActiveId(next.id);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const k = event.key.toLowerCase();
      const state = latest.current;
      if (event.shiftKey) return;
      if (k === 'w') {
        state.onOpenChange(false);
      } else if (k === 't') {
        state.addTab();
      } else if (/^[1-9]$/.test(k)) {
        const target = state.tabs[Number(k) - 1];
        if (target) setActiveId(target.id);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[90vh] w-[90vw] max-w-[90vw] flex-col gap-0 p-0 sm:max-w-[90vw]"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">Terminals</DialogTitle>
        <div className="border-b border-border py-2 pl-3 pr-12">
          {active && (
            <TerminalTabs
              tabs={tabs}
              activeId={active.id}
              busyIds={busyIds}
              onSelect={setActiveId}
              onAdd={addTab}
              onRename={(id, name) =>
                boardId && renameBoardTerminal(boardId, id, name)
              }
              onClose={closeTab}
              onMove={(id, to) => boardId && moveBoardTerminal(boardId, id, to)}
            />
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col p-2">
          {active && (
            <TerminalPanel key={active.id} cardId={active.id} autoFocus />
          )}
        </div>
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
