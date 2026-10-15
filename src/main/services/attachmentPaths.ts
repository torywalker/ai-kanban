import path from 'path';
import {
  extensionForMime,
  type AllowedImageMime,
} from '../../shared/attachments';

export function assetsDirFor(dataFilePath: string): string {
  const dir = path.dirname(dataFilePath);
  const ext = path.extname(dataFilePath);
  const base = path.basename(dataFilePath, ext);
  return path.join(dir, `${base}.assets`);
}

export function assertSafeAttachmentPathSegment(segment: string): void {
  if (
    !segment ||
    segment === '.' ||
    segment === '..' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    segment.includes('\0')
  ) {
    throw new Error('Invalid attachment path.');
  }
}

export function attachmentFilePath(
  dataFilePath: string,
  cardId: string,
  id: string,
  mimeType: AllowedImageMime,
): string {
  return path.join(
    assetsDirFor(dataFilePath),
    cardId,
    `${id}.${extensionForMime(mimeType)}`,
  );
}
