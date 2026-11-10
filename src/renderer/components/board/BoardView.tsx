import { useMemo, useState } from 'react';
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { Bell, BellOff, SquareTerminal, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { WORKTREE_MISSING_ERROR } from '@shared/worktree';
import { closeLiveTerminals, useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { selectActiveBoard } from '@/store/selectors';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { Button } from '@/components/ui/button';
import { TerminalsDialog } from '@/components/terminals/TerminalsDialog';
import { cardDropDestinationList, DND_TYPES } from '@/domain/dragEnd';
import { boardUsageCardIds } from '@/domain/archive';
import { api } from '@/lib/api';
import { fireConfettiOnCard, isCelebrationListName } from '@/lib/confetti';
import { useBoardUsage } from '@/lib/useBoardUsage';
import { formatUsageBreakdown, formatUsd } from '@/lib/formatUsage';
import { ListColumn } from './ListColumn';
import { AddListColumn } from './AddListColumn';
import { FilterBar } from './FilterBar';
import { ScratchpadDialog } from './ScratchpadDialog';

export function BoardView() {
  const board = useDocStore(selectActiveBoard);
  const renameBoard = useDocStore((s) => s.renameBoard);
  const soundEnabled = useDocStore((s) => s.soundEnabled);
  const setSoundEnabled = useDocStore((s) => s.setSoundEnabled);
  const applyDrag = useDocStore((s) => s.applyDrag);
  const setBoardDefaultRepo = useDocStore((s) => s.setBoardDefaultRepo);
  const showArchived = useUiStore((s) => s.showArchived);
  const setShowArchived = useUiStore((s) => s.setShowArchived);
  const scratchpadOpen = useUiStore((s) => s.scratchpadOpen);
  const setScratchpadOpen = useUiStore((s) => s.setScratchpadOpen);
  const terminalsOpen = useUiStore((s) => s.terminalsOpen);
  const setTerminalsOpen = useUiStore((s) => s.setTerminalsOpen);
  const promptDeleteWorktreeOnDone = useDocStore(
    (s) => s.promptDeleteWorktreeOnDone,
  );
  const updateCard = useDocStore((s) => s.updateCard);
  // The card just moved to a done list whose worktree is still on disk.
  const [worktreePrompt, setWorktreePrompt] = useState<{
    listId: string;
    cardId: string;
  } | null>(null);
  // True only between a CARD lift and its drop, so every column can offer a
  // droppable-sized target for exactly as long as one is needed.
  const [cardDragActive, setCardDragActive] = useState(false);

  // Recomputed only when the board's own card set changes shape, not on
  // every render — `useBoardUsage` in turn collapses this to a content key,
  // so a stable array reference here isn't load-bearing, but avoiding a
  // fresh array on every keystroke elsewhere in the board keeps this cheap.
  const cardIds = useMemo(
    () => (board ? boardUsageCardIds(board, showArchived) : []),
    [board, showArchived],
  );
  const totals = useBoardUsage(cardIds);

  // Same removal the card dialog's "Delete worktree" button performs.
  const deleteDoneWorktree = async (target: {
    listId: string;
    cardId: string;
  }) => {
    const card = board?.lists
      .find((l) => l.id === target.listId)
      ?.cards.find((c) => c.id === target.cardId);
    const primary = card?.sessionRepo ?? board?.defaultRepo ?? null;
    if (!board || !card?.sessionWorktree || !primary) return;
    try {
      const result = await api.git.removeWorktree(
        card.id,
        primary,
        card.sessionWorktree,
      );
      if (!result.ok && result.error !== WORKTREE_MISSING_ERROR) {
        toast.error(result.error);
        return;
      }
      updateCard(board.id, target.listId, card.id, { sessionWorktree: null });
      toast.success('Worktree deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  if (!board) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No board selected. Create one from the sidebar.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b border-border px-4 py-3">
        <InlineEditableText
          value={board.name}
          label={`board name for ${board.name}`}
          onCommit={(next) => renameBoard(board.id, next)}
          className="text-base font-semibold"
        />
        <button
          type="button"
          onClick={async () => {
            const folder = await api.data.pickFolder();
            if (folder) setBoardDefaultRepo(board.id, folder);
          }}
          className="ml-2 truncate rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          title={board.defaultRepo ?? undefined}
        >
          {board.defaultRepo
            ? board.defaultRepo.split('/').pop()
            : 'Set default repo…'}
        </button>
        <Button
          type="button"
          variant={showArchived ? 'secondary' : 'outline'}
          size="sm"
          className="ml-2"
          onClick={() => setShowArchived(!showArchived)}
        >
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-2"
          onClick={() => setScratchpadOpen(true)}
        >
          <StickyNote />
          Scratchpad
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-2"
          onClick={() => setTerminalsOpen(true)}
        >
          <SquareTerminal />
          Terminals
        </Button>
        {/* `ml-auto` right-aligns it on the name's line, the same trick
            `UsageSummary` uses for a card's badge row. Always rendered,
            zero included — see that component for why hiding a zero total
            would be worse than showing one. */}
        <span
          data-slot="board-usage"
          className="ml-auto shrink-0 text-xs font-medium tabular-nums text-muted-foreground"
          title={formatUsageBreakdown(totals)}
        >
          {formatUsd(totals.costUSD)}
        </span>
        <Button
          type="button"
          variant={soundEnabled ? 'outline' : 'secondary'}
          size="icon"
          className="ml-2"
          aria-pressed={!soundEnabled}
          aria-label="Mute notifications"
          title={soundEnabled ? 'Mute notifications' : 'Unmute notifications'}
          onClick={() => setSoundEnabled(!soundEnabled)}
        >
          {soundEnabled ? <Bell /> : <BellOff />}
        </Button>
      </header>

      <FilterBar />
      <ScratchpadDialog
        open={scratchpadOpen}
        onOpenChange={setScratchpadOpen}
      />
      <TerminalsDialog open={terminalsOpen} onOpenChange={setTerminalsOpen} />

      {/* The indices a drop reports are positions among the cards on
          screen, so which view is active decides how they are read. */}
      <DragDropContext
        onDragStart={(start) =>
          setCardDragActive(start.type === DND_TYPES.card)
        }
        onDragEnd={(result) => {
          setCardDragActive(false);
          applyDrag(result, { showArchived });

          // Celebrate only an actual move onto a "done"-shaped column, not a
          // reorder within one it was already sitting in.
          const destList = cardDropDestinationList(board, result);
          if (destList && isCelebrationListName(destList.name)) {
            fireConfettiOnCard(result.draggableId);
            // Work is over, so shut its terminal too (no-op if none is live).
            closeLiveTerminals([result.draggableId]);
            // `board` is the pre-drop snapshot, so the card is still in its
            // source list here, not in `destList`.
            const moved = board.lists
              .find((l) => l.id === result.source.droppableId)
              ?.cards.find((c) => c.id === result.draggableId);
            if (promptDeleteWorktreeOnDone && moved?.sessionWorktree) {
              setWorktreePrompt({
                listId: destList.id,
                cardId: moved.id,
              });
            }
          }
        }}
      >
        <Droppable
          droppableId="board"
          direction="horizontal"
          type={DND_TYPES.list}
        >
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex flex-1 items-start gap-3 overflow-x-auto p-4"
            >
              {board.lists.map((list, index) => (
                <ListColumn
                  key={list.id}
                  boardId={board.id}
                  listId={list.id}
                  index={index}
                  cardDragActive={cardDragActive}
                />
              ))}
              {provided.placeholder}
              <AddListColumn boardId={board.id} />
            </div>
          )}
        </Droppable>
      </DragDropContext>
      <ConfirmDialog
        open={worktreePrompt !== null}
        onOpenChange={(open) => {
          if (!open) setWorktreePrompt(null);
        }}
        title="Delete this card's worktree?"
        body="The card is done. Its git worktree is still on disk. Anything not shipped yet will be lost."
        confirmLabel="Delete worktree"
        destructive
        onConfirm={() => {
          if (worktreePrompt) void deleteDoneWorktree(worktreePrompt);
        }}
      />
    </div>
  );
}
