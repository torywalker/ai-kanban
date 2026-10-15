import fs from 'fs/promises';
import path from 'path';
import { clipboard } from 'electron';
import {
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  OVERSIZE_MESSAGE,
  UNSUPPORTED_MESSAGE,
  extensionForMime,
  newAttachmentId,
  sniffImageMime,
  type AllowedImageMime,
  type AttachmentMeta,
  type AttachmentPickResult,
  type AttachmentRef,
} from '../../shared/attachments';
import type { DaemonImage } from '../../shared/daemonProtocol';
import {
  assertSafeAttachmentPathSegment,
  attachmentFilePath,
} from './attachmentPaths';

function displayName(filename: string, mime: AllowedImageMime): string {
  const trimmed = filename.trim();
  if (trimmed) return path.basename(trimmed);
  return `pasted-image.${extensionForMime(mime)}`;
}

export async function addAttachment(
  dataFilePath: string,
  cardId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<AttachmentMeta> {
  assertSafeAttachmentPathSegment(cardId);
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(OVERSIZE_MESSAGE);
  }
  const mime = sniffImageMime(bytes);
  if (!mime) {
    throw new Error(UNSUPPORTED_MESSAGE);
  }
  const id = newAttachmentId();
  const dest = attachmentFilePath(dataFilePath, cardId, id, mime);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
  return { id, filename: displayName(filename, mime), mimeType: mime };
}

export async function addAttachmentsFromPaths(
  dataFilePath: string,
  cardId: string,
  filePaths: string[],
  remainingSlots: number,
): Promise<AttachmentPickResult> {
  const slotLimit = Number.isFinite(remainingSlots)
    ? Math.min(MAX_IMAGES, Math.max(0, Math.floor(remainingSlots)))
    : 0;
  const result: AttachmentPickResult = {
    added: [],
    skippedCap: false,
    errors: [],
  };

  async function addAt(index: number): Promise<void> {
    if (index >= filePaths.length) return;
    if (result.added.length >= slotLimit) {
      result.skippedCap = true;
      return;
    }
    const filePath = filePaths[index];
    try {
      const bytes = new Uint8Array(await fs.readFile(filePath));
      result.added.push(
        await addAttachment(
          dataFilePath,
          cardId,
          path.basename(filePath),
          bytes,
        ),
      );
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : String(error),
      );
    }
    await addAt(index + 1);
  }

  await addAt(0);
  return result;
}

export const pickAttachments = addAttachmentsFromPaths;

export async function pasteAttachmentFromClipboard(
  dataFilePath: string,
  cardId: string,
): Promise<AttachmentMeta | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  return addAttachment(
    dataFilePath,
    cardId,
    'pasted-image.png',
    new Uint8Array(image.toPNG()),
  );
}

export async function removeAttachment(
  dataFilePath: string,
  cardId: string,
  id: string,
): Promise<void> {
  assertSafeAttachmentPathSegment(cardId);
  assertSafeAttachmentPathSegment(id);
  await Promise.all(
    ALLOWED_IMAGE_MIMES.map(async (mime) => {
      const file = attachmentFilePath(dataFilePath, cardId, id, mime);
      try {
        await fs.unlink(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }),
  );
}

export async function previewAttachment(
  dataFilePath: string,
  cardId: string,
  id: string,
): Promise<string> {
  assertSafeAttachmentPathSegment(cardId);
  assertSafeAttachmentPathSegment(id);
  for (const mime of ALLOWED_IMAGE_MIMES) {
    const file = attachmentFilePath(dataFilePath, cardId, id, mime);
    try {
      const buf = await fs.readFile(file);
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Could not read image ${id}`);
}

export function resolveDaemonImages(
  dataFilePath: string,
  sessionCardId: string,
  refs: AttachmentRef[],
): DaemonImage[] {
  return refs.map((ref) => {
    assertSafeAttachmentPathSegment(ref.cardId);
    assertSafeAttachmentPathSegment(ref.id);
    if (ref.cardId !== sessionCardId) {
      throw new Error('Attachment does not belong to this card.');
    }
    if (!ALLOWED_IMAGE_MIMES.includes(ref.mimeType)) {
      throw new Error('Invalid image MIME type.');
    }
    return {
      path: attachmentFilePath(dataFilePath, ref.cardId, ref.id, ref.mimeType),
      mimeType: ref.mimeType,
      filename: ref.filename,
      cardId: ref.cardId,
      id: ref.id,
    };
  });
}
