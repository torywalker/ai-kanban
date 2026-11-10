import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
} from 'react';
import {
  Archive,
  Pause,
  Play,
  ArchiveRestore,
  ChevronRightIcon,
  Copy,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquare,
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
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useConfirm } from '@/components/common/useConfirm';
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
import type { LiveTokenUsage } from '@shared/daemonProtocol';
import { resolveSessionEngine } from '@shared/sessionEngine';
import {
  resolveUseWorktree,
  NOTHING_TO_SHIP_ERROR,
  WORKTREE_MISSING_ERROR,
  type ShipChooserPlan,
  type ShipQueueSnapshot,
} from '@shared/worktree';
import { TagPicker } from '@/components/tags/TagPicker';
import { PriorityButton } from './PriorityButton';
import { CardColorButton } from './CardColorButton';
import { SessionLastError } from './SessionLastError';
import { CommentsPanel } from './CommentsPanel';
import { SessionTranscript } from './SessionTranscript';
import { TerminalPanel } from './TerminalPanel';
import { BackgroundTasksIndicator } from './BackgroundTasksIndicator';
import { relativeTime } from '@/lib/relativeTime';
import { formatCommentTime } from './CommentItem';
import { UsageSummary } from './UsageSummary';
import { WorktreeBadge } from './WorktreeBadge';
import { EMPTY_PROMPT_PLACEHOLDER, PromptBody } from './PromptBody';
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
  const sessionEngine = useDocStore((s) => s.sessionEngine);
  const claudeCliPath = useDocStore((s) => s.claudeCliPath);
  const hasSession = useSessionStore((s) => s.sessions[cardId] !== undefined);
  const sessionStatus = useSessionStore((s) => s.sessions[cardId]?.status);
  const lastError = useSessionStore(
    (s) => s.sessions[cardId]?.lastError ?? null,
  );
  const sessionId = useSessionStore(
    (s) => s.sessions[cardId]?.sessionId ?? null,
  );
  const shellAlive =
    useSessionStore((s) => s.sessions[cardId]?.terminal?.shellAlive) === true;
  // A foreground program the hooks never reported, e.g. a hand-attached Claude.
  const foregroundBusy =
    useSessionStore((s) => s.sessions[cardId]?.terminal?.foregroundBusy) ===
    true;
  const claudeRunning =
    useSessionStore((s) => s.sessions[cardId]?.terminal?.claudeRunning) ===
    true;
  const snapshotEngine = useSessionStore((s) => s.sessions[cardId]?.engine);
  // An open Claude that is sitting at its prompt is not editing the
  // worktree, so Ship can run. A turn still in progress, including one
  // paused on a permission prompt, is.
  const claudeTurnActive =
    snapshotEngine === 'terminal' &&
    (sessionStatus === 'working' || sessionStatus === 'waiting');
  const expansionPref = useUiStore((s) => s.cardDialogExpanded[cardId]);
  const commentsOpen = useUiStore((s) => s.commentsOpen[cardId] ?? false);
  const setCommentsOpen = useUiStore((s) => s.setCommentsOpen);
  // The card whose comments panel was just opened by the user. Only that
  // transition focuses the add box; a dialog that merely opens onto an
  // already-open panel must not steal focus.
  const [focusCommentsFor, setFocusCommentsFor] = useState<string | null>(null);
  useEffect(() => {
    if (!open) setFocusCommentsFor(null);
  }, [open]);
  const toggleComments = () => {
    setFocusCommentsFor(commentsOpen ? null : cardId);
    setCommentsOpen(cardId, !commentsOpen);
  };
  const promptCollapsed = useUiStore((s) => s.promptCollapsed[cardId] ?? true);
  const setPromptCollapsed = useUiStore((s) => s.setPromptCollapsed);
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
  const liveUsageKey = useSessionStore((s) => {
    const totals = sumLiveUsage(s.sessions[cardId]?.liveUsage);
    return [
      totals.inputTokens,
      totals.outputTokens,
      totals.cacheReadInputTokens,
      totals.cacheCreationInputTokens,
    ].join(',');
  });
  const liveUsage = useMemo((): LiveTokenUsage => {
    const [
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    ] = liveUsageKey.split(',').map(Number);
    return {
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    };
  }, [liveUsageKey]);
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
  const [closeTerminalOpen, setCloseTerminalOpen] = useState(false);
  const shipCancelledByUser = useRef(false);
  const shipPlanRequestId = useRef(0);
  const replyInputRef = useRef<HTMLTextAreaElement>(null);
  // Filled in each render once the handlers exist (they sit below the
  // `!card` early return); the keydown listener reads it so it never goes
  // stale and never has to re-subscribe.
  const shortcutsRef = useRef<Record<string, () => void>>({});
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
  const queuedForShip =
    shipQueue?.active?.cardId === cardId ||
    shipQueue?.waiters.some((waiter) => waiter.cardId === cardId) === true;
  const shipBusy = shipPending || queuedForShip;
  const resolvedEngine = resolveSessionEngine(
    card?.sessionEngine ?? null,
    sessionEngine,
    window.electron?.platform ?? '',
  );
  // A Ship conflict turn is an SDK snapshot on a terminal card, and its
  // Approve/Deny lives only in the transcript. Ship being busy is not
  // itself a turn: a plain merge leaves the terminal on screen.
  const sdkTurnActive =
    snapshotEngine !== 'terminal' &&
    (sessionStatus === 'working' || sessionStatus === 'waiting');
  const terminalMode =
    !sdkTurnActive && (shellAlive || resolvedEngine === 'terminal');
  // A terminal opens large until the user chooses otherwise. Forcing it
  // large made Collapse a no-op, because the choice was never consulted.
  const layoutExpanded = expansionPref ?? terminalMode;
  const bodyRef = useStickToBottom<HTMLDivElement>(
    hasSession && !layoutExpanded,
  );

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
    if (sessionId && sessionId !== card?.sessionId) {
      setCardSessionId(boardId, listId, cardId, sessionId);
    }
  }, [sessionId, card?.sessionId, boardId, listId, cardId, setCardSessionId]);

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
    sessionStatus === 'working' || sessionStatus === 'waiting';
  // Paused is a user-set parking flag: it locks the same controls a running
  // turn does (reply, Run, Re-connect, Ship) without touching the session.
  const paused = card?.paused === true;
  const controlsBusy = turnInFlight || shipBusy || paused;
  // Only the agent's own turn gets the inline reply-box spinner — ship and
  // waiting-on-approval have their own explanatory text below instead.
  const isAgentWorking = !shipBusy && sessionStatus === 'working';
  const canRun = !controlsBusy;
  const canSendReply =
    hasSession && !controlsBusy && !!cwd && reply.trim().length > 0;
  // Shipping into the branch this app itself runs from can reload the
  // renderer and drop the in-memory session. The record on the card says the
  // merge landed, so Delete worktree must not depend on a live session.
  const worktreeShipped = card?.sessionWorktree?.shipped === true;
  const canShowShip =
    useWorktree &&
    !!card?.sessionWorktree &&
    (worktreeShipped || (hasSession && (!turnInFlight || claudeRunning)));

  // A new agent turn may add commits the earlier Ship did not carry, so the
  // card goes back to offering Ship rather than only Delete worktree.
  useEffect(() => {
    if (!worktreeShipped || !turnInFlight || shipBusy) return;
    const current = card?.sessionWorktree;
    if (!current) return;
    updateCard(boardId, listId, cardId, {
      sessionWorktree: { ...current, shipped: false },
    });
  }, [
    worktreeShipped,
    turnInFlight,
    shipBusy,
    card?.sessionWorktree,
    updateCard,
    boardId,
    listId,
    cardId,
  ]);

  useEffect(() => {
    const requestId = ++shipPlanRequestId.current;
    if (
      !open ||
      !canShowShip ||
      claudeTurnActive ||
      !primary ||
      !card?.sessionWorktree
    ) {
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
  }, [
    open,
    canShowShip,
    claudeTurnActive,
    primary,
    card?.sessionWorktree?.recordedTargetBranch,
  ]);

  // Cmd+W closes a terminal card's dialog, even from inside the terminal.
  // Capture phase, so xterm never sees it. The window menu no longer binds
  // Cmd+W, which is what lets the page receive it.
  const terminalModeRef = useRef(false);
  terminalModeRef.current = terminalMode;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'w') return;
      if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return;
      }
      if (!terminalModeRef.current) return;
      // A nested dialog (composer, confirm, ship target) owns the keyboard.
      if (
        document.querySelectorAll('[role="dialog"][data-state="open"]').length >
        1
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onOpenChangeRef.current(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.ctrlKey || event.altKey) return;
      // Run is Cmd+Shift+R; every other shortcut here is Cmd+<key> alone.
      if (event.shiftKey !== (event.key.toLowerCase() === 'r')) return;
      const action = shortcutsRef.current[event.key.toLowerCase()];
      if (!action) return;
      // Cmd+C/A belong to the terminal (interrupt, readline) and to text
      // fields (line start, copy) when focus is there.
      const target = event.target as HTMLElement | null;
      // Cmd+J has no terminal meaning, and it has to toggle the comments
      // panel from the very box it focuses when it opens, so it works
      // everywhere. Cmd+Shift+R (run) has none either. Cmd+E (edit) also
      // works from the terminal, but still defers to text fields.
      const key = event.key.toLowerCase();
      const blocked =
        key === 'j' || key === 'r'
          ? null
          : key === 'e'
            ? // xterm's hidden input is a textarea inside the terminal host.
              ':is(input, textarea, [contenteditable="true"]):not([data-terminal-host] *)'
            : '[data-terminal-host], input, textarea, [contenteditable="true"]';
      if (blocked && target?.closest(blocked)) {
        return;
      }
      // A nested dialog (composer, confirm, ship target) owns the keyboard.
      if (
        document.querySelectorAll('[role="dialog"][data-state="open"]').length >
        1
      ) {
        return;
      }
      // Cmd+C with a selection is the user copying that text, not the prompt.
      if (
        event.key.toLowerCase() === 'c' &&
        window.getSelection()?.toString()
      ) {
        return;
      }
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

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
  const chatExpanded = layoutExpanded && (hasSession || terminalMode);
  const resumeSessionId = sessionId ?? card.sessionId;
  // Claude has exited, but its session is still on the card. Re-connect
  // resumes that session instead of submitting the prompt again.
  const canReconnect =
    terminalMode &&
    !claudeRunning &&
    !claudeTurnActive &&
    !(shellAlive && foregroundBusy) &&
    !shipBusy &&
    !!resumeSessionId &&
    (shellAlive || canRun);
  // A collapsed terminal still needs a fixed height. Max-height alone lets
  // the dialog shrink to its content, and this content is a flex child with
  // no height of its own, so the pty would have nothing to fill.
  // The open comments column widens the collapsed dialog by its own width
  // (`w-72` + the dialog's gap) instead of squeezing the main content.
  const collapsedWidth = commentsOpen
    ? 'sm:max-w-[calc(42rem+19rem)]'
    : 'sm:max-w-2xl';
  const dialogSize = layoutExpanded
    ? 'h-[92vh] max-h-[92vh] sm:max-w-[92vw]'
    : `max-h-[85vh] ${collapsedWidth}`;
  const sizedDialog =
    terminalMode && !layoutExpanded
      ? `h-[85vh] max-h-[85vh] ${collapsedWidth}`
      : dialogSize;
  // The content column and the comments column cap at the dialog's own
  // content height (its max-height minus `p-6` top and bottom), so the body
  // still shrinks and scrolls inside them as it did when it was the dialog.
  const columnMax = layoutExpanded
    ? 'max-h-[calc(92vh-3rem)]'
    : 'max-h-[calc(85vh-3rem)]';

  /**
   * Every session IPC call can reject before any daemon event exists: if
   * `ensureDaemonRunning()` fails to spawn or connect, the rejection comes
   * straight back through `api.session.*` and no snapshot will ever arrive
   * to explain it. Synthesizing a local `failed` snapshot puts the real
   * error in the transcript's existing error box immediately, instead of
   * the silent hang spec §7 forbids.
   */
  const reportFailure = (error: unknown) => {
    const current = useSessionStore.getState().sessions[cardId];
    useSessionStore.getState().applySnapshot({
      cardId,
      sessionId: current?.sessionId ?? card.sessionId,
      status: 'failed',
      checklist: current?.checklist ?? [],
      messages: current?.messages ?? [],
      pendingApproval: current?.pendingApproval ?? null,
      lastError: error instanceof Error ? error.message : String(error),
    });
  };

  const run = async () => {
    if (!primary || !card.prompt.trim()) return;
    // Before the await, not after: the point is to have something on screen
    // for the whole gap until the daemon's first broadcast arrives.
    // Skipped for a terminal: that placeholder has no `engine`, and writing
    // it would replace a terminal snapshot the dialog is still showing.
    if (!terminalMode) {
      useSessionStore.getState().applySnapshot(pendingRunSnapshot(cardId));
    }
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
          usedWorktree: true,
        });
        runCwd = ensured.value.path;
      } else {
        updateCard(boardId, listId, cardId, { usedWorktree: false });
      }
      if (terminalMode) {
        await window.electron?.terminal?.start({
          cardId,
          cwd: runCwd,
          prompt: substitute(card.prompt, card.variables),
          model,
          approvalMode,
          sessionId: sessionId ?? card.sessionId,
          claudeCliPath,
          images: card.attachments.map((attachment) => ({
            ...attachment,
            cardId,
          })),
          cols: 120,
          rows: 32,
        });
        return;
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
      // The transcript that normally shows this error is not on screen.
      if (terminalMode) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
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
    const current = useSessionStore.getState().sessions[cardId];
    if (current) {
      useSessionStore
        .getState()
        .applySnapshot(pendingReplySnapshot(current, reply.trim()));
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
      const stopTurn = claudeRunning
        ? (window.electron?.terminal?.interrupt(cardId) ?? Promise.resolve())
        : api.session.stop(cardId);
      const [cancelled] = await Promise.all([
        api.git.shipCancel(cardId),
        stopTurn,
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
        if (result.error === NOTHING_TO_SHIP_ERROR) {
          // Nothing landed, but the button should now offer Delete worktree.
          updateCard(boardId, listId, cardId, {
            sessionWorktree: { ...card.sessionWorktree, shipped: true },
          });
          toast.info(result.error);
          return;
        }
        if (
          !shipCancelledByUser.current ||
          result.error !== 'Ship cancelled.'
        ) {
          toast.error(result.error);
        }
        return;
      }
      updateCard(boardId, listId, cardId, {
        sessionWorktree: { ...card.sessionWorktree, shipped: true },
        lastShippedAt: new Date().toISOString(),
      });
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

  const deleteWorktree = async () => {
    if (!primary || !card.sessionWorktree || shipBusy) return;
    setShipPending(true);
    try {
      const result = await api.git.removeWorktree(
        cardId,
        primary,
        card.sessionWorktree,
      );
      if (!result.ok && result.error !== WORKTREE_MISSING_ERROR) {
        toast.error(result.error);
        return;
      }
      updateCard(boardId, listId, cardId, { sessionWorktree: null });
      toast.success('Worktree deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setShipPending(false);
    }
  };

  const requestShip = async () => {
    if (claudeTurnActive) {
      toast.error('Wait until Claude finishes this turn before shipping.');
      return;
    }
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

  const requestCloseTerminal = () => {
    if (claudeRunning) {
      setCloseTerminalOpen(true);
      return;
    }
    const closing = window.electron?.terminal?.close(cardId);
    if (closing) closing.catch(() => undefined);
  };

  const { confirm, dialog: archiveDialog } = useConfirm();
  const archive = () => {
    if (card.archived) {
      unarchiveCard(boardId, listId, cardId);
      onOpenChange(false);
      return;
    }
    confirm({
      title: 'Archive this card?',
      body: 'The card is hidden from the board. You can restore it from the archived view.',
      confirmLabel: 'Archive',
      onConfirm: () => {
        archiveCard(boardId, listId, cardId);
        onOpenChange(false);
      },
    });
  };

  shortcutsRef.current = {
    e: () => setEditing(true),
    r: () => {
      if (!primary || !card.prompt.trim()) return;
      // Re-connect takes the place of Run once a terminal session exists,
      // including while the shell is still open.
      if (canReconnect || (canRun && !shellAlive)) void run();
    },
    c: () => void copy(),
    a: archive,
    j: () => toggleComments(),
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
        // Clicking a text field while the terminal has focus lost the click:
        // xterm redraws on blur, and Radix's focus trap pulls focus to the
        // dialog while document.body is briefly active mid-click. Focusing
        // the field synchronously here skips that window.
        onMouseDownCapture={(event) => {
          const target = event.target as HTMLElement;
          if (target.matches?.('input, textarea')) target.focus();
        }}
        // Radix focuses the first tabbable (the expand button) on open, which
        // would undo the terminal's own autoFocus.
        onOpenAutoFocus={(event) => {
          if (terminalMode) event.preventDefault();
        }}
        // Escape typed in the terminal belongs to the terminal (Claude's
        // interrupt). Anywhere else in the dialog it still closes it.
        onEscapeKeyDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (
            (terminalMode && target?.closest?.('[data-terminal-host]')) ||
            // Esc in a comment edit box cancels the edit, not the dialog.
            target?.closest?.('[data-comment-edit]')
          ) {
            event.preventDefault();
          }
        }}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
        className={cn(
          'flex',
          // Expanded uses a fixed `h-` and not merely a taller `max-h-`: a
          // max-height alone lets the box shrink back to its content, so a
          // short transcript would keep the chat cramped in a dialog the
          // user just asked to be big. A fixed height guarantees the room
          // is there for the feed to flex into as the agent talks.
          sizedDialog,
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
        <div
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col gap-4',
            columnMax,
          )}
        >
          <DialogHeader className="shrink-0 pr-32">
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
            aria-label={layoutExpanded ? 'Collapse' : 'Expand'}
            onClick={() => setExpanded(!layoutExpanded)}
          >
            {layoutExpanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="absolute top-3.5 right-[4.5rem] gap-1 px-2 text-muted-foreground hover:text-foreground"
            aria-label={`Comments (${card.comments.length})`}
            aria-expanded={commentsOpen}
            onClick={() => toggleComments()}
          >
            <MessageSquare className="size-4" />
            {card.comments.length > 0 ? card.comments.length : null}
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
                  onChange={(next) =>
                    setCardTags(boardId, listId, cardId, next)
                  }
                />
              </div>
              <WorktreeBadge
                usedWorktree={card.usedWorktree}
                sessionWorktree={card.sessionWorktree}
              />
              {/*
              Shares the badge row rather than occupying one of its own, and
              right-aligned into the row's free space: cost is a standing
              fact about the card like its priority and tags, and the row
              already exists at the top of the dialog where a glance lands.
              Its own `ml-auto` does the aligning.
            */}
              <UsageSummary totals={usage} live={liveUsage} />
              {card.lastShippedAt ? (
                <span
                  className="text-xs text-muted-foreground"
                  title={formatCommentTime(card.lastShippedAt)}
                >
                  Last shipped {relativeTime(card.lastShippedAt)}
                </span>
              ) : null}
            </div>

            <div className="flex items-start gap-1">
              <button
                type="button"
                aria-label={
                  promptCollapsed ? 'Expand prompt' : 'Collapse prompt'
                }
                aria-expanded={!promptCollapsed}
                onClick={() => setPromptCollapsed(cardId, !promptCollapsed)}
                className="mt-[17px] shrink-0 text-muted-foreground hover:text-foreground"
              >
                <ChevronRightIcon
                  className={cn(
                    'size-3.5 transition-transform',
                    !promptCollapsed && 'rotate-90',
                  )}
                />
              </button>
              {promptCollapsed ? (
                <button
                  type="button"
                  onClick={() => setPromptCollapsed(cardId, false)}
                  className="flex min-w-0 flex-1 rounded-md bg-muted p-3 text-left font-mono text-base"
                >
                  {/* Clipped, not CSS-ellipsized: the CSS ellipsis can land right after a half-visible typed "..." and read as two. */}
                  <span className="min-w-0 overflow-hidden whitespace-nowrap">
                    {card.prompt.trim()
                      ? card.prompt.trim().split('\n')[0]
                      : EMPTY_PROMPT_PLACEHOLDER}
                  </span>
                  <span className="shrink-0 pl-1">...</span>
                </button>
              ) : (
                <PromptBody
                  prompt={card.prompt}
                  className="min-w-0 max-h-48 flex-1 rounded-md bg-muted p-3 text-base"
                />
              )}
            </div>

            {card.attachments.length > 0 ? (
              <ImageAttachmentStrip
                hidePicker
                cardId={cardId}
                items={card.attachments}
                onChange={(next) =>
                  updateCard(boardId, listId, cardId, { attachments: next })
                }
              />
            ) : null}

            {/* Rendered only when a link is set. */}
            {card.link ? (
              <button
                type="button"
                onClick={() => api.shell.openExternal(card.link)}
                className="flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="size-3.5 shrink-0" />
                <span className="truncate underline-offset-2 hover:underline">
                  {card.link}
                </span>
              </button>
            ) : null}

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

            {terminalMode ? (
              <>
                <TerminalPanel
                  cardId={cardId}
                  acceptInput={!shipBusy}
                  autoFocus
                />
                {sessionStatus === 'failed' && lastError ? (
                  <div className="shrink-0">
                    <SessionLastError status="failed" message={lastError} />
                  </div>
                ) : null}
              </>
            ) : (
              <SessionTranscript cardId={cardId} expanded={chatExpanded} />
            )}

            <BackgroundTasksIndicator cardId={cardId} />

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
            {hasSession && !terminalMode ? (
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
                {shipBusy || sessionStatus === 'waiting' ? (
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
              <Button
                variant="ghost"
                onClick={archive}
                title={`${card.archived ? 'Unarchive' : 'Archive'} (⌘A)`}
              >
                {card.archived ? (
                  <ArchiveRestore className="size-3.5" />
                ) : (
                  <Archive className="size-3.5" />
                )}
                {card.archived ? 'Unarchive' : 'Archive'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => void copy()}
                title="Copy prompt (⌘C)"
              >
                <Copy className="size-3.5" />
                Copy
              </Button>
            </div>
            <Button
              variant="ghost"
              onClick={() => setEditing(true)}
              title="Edit (⌘E)"
            >
              Edit
            </Button>
            {terminalMode && (claudeRunning || shipBusy) ? (
              <Button variant="destructive" onClick={stop}>
                Stop
              </Button>
            ) : null}
            {hasSession ? (
              <Button
                variant="outline"
                onClick={() =>
                  updateCard(boardId, listId, cardId, { paused: !paused })
                }
              >
                {paused ? (
                  <Play className="size-3.5" />
                ) : (
                  <Pause className="size-3.5" />
                )}
                {paused ? 'Resume' : 'Pause'}
              </Button>
            ) : null}
            {shellAlive ? (
              <Button variant="outline" onClick={requestCloseTerminal}>
                Close terminal
              </Button>
            ) : null}
            {canShowShip ? (
              <div className="flex min-w-0 flex-col items-end gap-0.5">
                <Button
                  onClick={
                    card.sessionWorktree?.shipped ? deleteWorktree : requestShip
                  }
                  disabled={shipBusy || paused}
                >
                  {shipBusy ? (
                    <Loader2
                      aria-label={
                        card.sessionWorktree?.shipped ? 'Deleting' : 'Shipping'
                      }
                      className="size-4 animate-spin"
                    />
                  ) : card.sessionWorktree?.shipped ? (
                    'Delete worktree'
                  ) : (
                    'Ship'
                  )}
                </Button>
                {shipHelper && !card.sessionWorktree?.shipped ? (
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
            {canReconnect ? (
              <Button
                onClick={run}
                disabled={!primary || !card.prompt.trim()}
                title="Re-connect (⌘⇧R)"
              >
                Re-connect
              </Button>
            ) : null}
            {canRun && !shellAlive && !canReconnect ? (
              <Button
                onClick={run}
                disabled={!primary || !card.prompt.trim()}
                title={`${hasSession ? 'Run again' : 'Run'} (⌘⇧R)`}
              >
                {hasSession ? 'Run again' : 'Run'}
              </Button>
            ) : null}
          </DialogFooter>
        </div>

        {commentsOpen ? (
          <CommentsPanel
            key={cardId}
            boardId={boardId}
            listId={listId}
            cardId={cardId}
            autoFocus={focusCommentsFor === cardId}
            className={columnMax}
          />
        ) : null}
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
      {archiveDialog}
      <ConfirmDialog
        open={closeTerminalOpen}
        onOpenChange={setCloseTerminalOpen}
        title="Close terminal?"
        body="Claude is still running in this terminal. Close it anyway?"
        confirmLabel="Close it"
        onConfirm={() => {
          setCloseTerminalOpen(false);
          const closing = window.electron?.terminal?.close(cardId);
          if (closing) closing.catch(() => undefined);
        }}
      />
    </Dialog>
  );
}
