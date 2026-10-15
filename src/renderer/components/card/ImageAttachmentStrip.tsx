import { useEffect, useRef, useState } from 'react';
import { ImageOff, Paperclip, X } from 'lucide-react';
import type { AttachmentMeta } from '@shared/attachments';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ingestPick, removeStoredAttachment } from '@/lib/ingestImages';

interface ThumbnailProps {
  cardId: string;
  attachment: AttachmentMeta;
  className?: string;
}

/**
 * One attachment, as a data URL read back through main.
 *
 * Exported on its own because the transcript shows the same thumbnail for a
 * user turn that carried images, where there is nothing to remove and no
 * paperclip — the strip below is that plus its controls.
 */
export function AttachmentThumbnail({
  cardId,
  attachment,
  className,
}: ThumbnailProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setMissing(false);
    const load = async () => {
      // Spec §8: a file the asset folder no longer has is a grey box, not an
      // error to dismiss — a board whose assets went missing would otherwise
      // open under a wall of toasts.
      try {
        const result = await api.attachments.preview(cardId, attachment.id);
        if (cancelled) return;
        if (result.ok) setSrc(result.value);
        else setMissing(true);
      } catch {
        if (!cancelled) setMissing(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [cardId, attachment.id]);

  const shared = cn('size-14 rounded-md border object-cover', className);

  // The filename is the attachment's only identity on screen, and a 56px box
  // has no room to print it, so it is both the accessible name and the
  // hover title in either state.
  if (!src) {
    return (
      <div
        role="img"
        aria-label={attachment.filename}
        title={attachment.filename}
        data-slot="attachment-placeholder"
        className={cn(
          shared,
          'flex items-center justify-center bg-muted text-muted-foreground',
        )}
      >
        {/* Only once the read has actually failed: an icon shown while the
            data URL is still in flight reads as "broken" on every open. */}
        {missing ? <ImageOff className="size-4" /> : null}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Expand ${attachment.filename}`}
        title={attachment.filename}
        className={cn(shared, 'cursor-zoom-in overflow-hidden p-0')}
        onClick={() => setExpanded(true)}
      >
        <img
          src={src}
          alt={attachment.filename}
          title={attachment.filename}
          className="size-full object-cover"
        />
      </button>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="z-60 max-h-[90vh] w-auto max-w-[min(90vw,80rem)] p-3 sm:max-w-[min(90vw,80rem)]">
          <DialogHeader>
            <DialogTitle className="truncate pr-8 text-sm font-medium">
              {attachment.filename}
            </DialogTitle>
          </DialogHeader>
          <img
            src={src}
            alt={attachment.filename}
            className="max-h-[min(80vh,56rem)] w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface Props {
  cardId: string;
  items: AttachmentMeta[];
  onChange: (next: AttachmentMeta[]) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}

/**
 * The attachment row shared by the edit composer, the card body in the view
 * modal, and the reply composer. It owns no list of its own: `items` in,
 * `onChange` out, so the caller decides whether that list is a card field or
 * ephemeral reply state.
 */
export function ImageAttachmentStrip({
  cardId,
  items,
  onChange,
  disabled = false,
  onBusyChange,
}: Props) {
  /**
   * The list as of the last thing that happened, which is not the same as
   * the `items` prop while IPC is in flight. Two × clicks in quick
   * succession — easy, the buttons are adjacent and the round trip is a disk
   * operation — each used to filter the prop they closed over, so the second
   * handler wrote a list still holding the first attachment and brought a
   * deleted thumbnail back. Every update is derived from and folded into
   * this instead, so concurrent edits compose.
   *
   * Re-synced on render because the parent is the owner: once it has applied
   * an update, its prop is the truth again.
   */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pendingPicksRef = useRef(0);

  const apply = (next: AttachmentMeta[]) => {
    itemsRef.current = next;
    onChange(next);
  };

  const remove = async (id: string) => {
    // Order matters: a thumbnail that disappears from a list whose file is
    // still on disk leaves an attachment nobody can reach or delete.
    if (!(await removeStoredAttachment(cardId, id))) return;
    apply(itemsRef.current.filter((item) => item.id !== id));
  };

  const pick = async () => {
    pendingPicksRef.current += 1;
    if (pendingPicksRef.current === 1) onBusyChange?.(true);
    try {
      await ingestPick({
        cardId,
        currentCount: itemsRef.current.length,
        onAdded: (added) => apply([...itemsRef.current, ...added]),
      });
    } finally {
      pendingPicksRef.current -= 1;
      if (pendingPicksRef.current === 0) onBusyChange?.(false);
    }
  };

  return (
    <div
      data-slot="image-attachment-strip"
      className="flex flex-wrap items-center gap-2"
    >
      {items.map((item) => (
        <div key={item.id} className="relative">
          <AttachmentThumbnail cardId={cardId} attachment={item} />
          <Button
            type="button"
            variant="secondary"
            size="icon-xs"
            aria-label={`Remove ${item.filename}`}
            disabled={disabled}
            className="absolute -top-1.5 -right-1.5 rounded-full border shadow-sm"
            onClick={() => void remove(item.id)}
          >
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Attach images"
        disabled={disabled}
        onClick={() => void pick()}
      >
        <Paperclip />
      </Button>
    </div>
  );
}
