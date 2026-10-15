import { useState } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { Plus, GripVertical } from 'lucide-react';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
import { PromptCard } from '@/components/card/PromptCard';
import { useDocStore } from '@/store/docStore';
import { selectList } from '@/store/selectors';
import { DND_TYPES } from '@/domain/dragEnd';
import { visibleCards } from '@/domain/archive';
import { useUiStore } from '@/store/uiStore';
import { cardMatches, isFilterActive } from '@/domain/filter';
import { cn } from '@/lib/utils';
import { ListOptionsMenu } from './ListOptionsMenu';

interface Props {
  boardId: string;
  listId: string;
  index: number;
  /**
   * Whether a card is currently being dragged anywhere on the board. Drives
   * the drop zone open for the duration — see the zone itself for why this
   * is board-wide rather than this column's own `isDraggingOver`.
   */
  cardDragActive?: boolean;
}

export function ListColumn({
  boardId,
  listId,
  index,
  cardDragActive = false,
}: Props) {
  const list = useDocStore(selectList(boardId, listId));
  const renameList = useDocStore((s) => s.renameList);
  const addCard = useDocStore((s) => s.addCard);
  const [composing, setComposing] = useState(false);
  const filter = useUiStore((s) => s.filter);
  const showArchived = useUiStore((s) => s.showArchived);
  const filtering = isFilterActive(filter);

  if (!list) return null;

  const shown = visibleCards(list.cards, showArchived);
  const matchingCards = filtering
    ? shown.filter((card) => cardMatches(card, filter))
    : shown;

  const pasteAsCard = (event: React.ClipboardEvent<HTMLDivElement>) => {
    // Do not hijack paste while the user is typing in a field.
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;

    const text = event.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    event.preventDefault();

    const firstLine = text.trim().split('\n')[0];
    const title =
      firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
    addCard(boardId, listId, { title, prompt: text });
  };

  return (
    <Draggable draggableId={listId} index={index}>
      {(listProvided) => (
        <div
          ref={listProvided.innerRef}
          {...listProvided.draggableProps}
          role="group"
          aria-label={`List: ${list.name}`}
          tabIndex={0}
          onPaste={pasteAsCard}
          className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center gap-1 px-3 py-2">
            <div
              {...listProvided.dragHandleProps}
              role="button"
              aria-label={`Reorder list ${list.name}`}
              title="Drag to reorder"
              className="flex shrink-0 cursor-grab items-center rounded-md p-0.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </div>
            <InlineEditableText
              value={list.name}
              label={`list name for ${list.name}`}
              onCommit={(next) => renameList(boardId, listId, next)}
              className="min-w-0 flex-1 text-sm font-semibold"
            />
            <span className="text-xs tabular-nums text-muted-foreground">
              {filtering
                ? `${matchingCards.length}/${shown.length}`
                : shown.length}
            </span>
            <ListOptionsMenu
              boardId={boardId}
              listId={listId}
              listName={list.name}
            />
          </div>

          <Droppable
            droppableId={listId}
            type={DND_TYPES.card}
            isDropDisabled={filtering}
          >
            {(cardsProvided) => (
              <div
                ref={cardsProvided.innerRef}
                {...cardsProvided.droppableProps}
                data-slot="list-drop-zone"
                data-expanded={cardDragActive}
                /*
                  An empty column is a hairline at rest — a permanently
                  card-sized hole under every empty column is dead space —
                  and opens to a real target only while a card is in flight.

                  Keyed off a card being dragged ANYWHERE rather than this
                  column's own `isDraggingOver`: a collapsed 8px strip is
                  what the drag has to be aimed at to become "over" in the
                  first place, so waiting for that would never open.
                */
                className={cn(
                  'flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-[min-height]',
                  cardDragActive ? 'min-h-16' : 'min-h-2',
                )}
              >
                {/*
                  The index is the card's position among the ones rendered,
                  not in `list.cards`: Draggable indices within a droppable
                  have to run 0..n-1, and hiding archived cards would
                  otherwise leave gaps. `applyDragEnd` translates back.
                */}
                {matchingCards.map((card, cardIndex) => (
                  <PromptCard
                    key={card.id}
                    boardId={boardId}
                    listId={listId}
                    cardId={card.id}
                    index={cardIndex}
                    dragDisabled={filtering}
                  />
                ))}
                {cardsProvided.placeholder}
              </div>
            )}
          </Droppable>

          <button
            type="button"
            onClick={() => setComposing(true)}
            className="mx-2 mb-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
          >
            <Plus className="size-4" />
            Add prompt
          </button>

          <CardComposerDialog
            open={composing}
            onOpenChange={setComposing}
            boardId={boardId}
            listId={listId}
            cardId={null}
          />
        </div>
      )}
    </Draggable>
  );
}
