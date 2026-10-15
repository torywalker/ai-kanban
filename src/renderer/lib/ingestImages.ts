import { toast } from 'sonner';
import { api } from '@/lib/api';
import {
  ALLOWED_IMAGE_MIMES,
  AT_CAP_MESSAGE,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  OVERSIZE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  type AllowedImageMime,
  type AttachmentMeta,
} from '@shared/attachments';

export interface IngestTarget {
  cardId: string;
  currentCount: number;
  /**
   * Called once per ingest with everything that made it to disk. Callers
   * build the next list from a props or state value they cannot re-read
   * between two synchronous callbacks, so this is deliberately a batch
   * rather than one call per file.
   */
  onAdded: (added: AttachmentMeta[]) => void;
}

export interface IngestOptions {
  /**
   * Whether an item of the wrong type earns a toast. False only for a mixed
   * clipboard payload, where spec §3.4 wants the unusable flavour ignored in
   * silence because the field is still accepting the text beside it.
   */
  reportUnsupported?: boolean;
}

/**
 * The parts of a paste event this module touches. Structural rather than
 * `ClipboardEvent` so a React synthetic event, whose `clipboardData` is
 * non-nullable, is accepted without unwrapping to `nativeEvent`.
 */
export interface PasteLike {
  clipboardData: DataTransfer | null;
  preventDefault: () => void;
}

/**
 * What a paste turned out to be carrying. Both flags false is the only case
 * worth asking main's `clipboard.readImage()` about: a paste with text was a
 * text paste, even if the clipboard also holds a screenshot the user did not
 * mean to attach.
 */
export interface PasteIngestResult {
  hadImages: boolean;
  hadText: boolean;
}

function isAllowedMime(type: string): type is AllowedImageMime {
  return (ALLOWED_IMAGE_MIMES as readonly string[]).includes(type);
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Messages main composed for the user rather than for a log. They are
 * already in the second person and already explain what to do, so wrapping
 * them reads as "Could not save the image: That image is larger than 5 MB."
 */
const USER_FACING_FAILURES: readonly string[] = [
  OVERSIZE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  AT_CAP_MESSAGE,
];

/** `EACCES: permission denied, open '/Users/me/notes/kanban.assets/…'`. */
const ERRNO_PREFIX = /^([A-Z][A-Z0-9_]+):/;

/**
 * Turns whatever main reported into one sentence a user can act on.
 *
 * A raw `fs` rejection is a log line, not a message: it repeats the verb
 * ("open", "mkdir") the user did not choose and prints the absolute path of
 * their board, which is both noise and more of their filesystem than a toast
 * should put on screen. The errno alone is the part that distinguishes "the
 * disk is full" from "the folder is read-only", so that is what survives.
 */
export function saveFailureMessage(detail: string): string {
  const trimmed = detail.trim();
  if (USER_FACING_FAILURES.includes(trimmed)) return trimmed;
  const errno = ERRNO_PREFIX.exec(trimmed);
  return `Could not save the image: ${errno ? errno[1] : trimmed}`;
}

function toastSaveFailure(detail: string): void {
  toast.error(saveFailureMessage(detail));
}

/**
 * Writes each file through `attachments.add`, stopping at the cap, and hands
 * the successful metadata back in one batch.
 *
 * Sequential on purpose: the cap is counted against what has actually landed
 * so far, so file N+1 must not start before file N is known to have fit.
 */
export async function ingestFiles(
  files: File[],
  target: IngestTarget,
  options: IngestOptions = {},
): Promise<void> {
  const reportUnsupported = options.reportUnsupported ?? true;
  const added: AttachmentMeta[] = [];

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (target.currentCount + added.length >= MAX_IMAGES) {
      toast.error(AT_CAP_MESSAGE);
      break;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      // The one check that cannot be deferred to main, which refuses the
      // same file: deferring it means copying 40 MB across IPC to be told no.
      toast.error(OVERSIZE_MESSAGE);
    } else if (file.type !== '' && !isAllowedMime(file.type)) {
      if (reportUnsupported) toast.error(UNSUPPORTED_MESSAGE);
    } else {
      // An empty `type` reaches main deliberately. The OS leaves it blank for
      // an extensionless file or a flavour it has no mapping for, and main
      // sniffs the magic bytes — it is the authority on what this is, so
      // guessing from a filename here would reject good PNGs.
      try {
        // eslint-disable-next-line no-await-in-loop
        const bytes = await file.arrayBuffer();
        // eslint-disable-next-line no-await-in-loop
        const result = await api.attachments.add(
          target.cardId,
          file.name,
          file.type,
          bytes,
        );
        if (result.ok) {
          added.push(result.value);
        } else {
          toastSaveFailure(result.error);
        }
      } catch (error) {
        toastSaveFailure(messageFor(error));
      }
    }
  }

  if (added.length > 0) target.onAdded(added);
}

function imageFilesFrom(data: DataTransfer): File[] {
  const found: File[] = [];
  const { items } = data;
  for (let i = 0; i < (items?.length ?? 0); i += 1) {
    const item = items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      // Must happen while the event is still on the stack: a
      // DataTransferItem is neutered once the handler returns.
      const file = item.getAsFile();
      if (file) found.push(file);
    }
  }
  if (found.length === 0 && data.files) {
    for (let i = 0; i < data.files.length; i += 1) {
      const file = data.files[i];
      if (file.type.startsWith('image/')) found.push(file);
    }
  }
  return found;
}

/**
 * Ingests the images in a paste, and decides there and then whether the
 * field should still receive the paste itself.
 *
 * This helper calls `preventDefault` rather than leaving it to the caller:
 * the DOM only honours it while the handler is on the stack, so a caller
 * awaiting this promise first would already be too late. An image-only paste
 * is prevented (otherwise the field fills with the file's name or its
 * bytes); a paste that also carries text is not, so spec §8's "image
 * ingested, text still goes into the focused field" holds.
 *
 * Reports both halves of what it found rather than a bare "any images?": the
 * caller needs `hadText` to keep `ingestClipboardFallback` away from an
 * ordinary text paste.
 */
export async function ingestPasteEvent(
  event: PasteLike,
  target: IngestTarget,
): Promise<PasteIngestResult> {
  const data = event.clipboardData;
  if (!data) return { hadImages: false, hadText: false };

  // Both reads happen before the first `await`, while the event is still on
  // the stack and its items have not been neutered.
  const files = imageFilesFrom(data);
  const text =
    typeof data.getData === 'function'
      ? (data.getData('text/plain') ?? '')
      : '';

  const result = { hadImages: files.length > 0, hadText: text !== '' };
  const imageOnly = result.hadImages && !result.hadText;
  if (imageOnly) event.preventDefault();

  if (result.hadImages) {
    await ingestFiles(files, target, { reportUnsupported: imageOnly });
  }
  return result;
}

/** The paperclip: a native multi-select dialog, bounded by the free slots. */
export async function ingestPick(target: IngestTarget): Promise<void> {
  const remainingSlots = MAX_IMAGES - target.currentCount;
  if (remainingSlots <= 0) {
    toast.error(AT_CAP_MESSAGE);
    return;
  }

  const result = await api.attachments.pick(target.cardId, remainingSlots);
  if (!result.ok) {
    toastSaveFailure(result.error);
    return;
  }

  const { added, skippedCap, errors } = result.value;
  // A partly-usable selection still adds what it can, so every rejected file
  // has to say for itself why it is not on screen.
  errors.forEach(toastSaveFailure);
  if (skippedCap) toast.error(AT_CAP_MESSAGE);
  if (added.length > 0) target.onAdded(added);
}

/**
 * The macOS screenshot case: the clipboard holds an image that never
 * surfaces as a `File`, so main reads it with `clipboard.readImage()`.
 * Only worth asking after `ingestPasteEvent` found nothing.
 */
export async function ingestClipboardFallback(
  target: IngestTarget,
): Promise<void> {
  if (target.currentCount >= MAX_IMAGES) {
    toast.error(AT_CAP_MESSAGE);
    return;
  }

  const result = await api.attachments.pasteFromClipboard(target.cardId);
  if (!result.ok) {
    toastSaveFailure(result.error);
    return;
  }
  // A null value is the ordinary text-paste case, not a failure: this runs on
  // every paste that carried no image file, so it must stay silent.
  if (result.value) target.onAdded([result.value]);
}

/**
 * Unlinks the file behind an attachment. Returns whether it is really gone,
 * so the caller drops the thumbnail only once there is nothing left to show.
 */
export async function removeStoredAttachment(
  cardId: string,
  id: string,
): Promise<boolean> {
  const result = await api.attachments.remove(cardId, id);
  if (!result.ok) {
    toast.error(result.error);
    return false;
  }
  return true;
}
