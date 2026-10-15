import { z } from 'zod';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 10;
export const OVERSIZE_MESSAGE = 'That image is larger than 5 MB.';
export const UNSUPPORTED_MESSAGE =
  'Only PNG, JPEG, GIF, and WebP images are supported.';
export const AT_CAP_MESSAGE = `You can attach up to ${MAX_IMAGES} images.`;

export const ALLOWED_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export const IMAGE_EXT_BY_MIME: Record<
  AllowedImageMime,
  'png' | 'jpg' | 'gif' | 'webp'
> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function extensionForMime(
  mime: AllowedImageMime,
): 'png' | 'jpg' | 'gif' | 'webp' {
  return IMAGE_EXT_BY_MIME[mime];
}

export const AttachmentMetaSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.enum(ALLOWED_IMAGE_MIMES),
});
export type AttachmentMeta = z.infer<typeof AttachmentMetaSchema>;

export interface AttachmentRef {
  id: string;
  cardId: string;
  filename: string;
  mimeType: AllowedImageMime;
}

export interface AttachmentPickResult {
  added: AttachmentMeta[];
  skippedCap: boolean;
  errors: string[];
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newAttachmentId(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `att_${suffix}`;
}

export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (bytes.length >= 6) {
    const head = String.fromCharCode(...bytes.slice(0, 6));
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}
