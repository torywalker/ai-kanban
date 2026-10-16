import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react';
import {
  Archive,
  ArchiveRestore,
  Copy,
  Loader2,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AttachmentMeta } from '@shared/attachments';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { copyText } from '@/lib/clipboard';
import { useStickToBottom } from '@/lib/useStickToBottom';
import { useCardUsage } from '@/lib/useCardUsage';
import {
  ingestClipboardFallback,
  ingestFiles,
  ingestPasteEvent,
} from '@/lib/ingestImages';
import { cardAttachmentTarget } from '@/lib/cardAttachmentTarget';
import { substitute } from '@/domain/variables';
import {
  pendingReplySnapshot,
  pendingRunSnapshot,
} from '@/domain/sessionStartup';
import { sumLiveUsage } from '@shared/usage';
import {
  resolveUseWorktree,
  WORKTREE_MISSING_ERROR,
  type ShipChooserPlan,
  type ShipQueueSnapshot,
} from '@shared/worktree';
import { TagPicker } from '@/components/tags/TagPicker';
import { PriorityButton } from './PriorityButton';
import { CardColorButton } from './CardColorButton';
import { SessionTranscript } from './SessionTranscript';
import { UsageSummary } from './UsageSummary';
import { PromptBody } from './PromptBody';
import { CardComposerDialog } from './CardComposerDialog';
import { ImageAttachmentStrip } from './ImageAttachmentStrip';
import { ShipTargetDialog } from './ShipTargetDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  listId: string;
  cardId: string;
}

export function CardViewDialog({
  open,
  onOpenChange,
  boardId,
  listId,
  cardId,
}: Props) {
  const card = useDocStore(
    (s) =>
      s.doc?.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId) ?? null,
  );
  const board = useDocStore(
    (s) => s.doc?.boards.find((b) => b.id === boardId) ?? null,
  );
  const setCardSessionId = useDocStore((s) => s.setCardSessionId);
  const recordCopy = useDocStore((s) => s.recordCopy);
  const archiveCard = useDocStore((s) => s.archiveCard);
  const unarchiveCard = useDocStore((s) => s.unarchiveCard);
  const updateCard = useDocStore((s) => s.updateCard);
  const setCardTags = useDocStore((s) => s.setCardTags);
  const approvalMode = useDocStore((s) => s.approvalMode);
  const defaultModel = useDocStore((s) => s.defaultModel);
  const useWorktrees = useDocStore((s) => s.useWorktrees);
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  const expanded = useUiStore((s) => s.cardDialogExpanded[cardId] ?? false);
  // Lifetime totals for this card, not just the live session's: the ledger
  // behind them outlives any one daemon, so a card reopened after a relaunch
  // still reports everything it has ever cost.
  const usage = useCardUsage(cardId);
  /**
   * The turn in flight, in tokens. Read straight off the snapshot the daemon
   * already broadcasts on every change, so the figure moves as the agent
   * works rather than only when the turn lands — the ledger cannot help here
   * because a row is written only once a turn produces its `result`.
   */
  const liveUsage = sumLiveUsage(snapshot?.liveUsage);
  const setCardDialogExpanded = useUiStore((s) => s.setCardDialogExpanded);
  const setExpanded = (next: boolean) => setCardDialogExpanded(cardId, next);
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<AttachmentMeta[]>(
    [],
  );
  const [shipPlan, setShipPlan] = useState<ShipChooserPlan | null>(null);
  const [shipTargetOpen, setShipTargetOpen] = useState(false);
  const [shipQueue, setShipQueue] = useState<ShipQueueSnapshot | null>(null);
  const [shipPending, setShipPending] = useState(false);
  const shipCancelledByUser = useRef(false);
  const shipPlanRequestId = useRef(0);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The transcript pins itself to its own newest entry, but that only helps
   * if the transcript is on screen: everything in this dialog shares one
   * scroll region, and on a short window the prompt alone can fill it, so
   * a card opened mid-session showed the prompt the user already knows
   * with the agent's latest message below the fold. Following the bottom
   * here puts the conversation and the reply box in view on open, and
   * keeps them there as the agent talks — the same place a chat window
   * opens.
   *
   * Gated on having a session: with no transcript, the body's content is a
   * prompt to be read from the top, and scrolling past it would hide the
   * very thing the card is.
   *
   * Also gated on NOT being expanded. In the expanded layout the body stops
   * scrolling altogether and the transcript's feed becomes the scroll
   * container (see `chatExpanded` below), so there is no body offset left to
   * follow — the transcript's own `feedRef` does that job instead.
   */
  const bodyRef = useStickToBottom<HTMLDivElement>(!!snapshot && !expanded);

  useEffect(() => {
    if (!open) {
      setShipQueue(null);
      setShipTargetOpen(false);
      return undefined;
    }

    let disposed = false;
    const containsCard = (next: ShipQueueSnapshot) =>
      next.active?.cardId === cardId ||
      next.waiters.some((waiter) => waiter.cardId === cardId);
    const applyStatus = (next: ShipQueueSnapshot) => {
      setShipQueue((current) => {
        if (containsCard(next)) return next;
        return current?.repoKey === next.repoKey ? null : current;
      });
    };

    const unsubscribe = api.git.onShipStatus(applyStatus);
    void api.git.shipStatusGet(cardId).then((current) => {
      // A null response may have been read just before a newer queue event
      // arrived. Initial/closed state is already null, so only a positive
      // hydration should write and potentially race that event.
      if (!disposed && current) setShipQueue(current);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [open, cardId]);

  // `api.session.run`/`reply` are fire-and-forget over IPC — the daemon
  // discovers the real session id asynchronously (from the SDK's own
  // `system`/`init` message) and reports it through the snapshot broadcast,
  // not through run()'s return value. This effect is what actually persists
  // it onto the card, so Task 9's reattach-on-relaunch has something to
  // look up later. Guarded so it only writes when the id genuinely changes,
  // not on every snapshot (checklist updates would otherwise cause a
  // document write, and an undo step, on every tool call).
  useEffect(() => {
    if (snapshot?.sessionId && snapshot.sessionId !== card?.sessionId) {
      setCardSessionId(boardId, listId, cardId, snapshot.sessionId);
    }
  }, [
    snapshot?.sessionId,
    card?.sessionId,
    boardId,
    listId,
    cardId,
    setCardSessionId,
  ]);

  const primary = card?.sessionRepo ?? board?.defaultRepo ?? null;
  const cwd = card?.sessionWorktree?.path ?? primary;
  const model = card?.sessionModel ?? defaultModel ?? null;
  const useWorktree = resolveUseWorktree(
    card?.useWorktree ?? null,
    useWorktrees,
  );
  /**
   * A turn is in flight for BOTH `working` and `waiting`. While the daemon
   * sits inside `canUseTool` awaiting an Approve/Deny it has not finished
   * the turn — `turnActive` is still set — so its in-flight guard
   * (`canStartTurn`/`rejectTurnSnapshot` in turnLifecycle.ts) refuses any
   * `run`/`reply` for the card. `waiting` used to be unreachable in
   * practice (bare `allowedTools` entries pre-authorised every tool), which
   * is why the reply box was left live there; now that every tool call
   * pauses at `waiting`, treating it as "sendable" meant a user's reply was
   * silently discarded on the daemon side. The answer to `waiting` is
   * Approve/Deny in the transcript above, not free text.
   */
  const turnInFlight =
    snapshot?.status === 'working' || snapshot?.status === 'waiting';
  const queuedForShip =
    shipQueue?.active?.cardId === cardId ||
    shipQueue?.waiters.some((waiter) => waiter.cardId === cardId) === true;
  const shipBusy = shipPending || queuedForShip;
  const controlsBusy = turnInFlight || shipBusy;
  // Only the agent's own turn gets the inline reply-box spinner — ship and
  // waiting-on-approval have their own explanatory text below instead.
  const isAgentWorking = !shipBusy && snapshot?.status === 'working';
  const canRun = !controlsBusy;
  const canSendReply =
    !!snapshot && !controlsBusy && !!cwd && reply.trim().length > 0;
  const canShowShip =
    useWorktree && !!card?.sessionWorktree && !!snapshot && !turnInFlight;

  useEffect(() => {
    const requestId = ++shipPlanRequestId.current;
    if (!open || !canShowShip || !primary || !card?.sessionWorktree) {
      setShipPlan(null);
      return undefined;
    }

    let disposed = false;
    void api.git
      .shipPlan(primary, card.sessionWorktree.recordedTargetBranch)
      .then((result) => {
        if (!disposed && requestId === shipPlanRequestId.current) {
          setShipPlan(result.ok ? result.value : null);
        }
      });
    return () => {
      disposed = true;
    };
  }, [open, canShowShip, primary, card?.sessionWorktree?.recordedTargetBranch]);

  if (!card) return null;
  /**
   * Expanding only rearranges the scroll regions when there is actually a
   * transcript to give the room to. Growing the dialog is not enough on its
   * own: the feed carries its own `max-h-64` ceiling, so the extra height
   * would land in the gap below the chat rather than in it. The fix is to
   * move the scroll role from the body down to the feed — but that is only
   * safe with a session on screen. On a card with no session the body still
   * holds a prompt that can overflow by itself, and handing off its
   * `overflow-y-auto` unconditionally would leave that prompt unreachable
   * with no inner scroller to replace it.
   */
  const chatExpanded = expanded && !!snapshot;

  /**
   * Every session IPC call can reject before any daemon event exists: if
   * `ensureDaemonRunning()` fails to spawn or connect, the rejection comes
   * straight back through `api.session.*` and no snapshot will ever arrive
   * to explain it. Synthesizing a local `failed` snapshot puts the real
   * error in the transcript's existing error box immediately, instead of
   * the silent hang spec §7 forbids.
   */
  const reportFailure = (error: unknown) => {
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: snapshot?.sessionId ?? card.sessionId,
      status: 'failed',
      checklist: snapshot?.checklist ?? [],
      messages: snapshot?.messages ?? [],
      pendingApproval: snapshot?.pendingApproval ?? null,
      lastError: error instanceof Error ? error.message : String(error),
    });
  };

  const run = async () => {
    if (!primary || !card.prompt.trim()) return;
    // Before the await, not after: the point is to have something on screen
    // for the whole gap until the daemon's first broadcast arrives.
    useSessionStore.getState().applySnapshot(pendingRunSnapshot(cardId));
    try {
      let runCwd = primary;
      if (useWorktree) {
        const ensured = await api.git.ensureWorktree(
          cardId,
          primary,
          card.sessionWorktree,
        );
        if (!ensured.ok) throw new Error(ensured.error);
        updateCard(boardId, listId, cardId, {
          sessionWorktree: ensured.value,
        });
        runCwd = ensured.value.path;
      }
      await api.session.run(
        cardId,
        substitute(card.prompt, card.variables),
        runCwd,
        approvalMode,
        model,
        card.attachments.map((attachment) => ({ ...attachment, cardId })),
      );
    } catch (error) {
      reportFailure(error);
    }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    // Mirrors `run`'s guard: a reply with no working directory would make
    // the daemon fall back to its own inherited cwd.
    if (!cwd) return;
    // Belt-and-braces with the disabled Send/input above: a reply dispatched
    // while a turn is in flight is refused by the daemon (`canStartTurn`)
    // and the promise still resolves, so dispatching one anyway would clear
    // the user's text for a message that never arrived.
    if (controlsBusy) return;
    // Same reason as `run`'s local write, plus one specific to a reply:
    // the typed text is otherwise absent from the conversation until the
    // daemon echoes it back, so a slow start looked like a lost message.
    // Only written when there is already a session to append to — with no
    // snapshot there is no reply box to have typed into.
    if (snapshot) {
      useSessionStore
        .getState()
        .applySnapshot(pendingReplySnapshot(snapshot, reply.trim()));
    }
    try {
      // `card.sessionId` (not `snapshot.sessionId`) — the persisted value,
      // so the daemon can resume the real Claude conversation even if it
      // has no live in-memory record for this card at all (see
      // daemonProtocol.ts's `reply` op for why).
      await api.session.reply(
        cardId,
        reply.trim(),
        cwd,
        approvalMode,
        model,
        card.sessionId,
        replyAttachments.map((attachment) => ({ ...attachment, cardId })),
      );
      setReply('');
      setReplyAttachments([]);
    } catch (error) {
      reportFailure(error);
    }
  };

  const stop = async () => {
    shipCancelledByUser.current = true;
    try {
      const [cancelled] = await Promise.all([
        api.git.shipCancel(cardId),
        api.session.stop(cardId),
      ]);
      if (!cancelled.ok) {
        reportFailure(new Error(cancelled.error));
      }
    } catch (error) {
      reportFailure(error);
    }
  };

  const shipInto = async (destinationBranch: string) => {
    if (!primary || !card.sessionWorktree || shipBusy) return;
    setShipTargetOpen(false);
    setShipPending(true);
    shipCancelledByUser.current = false;
    try {
      const result = await api.git.ship({
        cardId,
        title: card.title,
        primary,
        worktree: card.sessionWorktree,
        destinationBranch,
        sessionId: card.sessionId,
        approvalMode,
        model,
      });
      if (!result.ok) {
        if (result.error === WORKTREE_MISSING_ERROR) {
          updateCard(boardId, listId, cardId, { sessionWorktree: null });
        }
        if (
          !shipCancelledByUser.current ||
          result.error !== 'Ship cancelled.'
        ) {
          toast.error(result.error);
        }
        return;
      }
      updateCard(boardId, listId, cardId, { sessionWorktree: null });
      setShipQueue(null);
      toast.success('Shipped');
    } catch (error) {
      if (error instanceof Error && error.message === WORKTREE_MISSING_ERROR) {
        updateCard(boardId, listId, cardId, { sessionWorktree: null });
      }
      if (!shipCancelledByUser.current) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    } finally {
      setShipPending(false);
    }
  };

  const requestShip = async () => {
    if (!primary || !card.sessionWorktree || shipBusy) return;
    const requestId = ++shipPlanRequestId.current;
    setShipPending(true);
    try {
      const result = await api.git.shipPlan(
        primary,
        card.sessionWorktree.recordedTargetBranch,
      );
      if (!result.ok) {
        toast.error(result.error);
        setShipPending(false);
        return;
      }
      if (requestId !== shipPlanRequestId.current) {
        setShipPending(false);
        return;
      }
      setShipPlan(result.value);
      if (result.value.kind === 'direct') {
        await shipInto(result.value.destination);
      } else if (result.value.kind === 'blocked') {
        toast.error(result.value.message);
        setShipPending(false);
      } else {
        setShipPending(false);
        setShipTargetOpen(true);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setShipPending(false);
    }
  };

  const waitingBehind =
    shipQueue?.waiters.some((waiter) => waiter.cardId === cardId) &&
    shipQueue.active?.cardId !== cardId
      ? shipQueue.active
      : null;
  const shipHelper = waitingBehind
    ? `Waiting to ship (behind “${waitingBehind.title}”)`
    : shipBusy
      ? 'Shipping…'
      : shipPlan && shipPlan.kind !== 'direct' && shipPlan.kind !== 'blocked'
        ? 'You’ll pick which branch to merge into.'
        : null;
  const choicePlan =
    shipPlan && shipPlan.kind !== 'direct' && shipPlan.kind !== 'blocked'
      ? shipPlan
      : null;

  const copy = async () => {
    await copyText(card.prompt);
    recordCopy(boardId, listId, cardId);
    toast.success('Prompt copied');
  };

  const archive = () => {
    if (card.archived) {
      unarchiveCard(boardId, listId, cardId);
    } else {
      archiveCard(boardId, listId, cardId);
    }
    onOpenChange(false);
  };

  // Resolved against the store as each ingest lands rather than against this
  // render's `card.attachments`, so two overlapping pastes/drops both survive
  // and the cap counts what the card really holds. See
  // cardAttachmentTarget.ts.
  const cardIngestTarget = cardAttachmentTarget(boardId, listId, cardId);
  const replyAttachmentTarget = {
    cardId,
    currentCount: replyAttachments.length,
    onAdded: (added: AttachmentMeta[]) =>
      setReplyAttachments((current) => [...current, ...added]),
  };

  const isReplySurface = (target: EventTarget | null) =>
    target === replyInputRef.current ||
    document.activeElement === replyInputRef.current;

  const handlePaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const target = isReplySurface(event.target)
      ? replyAttachmentTarget
      : cardIngestTarget;
    void ingestPasteEvent(event, target).then(
      async ({ hadImages, hadText }) => {
        if (!hadImages && !hadText) {
          await ingestClipboardFallback(target);
        }
      },
    );
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    const target = isReplySurface(event.target)
      ? replyAttachmentTarget
      : cardIngestTarget;
    void ingestFiles(Array.from(event.dataTransfer.files), target);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        className={cn(
          'flex flex-col',
          // Expanded uses a fixed `h-` and not merely a taller `max-h-`: a
          // max-height alone lets the box shrink back to its content, so a
          // short transcript would keep the chat cramped in a dialog the
          // user just asked to be big. A fixed height guarantees the room
          // is there for the feed to flex into as the agent talks.
          expanded
            ? 'h-[92vh] max-h-[92vh] sm:max-w-[92vw]'
            : 'max-h-[85vh] sm:max-w-2xl',
        )}
      >
        {/*
          `shrink-0` on both header and footer: without it, a flex child
          with an explicit `flex-1`/`flex-basis: 0` (the scrollable middle
          region below) does not automatically protect its siblings from
          being squeezed first — the browser's flex-shrink distribution
          weighs by flex-basis, and a 0-basis item is assigned none of the
          shrink burden by default, so header/footer would absorb it
          first. Pinning both to their natural size guarantees the middle
          region is always what shrinks (and scrolls) when content
          exceeds the 85vh cap, not the title or the Run/Reply controls.
        */}
        {/* `pr-16` reserves the top-right corner: the title is free-form
            card text and would otherwise run under the expand and close
            buttons sitting above it. */}
        <DialogHeader className="shrink-0 pr-16">
          <DialogTitle>{card.title}</DialogTitle>
        </DialogHeader>

        {/*
          Positioned absolutely rather than placed in the header flow,
          because `DialogHeader` is a vertical stack (the button would land
          under the title) and its neighbour — Radix's own close button,
          rendered by `DialogContent` itself at `top-4 right-4` — is not
          something this component can wrap in a shared row. `right-10`
          leaves a deliberate gap between the two so neither is misclicked.

          An icon-only button, so it carries an explicit `aria-label` that
          also names the action's result rather than the current state
          ("Expand", not "Expanded") — that is what a screen reader user
          needs to decide whether to press it.
        */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3.5 right-10 text-muted-foreground hover:text-foreground"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </Button>

        <div
          ref={bodyRef}
          data-slot="dialog-body"
          className={cn(
            'flex min-h-0 flex-1 flex-col gap-4 pr-1',
            // Exactly one of these two regions scrolls. Collapsed, it is
            // the body (one region for prompt + notes + transcript +
            // reply). Expanded, the body is frozen and the transcript's
            // feed scrolls instead, so the conversation — not the prompt
            // above it — is what the new height belongs to.
            chatExpanded ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          <div className="flex items-center gap-2">
            {/* Writes straight through rather than waiting for a Save:
                priority, color, and tags are glance-able markers, and this
                dialog is where a card is read, so making them a trip
                through the composer would be the slow path for the
                fastest edits on the card. */}
            <PriorityButton
              value={card.priority}
              onChange={(next) =>
                updateCard(boardId, listId, cardId, { priority: next })
              }
            />
            <CardColorButton
              value={card.color}
              onChange={(next) =>
                updateCard(boardId, listId, cardId, { color: next })
              }
            />
            <div className="min-w-0 flex-1">
              <TagPicker
                selected={card.tags}
                onChange={(next) => setCardTags(boardId, listId, cardId, next)}
              />
            </div>
            {/*
              Shares the badge row rather than occupying one of its own, and
              right-aligned into the row's free space: cost is a standing
              fact about the card like its priority and tags, and the row
              already exists at the top of the dialog where a glance lands.
              Its own `ml-auto` does the aligning.
            */}
            <UsageSummary totals={usage} live={liveUsage} />
          </div>

          <PromptBody
            prompt={card.prompt}
            className="max-h-40 rounded-md bg-muted p-3"
          />

          <ImageAttachmentStrip
            cardId={cardId}
            items={card.attachments}
            onChange={(next) =>
              updateCard(boardId, listId, cardId, { attachments: next })
            }
          />

          {/*
            Rendered only when non-empty. `notes` is optional on most cards
            (schema defaults it to ''), and an always-present empty block
            would push the transcript — the part of this dialog that actually
            changes while a session runs — further down for no gain.
          */}
          {card.notes ? (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">
                Notes
              </h3>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm">
                {card.notes}
              </p>
            </div>
          ) : null}

          {!cwd ? (
            <p className="text-xs text-muted-foreground">
              No working directory set — set a default repo on this board, or
              override it on this card, before running.
            </p>
          ) : null}

          <SessionTranscript cardId={cardId} expanded={chatExpanded} />

          {/*
            Shown for the whole life of a session, not only while a turn is
            streaming. The reply box is only ever *usable* between turns —
            the daemon refuses a reply that would start a second concurrent
            turn — so rendering it only during `working`/`waiting` (as
            before) made it a control that could never legitimately be
            used. Here it is live once the turn ends (`done`/`failed`),
            which is the "text box to send a reply (the next turn)" spec §6
            asks for, and visibly disabled with a reason while a turn is in
            flight. Stop stays scoped to an in-flight turn.
          */}
          {snapshot ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <div className="relative flex-1">
                  {isAgentWorking ? (
                    <Loader2
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-sky-500"
                    />
                  ) : null}
                  <Textarea
                    ref={replyInputRef}
                    value={reply}
                    disabled={controlsBusy}
                    onChange={(event) => setReply(event.target.value)}
                    placeholder="Reply to the agent…"
                    rows={1}
                    className={`min-h-9 max-h-40 resize-none ${isAgentWorking ? 'pl-8' : ''}`}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter') return;
                      // Shift/Alt+Enter keep the textarea's newline. Bare
                      // Enter is send — unless an IME is still converting
                      // (Enter confirms the candidate there, not the message).
                      if (event.shiftKey || event.altKey) return;
                      if (
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      ) {
                        return;
                      }
                      event.preventDefault();
                      if (canSendReply) void sendReply();
                    }}
                  />
                </div>
                <Button onClick={sendReply} disabled={!canSendReply}>
                  Send
                </Button>
                {turnInFlight || shipBusy ? (
                  <Button variant="destructive" onClick={stop}>
                    Stop
                  </Button>
                ) : null}
              </div>
              <ImageAttachmentStrip
                cardId={cardId}
                items={replyAttachments}
                onChange={setReplyAttachments}
                disabled={controlsBusy}
              />
              {shipBusy || snapshot.status === 'waiting' ? (
                <p className="text-xs text-muted-foreground">
                  {shipBusy
                    ? 'Ship is in progress — stop it before replying.'
                    : 'Approve or deny the request above before replying — the agent can’t accept a message while a tool request is pending.'}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
          <div className="flex gap-2 sm:mr-auto">
            <Button variant="ghost" onClick={archive}>
              {card.archived ? (
                <ArchiveRestore className="size-3.5" />
              ) : (
                <Archive className="size-3.5" />
              )}
              {card.archived ? 'Unarchive' : 'Archive'}
            </Button>
            <Button variant="ghost" onClick={() => void copy()}>
              <Copy className="size-3.5" />
              Copy
            </Button>
          </div>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {canShowShip ? (
            <div className="flex min-w-0 flex-col items-end gap-0.5">
              <Button onClick={requestShip} disabled={shipBusy}>
                Ship
              </Button>
              {shipHelper ? (
                <span
                  className="max-w-56 text-right text-[11px] text-muted-foreground"
                  title={
                    shipPlan?.kind === 'direct'
                      ? shipPlan.destination
                      : undefined
                  }
                >
                  {shipHelper}
                </span>
              ) : null}
            </div>
          ) : null}
          {canRun ? (
            <Button onClick={run} disabled={!primary || !card.prompt.trim()}>
              {snapshot ? 'Run again' : 'Run'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>

      <CardComposerDialog
        open={editing}
        onOpenChange={setEditing}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />
      <ShipTargetDialog
        open={shipTargetOpen}
        onOpenChange={setShipTargetOpen}
        plan={choicePlan}
        onSelect={(branch) => void shipInto(branch)}
      />
    </Dialog>
  );
}
