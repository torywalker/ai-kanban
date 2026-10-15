import { useEffect, useRef, useState } from 'react';
import { useDocStore } from '@/store/docStore';
import { selectSessionCardIds, selectVisibleBoardIds } from '@/store/selectors';
import { useUiStore } from '@/store/uiStore';
import { startPersistence, flushPersistence } from '@/store/persistence';
import { startSessionSubscription } from '@/store/sessionStore';
import { useTheme } from '@/lib/useTheme';
import { api } from '@/lib/api';
import { reattachSessions } from '@/lib/reattachSessions';
import { WelcomeScreen } from './WelcomeScreen';
import { FileErrorScreen } from './FileErrorScreen';
import { ExternalChangeBanner } from './ExternalChangeBanner';
import { BoardView } from '@/components/board/BoardView';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { Toaster } from '@/components/ui/sonner';
import { CommandPalette } from '@/components/search/CommandPalette';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { ShortcutsHelpDialog } from './ShortcutsHelpDialog';

export function AppShell() {
  useTheme();
  const status = useDocStore((s) => s.status);
  const bootstrap = useDocStore((s) => s.bootstrap);
  // Subscribed reactively (not read once via `getState()`) specifically so
  // the reattach effect below can fire when the document actually arrives:
  // `bootstrap()` is async, so at mount time `doc` is still null.
  const doc = useDocStore((s) => s.doc);
  const activeBoardId = useDocStore((s) => s.activeBoardId);
  const reattachedRef = useRef(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const shortcutsHelpOpen = useUiStore((s) => s.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useUiStore((s) => s.setShortcutsHelpOpen);
  const setScratchpadOpen = useUiStore((s) => s.setScratchpadOpen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const stop = startPersistence();
    const onBeforeUnload = () => {
      void flushPersistence();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      stop();
    };
  }, []);

  useEffect(() => {
    return startSessionSubscription();
  }, []);

  // Reattach to any session a card was on before the last relaunch. This
  // deliberately runs off the reactive `doc` value rather than a mount-time
  // `getState()` read: `bootstrap()` (fired by the effect above) is still
  // awaiting IPC when this component mounts, so a synchronous read would
  // always see `doc === null` and walk zero cards. The ref guard keeps the
  // walk to exactly once — the first time a document becomes available —
  // so ordinary document edits afterwards never re-issue getState calls.
  // The actual per-card placeholder/query/give-up-timeout logic lives in
  // `reattachSessions` (see its own comments) — SettingsDialog's "Restart
  // Daemon" action calls the exact same helper on demand, so both trigger
  // identical behaviour.
  useEffect(() => {
    if (!doc || reattachedRef.current) return;
    reattachedRef.current = true;
    return reattachSessions(selectSessionCardIds(useDocStore.getState()));
  }, [doc]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z') return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      event.preventDefault();
      const store = useDocStore.getState();
      if (event.shiftKey) store.redo();
      else store.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Cmd/Ctrl+N: quick-add a card into the left-most column of the current
  // board, mirroring Cmd+Z above and Cmd+K in CommandPalette -- same
  // renderer-level listener, same input-field guard. Skipped whenever ANY
  // dialog is already open (command palette, a card's own view/edit
  // dialog, a column's own "Add prompt" composer, settings, ...) rather
  // than stacking a second one on top -- every dialog in this app (see
  // `components/ui/dialog.tsx`) is built on Radix's `Dialog.Content`, which
  // always renders with `role="dialog"`, so checking for that role in the
  // DOM is a single check that covers all of them without this file having
  // to know about each one individually.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'n') return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"]')) return;

      const { doc: currentDoc, activeBoardId: currentBoardId } =
        useDocStore.getState();
      const board = currentDoc?.boards.find((b) => b.id === currentBoardId);
      if (!board || board.lists.length === 0) return;

      event.preventDefault();
      setQuickAddOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b') return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      event.preventDefault();
      const store = useDocStore.getState();
      store.setSidebarCollapsed(!store.sidebarCollapsed);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (!event.altKey) return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      event.preventDefault();
      const store = useDocStore.getState();
      const boardIds = selectVisibleBoardIds(store);
      if (boardIds.length === 0) return;

      const currentIndex = boardIds.indexOf(store.activeBoardId ?? '');
      const step = event.key === 'ArrowDown' ? 1 : -1;
      // `currentIndex` is -1 when there's no active board (or it's not in
      // this list); `-1 + step` still lands on a sane wrapped index rather
      // than needing a separate branch.
      const nextIndex =
        (currentIndex + step + boardIds.length) % boardIds.length;
      store.setActiveBoard(boardIds[nextIndex]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Cmd/Ctrl+Shift+P: open the active board's scratchpad. Shift is required
  // so a plain print/save-adjacent shortcut is left alone. macOS reports
  // this as key 'p' with shiftKey still set (Command drops the Shift
  // transform on `key`).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'p') return;
      if (!event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"]')) return;

      const { doc: currentDoc, activeBoardId: currentBoardId } =
        useDocStore.getState();
      const board = currentDoc?.boards.find((b) => b.id === currentBoardId);
      if (!board || board.archived) return;

      event.preventDefault();
      setScratchpadOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setScratchpadOpen]);

  // Cmd/Ctrl+Shift+S: open Settings. macOS reports this as key 's' with
  // shiftKey still set, the same Command-drops-Shift-transform quirk as the
  // scratchpad shortcut above.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 's') return;
      if (!event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.altKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"]')) return;

      event.preventDefault();
      setSettingsOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setSettingsOpen]);

  // Cmd/Ctrl+?: open the shortcuts-help dialog (ShortcutsHelpDialog). The '?'
  // is matched via the physical Slash key plus Shift as well as a literal
  // '?', because macOS never reports '?' while Command is held: Chromium
  // takes `key` from NSEvent's `characters`, which macOS computes with the
  // Shift transformation dropped for Command-modified events (the same reason
  // Cmd+Shift+P arrives as 'p'), so ⌘? lands here as key='/' on code='Slash'.
  // The literal-'?' branch is what Ctrl+Shift+/ reports off macOS, and covers
  // layouts that put '?' somewhere other than the Slash key. Same guards as
  // Cmd+N: skipped while typing in an input/textarea/contenteditable, and
  // skipped while any dialog (role="dialog") is already open rather than
  // stacking a second one on top.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isQuestionMark =
        event.key === '?' ||
        (event.shiftKey && (event.key === '/' || event.code === 'Slash'));
      if (!isQuestionMark) return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"]')) return;

      event.preventDefault();
      setShortcutsHelpOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setShortcutsHelpOpen]);

  useEffect(() => {
    return api.data.onChanged(() => {
      useUiStore.getState().setExternalChange(true);
    });
  }, []);

  // Defensive reset for the quick-add dialog above: if the board it was
  // targeting stops existing (deleted, or an undo/redo lands on a document
  // that predates it) while the dialog is open, drop the open flag too --
  // otherwise `quickAddOpen` stays stuck `true` in memory and the dialog
  // would silently pop back open, un-requested, the next time any board
  // becomes active again.
  useEffect(() => {
    const stillHasActiveBoard =
      doc?.boards.some((b) => b.id === activeBoardId) ?? false;
    if (!stillHasActiveBoard) setQuickAddOpen(false);
  }, [doc, activeBoardId]);

  if (status.kind === 'loading') {
    return <div className="h-full bg-background" />;
  }
  if (status.kind === 'welcome') {
    return <WelcomeScreen />;
  }
  if (status.kind === 'error') {
    return <FileErrorScreen file={status.file} message={status.message} />;
  }

  // Backs the Cmd/Ctrl+N handler above: the left-most column is simply
  // `lists[0]`, since lists have no separate order/position field -- array
  // order IS display order (see ListColumn/BoardView).
  const activeBoard = doc?.boards.find((b) => b.id === activeBoardId) ?? null;
  const leftmostListId = activeBoard?.lists[0]?.id ?? null;

  return (
    <div className="flex h-full flex-col bg-background">
      <ExternalChangeBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <BoardView />
        </main>
      </div>
      <Toaster />
      <CommandPalette />
      <ShortcutsHelpDialog
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
      {activeBoard && leftmostListId ? (
        <CardComposerDialog
          open={quickAddOpen}
          onOpenChange={setQuickAddOpen}
          boardId={activeBoard.id}
          listId={leftmostListId}
          cardId={null}
        />
      ) : null}
    </div>
  );
}
