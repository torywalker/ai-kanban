import {
  extensionForMime,
  newAttachmentId,
  sniffImageMime,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from '../shared/attachments';

describe('sniffImageMime', () => {
  it('recognizes PNG magic', () => {
    const png = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(sniffImageMime(png)).toBe('image/png');
  });

  it('rejects PNG with a corrupted signature tail', () => {
    const badPng = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(sniffImageMime(badPng)).toBeNull();
  });

  it('returns null for a PDF header', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4');
    expect(sniffImageMime(pdf)).toBeNull();
  });
});

describe('newAttachmentId', () => {
  it('is att_ plus 6 alphanumeric characters', () => {
    expect(newAttachmentId()).toMatch(/^att_[a-z0-9]{6}$/);
  });
});

describe('limits', () => {
  it('caps at 5 MiB and 10 images', () => {
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_IMAGES).toBe(10);
  });
});
