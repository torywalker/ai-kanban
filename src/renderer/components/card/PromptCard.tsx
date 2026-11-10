import { useEffect, useRef, useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { ChevronDown, ChevronUp, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { copyText } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useCardUsage } from '@/lib/useCardUsage';
import { formatUsd, formatUsageBreakdown } from '@/lib/formatUsage';
import { TagBadge } from '@/components/tags/TagBadge';
import { extractVariables } from '@/domain/variables';
import { formatDueDate, isOverdue } from '@/domain/dueDate';
import { CardContextMenu } from './CardContextMenu';
import { CardViewDialog } from './CardViewDialog';
import { VariableFillDialog } from './VariableFillDialog';
import { PriorityButton } from './PriorityButton';
import { CommentCount } from './CommentCount';
import { SessionStatusBadge } from './SessionStatusBadge';
import { BuildStatusBadge } from './BuildStatusBadge';
import { SessionChecklist } from './SessionChecklist';
import { PromptBody } from './PromptBody';
import { TagPickerButton } from './TagPickerButton';

interface Props {
  boardId: string;
  listId: string;
  cardId: string;
  index: number;
  dragDisabled?: boolean;
}

export function PromptCard({
  boardId,
  listId,
  cardId,
  index,
  dragDisabled,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [filling, setFilling] = useState(false);

  const card = useDocStore(
    (s) =>
      s.doc?.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId) ?? null,
  );
  const recordCopy = useDocStore((s) => s.recordCopy);
  const setCardTags = useDocStore((s) => s.setCardTags);
  const updateCard = useDocStore((s) => s.updateCard);

  const focusCardId = useUiStore((s) => s.focusCardId);
  const setFocusCardId = useUiStore((s) => s.setFocusCardId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const usage = useCardUsage(cardId);
  const unread = useSessionStore((s) => s.unread[cardId] === true);
  const markRead = useSessionStore((s) => s.markRead);

  // Opening the card counts as reading it, and so does an update landing
  // while its dialog is already open.
  useEffect(() => {
    if (viewOpen && unread) markRead(cardId);
  }, [viewOpen, unread, cardId, markRead]);

  useEffect(() => {
    if (focusCardId !== cardId) return;
    scrollRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setExpanded(true);
    const timer = setTimeout(() => setFocusCardId(null), 1600);
    return () => clearTimeout(timer);
  }, [focusCardId, cardId, setFocusCardId]);

  if (!card) return null;

  const variableNames = extractVariables(card.prompt);
  const hasVariables = variableNames.length > 0;
  // An archived card is already done, so a due date it blew past before
  // being archived should no longer flag it on the board.
  const overdue = !card.archived && isOverdue(card.dueDate);

  const copy = async () => {
    await copyText(card.prompt);
    recordCopy(boardId, listId, cardId);
    toast.success('Prompt copied');
  };

  return (
    <Draggable draggableId={cardId} index={index} isDragDisabled={dragDisabled}>
      {(provided, snapshot) => (
        <CardContextMenu
          boardId={boardId}
          listId={listId}
          cardId={cardId}
          cardTitle={card.title}
        >
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            /*
            `data-card-color` is the hook globals.css keys the per-theme
            `--card-tint` / `--card-edge` custom properties off. Both are
            read here with the app's normal tokens as their fallback, so an
            uncolored card (no data attribute, therefore no override in
            scope) renders byte-identically to how it did before colors
            existed — one code path, not a colored and an uncolored branch.

            The variables are read through arbitrary values rather than
            per-color utility classes because Tailwind v4 only emits classes
            it can see in the source; a class name built from `card.color`
            at runtime would never be generated.
          */
            data-card-color={card.color ?? undefined}
            className={cn(
              'rounded-md border bg-[var(--card-tint,var(--card))] border-[var(--card-edge,var(--border))]',
              snapshot.isDragging ? 'shadow-lg ring-2 ring-ring' : 'shadow-sm',
              card.archived && 'opacity-70',
              // Paused cards get a dashed violet edge so they stand out on
              // the board at a glance. Overdue (below) still wins.
              card.paused &&
                'border-dashed border-violet-500 ring-1 ring-violet-500/40',
              // Cards Claude has updated since they were last opened get a
              // dashed green edge, mirroring paused. Paused (above) and
              // overdue (below) win.
              unread &&
                !card.paused &&
                'border-dashed border-emerald-500 ring-1 ring-emerald-500/40',
              // Overdue wins over any card color's edge tint — a passed
              // due date is a more urgent signal than a triage color.
              overdue && 'border-destructive ring-2 ring-destructive',
            )}
          >
            <div
              ref={scrollRef}
              onClick={() => setViewOpen(true)}
              className={
                focusCardId === cardId
                  ? 'cursor-pointer rounded-md ring-2 ring-ring'
                  : 'cursor-pointer'
              }
            >
              <div className="flex items-start gap-1 p-2">
                {/*
                Priority and session status stack vertically so a card with
                both keeps the same horizontal room for its title as a card
                with one. The stack is top-aligned and grows downward: two
                14px icons are taller than the 28px title row, so centering
                them would push the first icon above the title's first line.

                `pt-2` lands that first icon's top edge on the top of the
                title's text, and must stay in sync with the title's own
                `pt-1`: the title pads its first 20px line box down by a
                constant 4px, and glyph tops sit ~4px below that line box's
                top. Do not swap the title's `pt-1` back for `min-h-7
                items-center` — centering only offsets a title short enough to
                leave slack, so the first line jumps up 4px the moment it
                wraps to two lines and the icons no longer line up.

                PriorityButton is always present: an unset priority is an
                outline flag, while a set priority keeps its filled flag.
                Either state opens the same picker used by the view dialog.
              */}
                <div className="mr-1 flex shrink-0 flex-col items-center gap-0.5 pt-2">
                  <PriorityButton
                    value={card.priority}
                    ariaLabel={`Priority for ${card.title}`}
                    onChange={(next) =>
                      updateCard(boardId, listId, cardId, { priority: next })
                    }
                  />

                  <SessionStatusBadge cardId={cardId} paused={card.paused} />
                </div>

                {/*
                A native <button> here would be treated as an "interactive
                element" by @hello-pangea/dnd, which blocks a drag from ever
                starting on it — so a real drag gesture that begins on the
                title would silently do nothing. Using a plain div with a
                button role keeps the click-to-open and keyboard behavior
                while letting the library's normal move-distance threshold
                decide click vs. drag, same as everywhere else on the card.
              */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    setViewOpen(true);
                  }}
                  className="min-w-0 flex-1 cursor-pointer pt-1 text-left text-sm font-medium text-card-foreground"
                >
                  <span className="line-clamp-2">{card.title}</span>
                  {card.paused ? (
                    <span className="mt-0.5 block text-[11px] font-normal text-violet-500">
                      Paused
                    </span>
                  ) : null}
                  {card.archived ? (
                    <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                      Archived
                    </span>
                  ) : null}
                </div>

                {hasVariables ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Fill ${variableNames.length} variables and copy: ${card.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setFilling(true);
                    }}
                    className="h-7 shrink-0 px-1.5 font-mono text-[11px]"
                  >
                    {`{{${variableNames.length}}}`}
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Copy prompt: ${card.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void copy();
                    }}
                    className="size-7 shrink-0"
                  >
                    <Copy className="size-3.5" />
                  </Button>
                )}

                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={expanded ? 'Collapse prompt' : 'Expand prompt'}
                  aria-expanded={expanded}
                  onClick={(event) => {
                    event.stopPropagation();
                    setExpanded((open) => !open);
                  }}
                  className="size-7 shrink-0"
                >
                  {expanded ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </Button>
              </div>

              {/* Badges never compress (`shrink-0 whitespace-nowrap` on
                  TagBadge); when the row runs out of room the overflow
                  wraps onto a new line instead, and only then. */}
              <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
                {card.tags.map((name) => (
                  <TagBadge key={name} name={name} />
                ))}
                <TagPickerButton
                  selected={card.tags}
                  onChange={(next) =>
                    setCardTags(boardId, listId, cardId, next)
                  }
                />
                <CommentCount count={card.comments.length} />
                <BuildStatusBadge cardId={cardId} />
                {/* Always rendered, zero included: hiding it would make "this
                  card hasn't cost anything yet" indistinguishable from "this
                  card doesn't track cost" — same rationale as UsageSummary.
                  `ml-auto` pins it to the row's right edge whether or not a
                  tag is present to otherwise push it there; `shrink-0`
                  keeps it from compressing. */}
                <span
                  className="ml-auto shrink-0 text-xs font-medium text-muted-foreground tabular-nums"
                  title={formatUsageBreakdown(usage)}
                >
                  {formatUsd(usage.costUSD)}
                </span>
              </div>

              <div className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground">
                {card.dueDate ? (
                  <span
                    className={cn('font-medium', overdue && 'text-destructive')}
                  >
                    {overdue ? 'Overdue' : 'Due'} {formatDueDate(card.dueDate)}
                  </span>
                ) : null}
                {card.link ? (
                  <button
                    type="button"
                    aria-label="Open link"
                    onClick={(event) => {
                      event.stopPropagation();
                      api.shell.openExternal(card.link);
                    }}
                    className="hover:text-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                ) : null}
              </div>

              {expanded ? (
                <div className="border-t border-[var(--card-edge,var(--border))] px-2 py-2">
                  <PromptBody
                    prompt={card.prompt}
                    className="max-h-56 text-foreground"
                  />

                  {card.notes ? (
                    <p className="mt-2 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
                      {card.notes}
                    </p>
                  ) : null}

                  <SessionChecklist cardId={cardId} />

                  <Button
                    size="sm"
                    className="mt-2 w-full"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (hasVariables) {
                        setFilling(true);
                      } else {
                        void copy();
                      }
                    }}
                  >
                    <Copy className="size-3.5" />
                    {hasVariables ? 'Fill & copy' : 'Copy'}
                  </Button>
                </div>
              ) : null}
            </div>

            <CardViewDialog
              open={viewOpen}
              onOpenChange={setViewOpen}
              boardId={boardId}
              listId={listId}
              cardId={cardId}
            />

            {hasVariables ? (
              <VariableFillDialog
                open={filling}
                onOpenChange={setFilling}
                boardId={boardId}
                listId={listId}
                cardId={cardId}
              />
            ) : null}
          </div>
        </CardContextMenu>
      )}
    </Draggable>
  );
}
