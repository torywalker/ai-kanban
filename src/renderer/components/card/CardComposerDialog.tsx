import { useEffect, useRef, useState } from 'react';
import type { CardColor, Priority } from '@shared/schema';
import type { AttachmentMeta } from '@shared/attachments';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { api } from '@/lib/api';
import { TagPicker } from '@/components/tags/TagPicker';
import { DisclosureSection } from '@/components/common/DisclosureSection';
import { ModelPicker } from '@/components/common/ModelPicker';
import { extractVariables } from '@/domain/variables';
import { modelDisplayLabel } from '@/domain/models';
import { newId } from '@/domain/ids';
import {
  ingestClipboardFallback,
  ingestFiles,
  ingestPasteEvent,
  removeStoredAttachment,
  type IngestTarget,
} from '@/lib/ingestImages';
import { cardAttachmentTarget } from '@/lib/cardAttachmentTarget';
import { SlashPromptTextarea } from './SlashPromptTextarea';
import { PriorityPicker } from './PriorityPicker';
import { CardColorPicker } from './CardColorPicker';
import { ImageAttachmentStrip } from './ImageAttachmentStrip';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  listId: string;
  cardId: string | null;
}

export function CardComposerDialog({
  open,
  onOpenChange,
  boardId,
  listId,
  cardId,
}: Props) {
  const existing = useDocStore((s) =>
    cardId
      ? (s.doc?.boards
          .find((b) => b.id === boardId)
          ?.lists.find((l) => l.id === listId)
          ?.cards.find((c) => c.id === cardId) ?? null)
      : null,
  );
  const board = useDocStore(
    (s) => s.doc?.boards.find((candidate) => candidate.id === boardId) ?? null,
  );
  const addCard = useDocStore((s) => s.addCard);
  const updateCard = useDocStore((s) => s.updateCard);
  const deleteCard = useDocStore((s) => s.deleteCard);
  const archiveCard = useDocStore((s) => s.archiveCard);
  const unarchiveCard = useDocStore((s) => s.unarchiveCard);
  const defaultModel = useDocStore((s) => s.defaultModel);
  const useWorktrees = useDocStore((s) => s.useWorktrees);

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [color, setColor] = useState<CardColor | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');
  const [sessionRepo, setSessionRepo] = useState<string | null>(null);
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [useWorktree, setUseWorktree] = useState<boolean | null>(null);
  const [draftCardId, setDraftCardId] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<AttachmentMeta[]>(
    [],
  );
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const draftAttachmentsRef = useRef<AttachmentMeta[]>([]);
  const pendingAttachmentOpsRef = useRef(0);

  // Holds the latest `existing` without making it an effect dependency.
  const existingRef = useRef(existing);
  existingRef.current = existing;

  // Reset the fields on the transition INTO open, so a cancelled edit does
  // not leak into the next card.
  //
  // Deliberately keyed on `open` alone, reading `existing` through a ref at
  // that moment. `existing` is a fresh object reference after ANY document
  // mutation, so depending on it re-ran this effect while the dialog was
  // already open and silently threw away whatever the user had typed — an
  // edit elsewhere in the document (or, before that write stopped going
  // through `commit`, a background session-id write) was enough to do it.
  useEffect(() => {
    if (!open) return;
    const card = existingRef.current;
    setTitle(card?.title ?? '');
    setPrompt(card?.prompt ?? '');
    setTags(card?.tags ?? []);
    setPriority(card?.priority ?? null);
    setColor(card?.color ?? null);
    setDueDate(card?.dueDate ?? null);
    setNotes(card?.notes ?? '');
    setLink(card?.link ?? '');
    setSessionRepo(card?.sessionRepo ?? null);
    setSessionModel(card?.sessionModel ?? null);
    setUseWorktree(card?.useWorktree ?? null);
    const nextDraftAttachments = card?.attachments ?? [];
    draftAttachmentsRef.current = nextDraftAttachments;
    setDraftAttachments(nextDraftAttachments);
    setDraftCardId(card?.id ?? newId('crd'));
    pendingAttachmentOpsRef.current = 0;
    setAttachmentBusy(false);
  }, [open]);

  // Drives the disclosure's collapsed summary and whether it starts open.
  const overrideCount = [sessionRepo, sessionModel, useWorktree].filter(
    (value) => value !== null,
  ).length;

  const save = () => {
    if (pendingAttachmentOpsRef.current > 0) return;
    const trimmedTitle = title.trim() || 'Untitled prompt';
    if (cardId) {
      // tags travel in the same patch as the rest of the fields: updateCard
      // registers any new tag names and writes the card in a single
      // mutate/commit, so one Save is one undo step.
      updateCard(boardId, listId, cardId, {
        title: trimmedTitle,
        prompt,
        tags,
        priority,
        color,
        dueDate,
        notes,
        link: link.trim(),
        sessionRepo,
        sessionModel,
        useWorktree,
      });
    } else {
      // addCard registers new tag names and creates the card in a single
      // mutate/commit, so one Save is one undo step.
      addCard(boardId, listId, {
        id: draftCardId,
        title: trimmedTitle,
        prompt,
        attachments: draftAttachmentsRef.current,
        tags,
        priority,
        color,
        dueDate,
        notes,
        link: link.trim(),
        sessionRepo,
        sessionModel,
        useWorktree,
      });
    }
    onOpenChange(false);
  };

  const close = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    // Do not close while an IPC write or native picker is still deciding
    // which files belong to this draft. Once settled, Cancel removes every
    // file written under the reserved ID so abandoned cards leave no assets.
    if (pendingAttachmentOpsRef.current > 0) return;
    if (!cardId && draftCardId) {
      const abandoned = draftAttachmentsRef.current;
      draftAttachmentsRef.current = [];
      setDraftAttachments([]);
      void Promise.all(
        abandoned.map((item) =>
          removeStoredAttachment(draftCardId, item.id).catch(() => false),
        ),
      );
    }
    onOpenChange(false);
  };

  // No confirm dialog, matching every other delete in this app except
  // board deletion — Cmd+Z is the recovery path.
  const remove = () => {
    if (!cardId) return;
    // Unconditional, not gated on `existing?.sessionId`: that field is the
    // PERSISTED id, still null between clicking Run and the SDK's first
    // system/init reply reaching the renderer — a card deleted inside that
    // window (status badge already spinning) would have sent no stop at
    // all, orphaning a session with no card left to address it. The
    // daemon's `stop` handler no-ops harmlessly for an unknown cardId, so
    // sending it always is strictly safer than trying to close the window.
    const cleanup = async () => {
      const [cancelResult] = await Promise.all([
        api.git.shipCancel(cardId).catch((error) => ({
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        })),
        api.session.stop(cardId).catch(() => {
          // A daemon that can't be reached has no session to stop anyway,
          // and the card is going away regardless.
        }),
      ]);
      if (!cancelResult.ok) toast.error(cancelResult.error);

      const primary = existing?.sessionRepo ?? board?.defaultRepo ?? null;
      if (!existing?.sessionWorktree || !primary) return;
      const removed = await api.git.removeWorktree(
        cardId,
        primary,
        existing.sessionWorktree,
      );
      if (!removed.ok) toast.error(removed.error);
    };
    void cleanup().catch((error) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
    // Otherwise the deleted card's snapshot lingers in the session store
    // for the rest of the app's lifetime.
    useSessionStore.getState().clearSession(cardId);
    deleteCard(boardId, listId, cardId);
    onOpenChange(false);
  };

  const archive = () => {
    if (!cardId) return;
    if (existing?.archived) {
      unarchiveCard(boardId, listId, cardId);
    } else {
      archiveCard(boardId, listId, cardId);
    }
    onOpenChange(false);
  };

  // Reads the card's attachments out of the store as each ingest lands, so
  // two overlapping pastes/drops compose instead of the later one writing a
  // list that predates the earlier one. See cardAttachmentTarget.ts.
  const applyDraftAttachments = (next: AttachmentMeta[]) => {
    draftAttachmentsRef.current = next;
    setDraftAttachments(next);
  };
  let attachmentTarget: IngestTarget | null = null;
  if (cardId && existing) {
    attachmentTarget = cardAttachmentTarget(boardId, listId, cardId);
  } else if (draftCardId) {
    attachmentTarget = {
      cardId: draftCardId,
      get currentCount() {
        return draftAttachmentsRef.current.length;
      },
      onAdded: (added) =>
        applyDraftAttachments([...draftAttachmentsRef.current, ...added]),
    };
  }

  const changePendingAttachmentOps = (delta: 1 | -1) => {
    pendingAttachmentOpsRef.current = Math.max(
      0,
      pendingAttachmentOpsRef.current + delta,
    );
    setAttachmentBusy(pendingAttachmentOpsRef.current > 0);
  };

  const runAttachmentIngest = async (work: () => Promise<void>) => {
    changePendingAttachmentOps(1);
    try {
      await work();
    } finally {
      changePendingAttachmentOps(-1);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="flex max-h-[85vh] flex-col sm:max-w-2xl"
        onPaste={(event) => {
          if (!attachmentTarget) return;
          void runAttachmentIngest(async () => {
            const { hadImages, hadText } = await ingestPasteEvent(
              event,
              attachmentTarget,
            );
            if (!hadImages && !hadText) {
              await ingestClipboardFallback(attachmentTarget);
            }
          });
        }}
        onDrop={(event) => {
          if (!attachmentTarget || event.dataTransfer.files.length === 0) {
            return;
          }
          event.preventDefault();
          void runAttachmentIngest(() =>
            ingestFiles(Array.from(event.dataTransfer.files), attachmentTarget),
          );
        }}
        onDragOver={(event) => {
          if (attachmentTarget) event.preventDefault();
        }}
        onKeyDown={(event) => {
          // Cmd+Enter (Ctrl+Enter off Mac) saves from anywhere in the form --
          // title, prompt, notes, link -- since keydown bubbles up here from
          // whichever field is focused. Guarded against IME composition the
          // same way CardViewDialog's reply textarea is: Enter there confirms
          // the composed candidate, it isn't a request to save.
          if (event.key !== 'Enter') return;
          if (!event.metaKey && !event.ctrlKey) return;
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          ) {
            return;
          }
          event.preventDefault();
          save();
        }}
      >
        {/* See CardViewDialog for why header/footer need shrink-0 here. */}
        <DialogHeader className="shrink-0">
          <DialogTitle>{cardId ? 'Edit prompt' : 'New prompt'}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-title">Title</Label>
            <Input
              id="card-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What this prompt does"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Priority</Label>
            <PriorityPicker value={priority} onChange={setPriority} />
          </div>

          {/* Color sits next to Priority because they are the two purely
              visual triage controls, but it is not a second priority axis:
              it only tints the card so it can be picked out of a long
              list. */}
          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <CardColorPicker value={color} onChange={setColor} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-due-date">Due date</Label>
            <div className="flex gap-2">
              <Input
                id="card-due-date"
                type="date"
                value={dueDate ?? ''}
                onChange={(event) => setDueDate(event.target.value || null)}
                className="w-auto"
              />
              {dueDate ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDueDate(null)}
                >
                  Clear
                </Button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-prompt">Prompt</Label>
            <SlashPromptTextarea
              id="card-prompt"
              value={prompt}
              onChange={setPrompt}
              rows={12}
              className="max-h-72 overflow-y-auto font-mono text-xs"
              placeholder="The prompt text, copied verbatim."
            />
            {attachmentTarget ? (
              <ImageAttachmentStrip
                cardId={attachmentTarget.cardId}
                items={existing?.attachments ?? draftAttachments}
                onChange={
                  cardId
                    ? (next) =>
                        updateCard(boardId, listId, cardId, {
                          attachments: next,
                        })
                    : applyDraftAttachments
                }
                disabled={attachmentBusy}
                onBusyChange={(busy) =>
                  changePendingAttachmentOps(busy ? 1 : -1)
                }
              />
            ) : null}
            {extractVariables(prompt).length > 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground">
                Variables: {extractVariables(prompt).join(', ')}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Wrap a placeholder in double braces to make it fillable at copy
                time, e.g. {'{{file}}'}.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <TagPicker selected={tags} onChange={setTags} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-notes">Notes</Label>
            <Textarea
              id="card-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Outcome, what to change next time. Never copied."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-link">Link</Label>
            <Input
              id="card-link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://"
            />
          </div>

          {/* Both overrides are empty on almost every card, so they sit behind
              a disclosure rather than padding out the form every time it
              opens. Opened by default when this card actually has one, so an
              existing override is never hidden from the person editing it. */}
          <DisclosureSection
            title="Overrides"
            summary={overrideCount > 0 ? `${overrideCount} set` : 'Inherited'}
            defaultOpen={overrideCount > 0}
          >
            <div className="flex flex-col gap-1.5">
              <Label>Working directory</Label>
              <div className="flex gap-2">
                <Input
                  value={sessionRepo ?? ''}
                  readOnly
                  placeholder="Uses board default"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    const folder = await api.data.pickFolder();
                    if (folder) setSessionRepo(folder);
                  }}
                >
                  Choose…
                </Button>
                {sessionRepo ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setSessionRepo(null)}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Model</Label>
              <ModelPicker
                value={sessionModel}
                onChange={setSessionModel}
                inheritLabel={`Uses the global default (${modelDisplayLabel(defaultModel)})`}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Git worktree</Label>
              <div
                role="group"
                aria-label="Git worktree"
                className="flex flex-wrap gap-2"
              >
                {[
                  {
                    value: null,
                    label: `Default (${useWorktrees ? 'on' : 'off'})`,
                  },
                  { value: true, label: 'Always' },
                  { value: false, label: 'Never' },
                ].map((option) => (
                  <Button
                    key={option.label}
                    type="button"
                    size="sm"
                    variant={
                      useWorktree === option.value ? 'default' : 'outline'
                    }
                    aria-pressed={useWorktree === option.value}
                    onClick={() => setUseWorktree(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Overrides whether this card runs in an isolated worktree.
              </p>
            </div>
          </DisclosureSection>
        </div>

        <DialogFooter className="shrink-0">
          {cardId ? (
            <div className="flex gap-2 sm:mr-auto">
              <Button variant="outline" onClick={archive}>
                {existing?.archived ? 'Unarchive' : 'Archive'}
              </Button>
              <Button variant="destructive" onClick={remove}>
                Delete
              </Button>
            </div>
          ) : null}
          <Button
            variant="ghost"
            disabled={attachmentBusy}
            onClick={() => close(false)}
          >
            Cancel
          </Button>
          <Button disabled={attachmentBusy} onClick={save}>
            {cardId ? 'Save' : 'Add prompt'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
