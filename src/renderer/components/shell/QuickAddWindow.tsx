import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  defaultQuickAddBoardId,
  quickAddBoards,
  type QuickAddBoardChoice,
} from '@shared/quickAdd';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { Toaster } from '@/components/ui/sonner';
import { api } from '@/lib/api';
import { useTheme } from '@/lib/useTheme';
import { useDocStore } from '@/store/docStore';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; boards: QuickAddBoardChoice[] };

/**
 * The global-shortcut window. It is not the main board: it borrows the open
 * document (or the file, if the main window is closed) and hands the new
 * card back instead of writing a second copy.
 */
export default function QuickAddWindow() {
  useTheme();
  const [load, setLoad] = useState<LoadState>({ kind: 'loading' });
  const [boardId, setBoardId] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'New prompt';
    let cancelled = false;
    api.quickAdd
      .context()
      .then((result) => {
        if (cancelled) return null;
        if (!result.ok || !result.value) {
          setLoad({
            kind: 'error',
            message: result.ok ? 'Open a board file first.' : result.error,
          });
          return null;
        }
        const boards = quickAddBoards(result.value.doc);
        const selected = defaultQuickAddBoardId(
          boards,
          result.value.activeBoardId,
        );
        useDocStore.setState({
          status: { kind: 'ready' },
          doc: result.value.doc,
          filePath: null,
          activeBoardId: selected,
          defaultModel: result.value.defaultModel,
          useWorktrees: result.value.useWorktrees,
          sessionEngine: result.value.sessionEngine,
          slashSnippets: result.value.slashSnippets,
          savedSnapshot: null,
          past: [],
          future: [],
        });
        setBoardId(selected);
        setLoad(
          boards.length === 0
            ? { kind: 'error', message: 'Open a board that has a column.' }
            : { kind: 'ready', boards },
        );
        return null;
      })
      .catch(() => {
        if (!cancelled) {
          setLoad({
            kind: 'error',
            message: 'The main window did not respond.',
          });
        }
        return null;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const choice =
    load.kind === 'ready'
      ? (load.boards.find((board) => board.id === boardId) ?? null)
      : null;

  return (
    <div className="h-full bg-background text-foreground">
      <Toaster />
      {load.kind === 'loading' ? (
        <p className="p-6 text-sm text-muted-foreground">Loading boards…</p>
      ) : null}
      {load.kind === 'error' ? (
        <div className="flex h-full flex-col items-start gap-3 p-6">
          <p className="text-sm">{load.message}</p>
          <button
            type="button"
            className="text-sm underline"
            onClick={() => window.close()}
          >
            Close
          </button>
        </div>
      ) : null}
      {choice ? (
        <CardComposerDialog
          open
          onOpenChange={(next) => {
            if (!next) window.close();
          }}
          boardId={choice.id}
          listId={choice.listId}
          cardId={null}
          boardChoices={load.kind === 'ready' ? load.boards : []}
          onBoardChange={setBoardId}
          onCreate={async (fields) => {
            const result = await api.quickAdd.commit({
              boardId: choice.id,
              listId: choice.listId,
              fields,
            });
            if (!result.ok) {
              toast.error(result.error);
              return false;
            }
            return true;
          }}
        />
      ) : null}
    </div>
  );
}
