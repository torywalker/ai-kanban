/**
 * Renderer-side ingest helpers: the single place paste, drop, and the
 * paperclip agree on the cap, the allowed types, and which failures the user
 * is told about.
 *
 * The paste cases are the reason this file exists at all. `preventDefault`
 * on a clipboard event is only honoured while the handler is still on the
 * stack, so "prevent the default when the payload is image-only" has to be
 * decided and done before the first `await` — a check that is invisible in
 * the finished code and trivial to regress. Each paste test therefore holds
 * the returned promise unresolved and asserts on `preventDefault` first.
 */
import { toast } from 'sonner';
import { installElectronMock } from '../testUtils/electronMock';
import {
  ingestClipboardFallback,
  ingestFiles,
  ingestPasteEvent,
  ingestPick,
  removeStoredAttachment,
  type PasteLike,
} from '../renderer/lib/ingestImages';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  type AttachmentMeta,
} from '../shared/attachments';

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

const errorToast = toast.error as jest.Mock;

interface AttachmentMocks {
  add: jest.Mock;
  remove: jest.Mock;
  preview: jest.Mock;
  pick: jest.Mock;
  pasteFromClipboard: jest.Mock;
}

function attachments(): AttachmentMocks {
  return window.electron.attachments as unknown as AttachmentMocks;
}

function meta(id: string, filename = `${id}.png`): AttachmentMeta {
  return { id, filename, mimeType: 'image/png' };
}

/**
 * jsdom 20 ships `File` without `Blob.prototype.arrayBuffer`, which Chromium
 * (and so Electron's renderer) has had for years. Supplying it here keeps the
 * helper on the standard API the real runtime offers instead of bending the
 * production code around a test-only gap.
 */
function imageFile(name = 'a.png', type = 'image/png', bytes = [1, 2, 3, 4]) {
  const file = new File([new Uint8Array(bytes)], name, { type });
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => new Uint8Array(bytes).buffer,
    });
  }
  return file;
}

function pasteEvent(options: {
  files?: File[];
  text?: string;
}): PasteLike & { preventDefault: jest.Mock } {
  const files = options.files ?? [];
  const text = options.text ?? '';
  const items = [
    ...files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file,
    })),
    ...(text
      ? [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]
      : []),
  ];
  return {
    preventDefault: jest.fn(),
    clipboardData: {
      items,
      files,
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  } as unknown as PasteLike & { preventDefault: jest.Mock };
}

function target(overrides: Partial<Parameters<typeof ingestFiles>[1]> = {}) {
  return {
    cardId: 'crd_1',
    currentCount: 0,
    onAdded: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  installElectronMock();
  errorToast.mockClear();
});

describe('ingestFiles', () => {
  it('sends the file bytes as an ArrayBuffer to attachments.add', async () => {
    attachments().add.mockResolvedValue({ ok: true, value: meta('att_a') });
    const to = target();

    await ingestFiles([imageFile('shot.png', 'image/png', [9, 8, 7])], to);

    expect(attachments().add).toHaveBeenCalledTimes(1);
    const [cardId, filename, mimeType, bytes] = attachments().add.mock.calls[0];
    expect(cardId).toBe('crd_1');
    expect(filename).toBe('shot.png');
    expect(mimeType).toBe('image/png');
    expect(bytes.byteLength).toBe(3);
    expect(Array.from(new Uint8Array(bytes))).toEqual([9, 8, 7]);
  });

  it('reports every added file in one onAdded batch', async () => {
    attachments()
      .add.mockResolvedValueOnce({ ok: true, value: meta('att_a') })
      .mockResolvedValueOnce({ ok: true, value: meta('att_b') });
    const to = target();

    await ingestFiles([imageFile('a.png'), imageFile('b.png')], to);

    // One call, not one per file: the caller derives the next list from a
    // props/state value it cannot have re-read between two synchronous
    // callbacks, so per-file calls silently drop all but the last image.
    expect(to.onAdded).toHaveBeenCalledTimes(1);
    expect(to.onAdded).toHaveBeenCalledWith([meta('att_a'), meta('att_b')]);
  });

  it('refuses everything when the card is already at the cap', async () => {
    const to = target({ currentCount: MAX_IMAGES });

    await ingestFiles([imageFile()], to);

    expect(attachments().add).not.toHaveBeenCalled();
    expect(to.onAdded).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith('You can attach up to 10 images.');
  });

  it('stops at the cap partway through a batch and keeps what fit', async () => {
    attachments().add.mockResolvedValue({ ok: true, value: meta('att_a') });
    const to = target({ currentCount: MAX_IMAGES - 1 });

    await ingestFiles([imageFile('a.png'), imageFile('b.png')], to);

    expect(attachments().add).toHaveBeenCalledTimes(1);
    expect(to.onAdded).toHaveBeenCalledWith([meta('att_a')]);
    expect(errorToast).toHaveBeenCalledWith('You can attach up to 10 images.');
  });

  it('never sends a file main has already been told is not an image', async () => {
    const to = target();

    await ingestFiles(
      [new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' })],
      to,
    );

    expect(attachments().add).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith(
      'Only PNG, JPEG, GIF, and WebP images are supported.',
    );
  });

  it('lets main sniff a file the OS gave no type for', async () => {
    attachments().add.mockResolvedValue({ ok: true, value: meta('att_a') });
    const to = target();

    // A drop or paste can hand over a `File` with an empty `type` (no
    // extension, or a flavour the OS has no mapping for). Refusing it here
    // would reject a perfectly good PNG on the strength of a filename, when
    // main already sniffs the magic bytes and is the authority on this.
    await ingestFiles(
      [imageFile('screenshot', '', [0x89, 0x50, 0x4e, 0x47])],
      to,
    );

    expect(attachments().add).toHaveBeenCalledTimes(1);
    expect(attachments().add.mock.calls[0][2]).toBe('');
    expect(to.onAdded).toHaveBeenCalledWith([meta('att_a')]);
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('refuses an oversize image before it crosses IPC', async () => {
    const file = imageFile();
    Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES + 1 });
    const to = target();

    await ingestFiles([file], to);

    expect(attachments().add).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith('That image is larger than 5 MB.');
  });

  it('weighs an untyped file before handing it to main', async () => {
    const file = imageFile('screenshot', '');
    Object.defineProperty(file, 'size', { value: MAX_IMAGE_BYTES + 1 });
    const to = target();

    // Size is the one check that must not be deferred to main: deferring it
    // is what copying 40 MB across IPC to be told no looks like.
    await ingestFiles([file], to);

    expect(attachments().add).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith('That image is larger than 5 MB.');
  });

  it('names the failure without spelling out where the board lives', async () => {
    attachments().add.mockResolvedValue({
      ok: false,
      error:
        "EACCES: permission denied, open '/Users/me/notes/kanban.assets/crd_1/att_a.png'",
    });
    const to = target();

    await ingestFiles([imageFile()], to);

    expect(errorToast).toHaveBeenCalledWith('Could not save the image: EACCES');
    expect(errorToast.mock.calls[0][0]).not.toContain('/Users/me');
    expect(to.onAdded).not.toHaveBeenCalled();
  });

  it('passes through a message main already wrote for the user', async () => {
    attachments().add.mockResolvedValue({
      ok: false,
      error: 'That image is larger than 5 MB.',
    });

    await ingestFiles([imageFile()], target());

    // Main sniffs the bytes and so catches cases the renderer cannot. Its
    // verdict is already in the user's language; wrapping it would read as
    // "Could not save the image: That image is larger than 5 MB."
    expect(errorToast).toHaveBeenCalledWith('That image is larger than 5 MB.');
  });

  it('keeps the good files from a batch that also has a bad one', async () => {
    attachments()
      .add.mockResolvedValueOnce({ ok: false, error: 'EACCES: denied' })
      .mockResolvedValueOnce({ ok: true, value: meta('att_b') });
    const to = target();

    await ingestFiles([imageFile('a.png'), imageFile('b.png')], to);

    expect(errorToast).toHaveBeenCalledWith('Could not save the image: EACCES');
    expect(to.onAdded).toHaveBeenCalledWith([meta('att_b')]);
  });
});

describe('ingestPasteEvent', () => {
  it('prevents the default before awaiting when the paste is image-only', async () => {
    attachments().add.mockResolvedValue({ ok: true, value: meta('att_a') });
    const event = pasteEvent({ files: [imageFile()] });
    const to = target();

    const pending = ingestPasteEvent(event, to);

    // Asserted before the promise settles: anything after the first `await`
    // is too late for the DOM to honour.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);

    await expect(pending).resolves.toEqual({
      hadImages: true,
      hadText: false,
    });
    expect(attachments().add).toHaveBeenCalledTimes(1);
  });

  it('leaves text insertion alone when the paste carries text as well', async () => {
    attachments().add.mockResolvedValue({ ok: true, value: meta('att_a') });
    const event = pasteEvent({ files: [imageFile()], text: 'hello' });
    const to = target();

    const pending = ingestPasteEvent(event, to);
    expect(event.preventDefault).not.toHaveBeenCalled();

    await expect(pending).resolves.toEqual({ hadImages: true, hadText: true });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(attachments().add).toHaveBeenCalledTimes(1);
  });

  it('separates "no images" from "nothing at all" for a text-only paste', async () => {
    const event = pasteEvent({ text: 'hello' });
    const to = target();

    // `hadText` is what stops the caller reaching for the clipboard
    // fallback: a bare "no images" would send every ordinary text paste to
    // main, and a clipboard carrying both text and a screenshot would then
    // attach the screenshot to a paste the user meant as text.
    await expect(ingestPasteEvent(event, to)).resolves.toEqual({
      hadImages: false,
      hadText: true,
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(attachments().add).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('reports an empty paste as the one case worth asking main about', async () => {
    const event = pasteEvent({});

    await expect(ingestPasteEvent(event, target())).resolves.toEqual({
      hadImages: false,
      hadText: false,
    });
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('reports an event with no clipboard at all as empty', async () => {
    const event = {
      preventDefault: jest.fn(),
      clipboardData: null,
    } as unknown as PasteLike & { preventDefault: jest.Mock };

    await expect(ingestPasteEvent(event, target())).resolves.toEqual({
      hadImages: false,
      hadText: false,
    });
  });

  it('silently drops an unsupported image flavour pasted alongside text', async () => {
    const event = pasteEvent({
      files: [imageFile('x.heic', 'image/heic')],
      text: 'hello',
    });

    await ingestPasteEvent(event, target());

    expect(attachments().add).not.toHaveBeenCalled();
    // Spec §3.4: silent ignore is only for a mixed payload the field should
    // still accept the text of.
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('explains an unsupported image flavour pasted on its own', async () => {
    const event = pasteEvent({ files: [imageFile('x.heic', 'image/heic')] });

    await ingestPasteEvent(event, target());

    expect(errorToast).toHaveBeenCalledWith(
      'Only PNG, JPEG, GIF, and WebP images are supported.',
    );
  });
});

describe('ingestPick', () => {
  it('opens the dialog with the remaining slots and reports the batch', async () => {
    attachments().pick.mockResolvedValue({
      ok: true,
      value: {
        added: [meta('att_a'), meta('att_b')],
        skippedCap: false,
        errors: [],
      },
    });
    const to = target({ currentCount: 3 });

    await ingestPick(to);

    expect(attachments().pick).toHaveBeenCalledWith('crd_1', MAX_IMAGES - 3);
    expect(to.onAdded).toHaveBeenCalledTimes(1);
    expect(to.onAdded).toHaveBeenCalledWith([meta('att_a'), meta('att_b')]);
  });

  it('does not open the dialog at all when the card is full', async () => {
    const to = target({ currentCount: MAX_IMAGES });

    await ingestPick(to);

    expect(attachments().pick).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith('You can attach up to 10 images.');
  });

  it('toasts the cap and each rejected file while keeping the rest', async () => {
    attachments().pick.mockResolvedValue({
      ok: true,
      value: {
        added: [meta('att_a')],
        skippedCap: true,
        errors: [
          'That image is larger than 5 MB.',
          "ENOENT: no such file or directory, open '/Volumes/usb/gone.png'",
        ],
      },
    });
    const to = target();

    await ingestPick(to);

    // The picker's own verdicts stay as main wrote them; a raw filesystem
    // error becomes something a user can act on, without the path.
    expect(errorToast).toHaveBeenCalledWith('That image is larger than 5 MB.');
    expect(errorToast).toHaveBeenCalledWith('Could not save the image: ENOENT');
    expect(errorToast).toHaveBeenCalledWith('You can attach up to 10 images.');
    expect(
      errorToast.mock.calls.some(([message]: [string]) =>
        message.includes('/Volumes'),
      ),
    ).toBe(false);
    expect(to.onAdded).toHaveBeenCalledWith([meta('att_a')]);
  });

  it('toasts a failed dialog', async () => {
    attachments().pick.mockResolvedValue({
      ok: false,
      error: 'No data file is open.',
    });
    const to = target();

    await ingestPick(to);

    expect(errorToast).toHaveBeenCalledWith(
      'Could not save the image: No data file is open.',
    );
    expect(to.onAdded).not.toHaveBeenCalled();
  });
});

describe('ingestClipboardFallback', () => {
  it('adds the screenshot main found on the system clipboard', async () => {
    attachments().pasteFromClipboard.mockResolvedValue({
      ok: true,
      value: meta('att_a', 'pasted-image.png'),
    });
    const to = target();

    await ingestClipboardFallback(to);

    expect(attachments().pasteFromClipboard).toHaveBeenCalledWith('crd_1');
    expect(to.onAdded).toHaveBeenCalledWith([
      meta('att_a', 'pasted-image.png'),
    ]);
  });

  it('stays quiet when the clipboard holds no image', async () => {
    const to = target();

    await ingestClipboardFallback(to);

    expect(to.onAdded).not.toHaveBeenCalled();
    expect(errorToast).not.toHaveBeenCalled();
  });

  it('does not read the clipboard when the card is full', async () => {
    const to = target({ currentCount: MAX_IMAGES });

    await ingestClipboardFallback(to);

    expect(attachments().pasteFromClipboard).not.toHaveBeenCalled();
    expect(errorToast).toHaveBeenCalledWith('You can attach up to 10 images.');
  });

  it('names a failed write without the path it failed on', async () => {
    attachments().pasteFromClipboard.mockResolvedValue({
      ok: false,
      error: "EROFS: read-only file system, mkdir '/Volumes/ro/kanban.assets'",
    });
    const to = target();

    await ingestClipboardFallback(to);

    expect(errorToast).toHaveBeenCalledWith('Could not save the image: EROFS');
    expect(to.onAdded).not.toHaveBeenCalled();
  });
});

describe('removeStoredAttachment', () => {
  it('reports success once the file is gone', async () => {
    await expect(removeStoredAttachment('crd_1', 'att_a')).resolves.toBe(true);
    expect(attachments().remove).toHaveBeenCalledWith('crd_1', 'att_a');
  });

  it('reports failure so the caller can keep showing the thumbnail', async () => {
    attachments().remove.mockResolvedValue({ ok: false, error: 'EPERM' });

    await expect(removeStoredAttachment('crd_1', 'att_a')).resolves.toBe(false);
    expect(errorToast).toHaveBeenCalledWith('EPERM');
  });
});
