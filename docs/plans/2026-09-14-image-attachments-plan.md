# Image Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users paste, drop, or pick PNG/JPEG/GIF/WebP images onto a card and onto a chat reply, store them beside `kanban.json`, and send them to the model as real image content blocks.

**Architecture:** Main owns bytes on disk under `{basename}.assets/{cardId}/{attId}.{ext}`. The document stores only `{ id, filename, mimeType }` on `Card.attachments`. The renderer never writes image files. Card attachments persist and go on every Run; reply attachments are React state plus files on disk for that Send. The daemon reads those files and, when any images are present, calls `query()` with image blocks then a text block instead of a prompt string.

**Tech Stack:** Electron IPC, Node `fs`, Zod schema (document version stays 1), Zustand `docStore`, Claude Agent SDK `query()`, existing `sonner` toasts, lucide `Paperclip` / `X`.

**Spec:** [docs/plans/2026-09-14-image-attachments-spec.md](./2026-09-14-image-attachments-spec.md)

## Global Constraints

- Do **not** `git add` or `git commit`. Skip every Commit step. The user stages and commits.
- Document `version` stays **1**. `Card.attachments` uses `.catch([])`.
- Allowed MIME types only: `image/png`, `image/jpeg`, `image/gif`, `image/webp`. Max **5 MiB** per file. Max **10** on a card and **10** on a reply.
- Renderer never writes image bytes. Main mints `att_` ids and sniffs MIME from magic bytes (claimed type/extension is not enough).
- Prompt/reply **text is required**. Images never enable Run/Send by themselves.
- Copy prompt stays text-only. Collapsed board cards show no thumbnails. Deleting a card does **not** delete its asset subdirectory.
- New-card composer (`cardId === null`): no attachments until the card exists. Paperclip/paste/drop for images is edit-only (and view-modal). First Save still creates the card without images.
- Undo restores JSON, not unlinked bytes. Removing an attachment unlinks the file.
- Toast copy (use these strings):
  - Oversize: `That image is larger than 5 MB.`
  - Cap: `You can attach up to 10 images.`
  - Unsupported type (explicit pick/drop): `Only PNG, JPEG, GIF, and WebP images are supported.`
  - Write/ingest failure: `Could not save the image.` plus the OS error when present (`Could not save the image: EACCES`).
  - Mixed clipboard with text: still insert the text; toast only for the rejected image.
  - Mixed clipboard image that is unsupported: silent ignore of that item (spec §3.4).
- Do not bump `@anthropic-ai/claude-agent-sdk` unless the installed types refuse a user-message `prompt`. Verify the `query({ prompt })` overload against `node_modules/@anthropic-ai/claude-agent-sdk` (or the package's published types) in Task 5 before wiring `runTurn`.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/attachments.ts` | Shared types, limits, MIME sniff, path helpers, id minting |
| `src/shared/schema.ts` | `Card.attachments` |
| `src/shared/ipc.ts` | `attachments.*` channels |
| `src/shared/daemonProtocol.ts` | `images` on `run`/`reply`; `images` on user `TranscriptMessage` |
| `src/main/services/assets.ts` | Write/unlink/read/preview; pick; clipboard paste; used by IPC |
| `src/main/services/dataFile.ts` | `assetsDirFor` already in shared; move/backup copy the sibling folder |
| `src/main/services/registerIpc.ts` | Attachment IPC handlers; `dataFilePath` from settings |
| `src/main/preload.ts` | `electron.attachments` + extra `images` arg on session run/reply |
| `src/main/main.ts` | Resolve attachment ids to absolute paths; forward `images` to daemon |
| `src/main/daemon/queryPrompt.ts` | Pure: string vs multimodal content; read files; missing-file error |
| `src/main/daemon/index.ts` / `turnLifecycle.ts` | Use queryPrompt; stamp `images` on user transcript messages |
| `src/renderer/store/docStore.ts` | Default `attachments: []` on `addCard` |
| `src/renderer/lib/ingestImages.ts` | Renderer-side File/clipboard → IPC, cap checks, toasts |
| `src/renderer/components/card/ImageAttachmentStrip.tsx` | Shared thumbs + paperclip + × |
| `src/renderer/components/card/CardComposerDialog.tsx` | Strip under prompt when `cardId` set |
| `src/renderer/components/card/CardViewDialog.tsx` | Card strip above Run; reply strip; paste routing; pass `images` |
| `src/renderer/components/card/SessionTranscript.tsx` | Thumbs on user messages that have `images` |
| `src/testUtils/electronMock.ts` | Stub `attachments` and optional `images` on session |

---

### Task 1: Shared attachments module + schema

**Files:**
- Create: `src/shared/attachments.ts`
- Modify: `src/shared/schema.ts` (`CardSchema`)
- Modify: `src/renderer/store/docStore.ts` (`addCard` push — add `attachments: []`)
- Test: `src/__tests__/attachments.test.ts`
- Test: `src/__tests__/schema.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `ALLOWED_IMAGE_MIMES`, `IMAGE_EXT_BY_MIME`, `MAX_IMAGE_BYTES` (`5 * 1024 * 1024`), `MAX_IMAGES` (`10`)
  - `type AttachmentMeta = { id: string; filename: string; mimeType: AllowedImageMime }`
  - `type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'`
  - `sniffImageMime(bytes: Uint8Array): AllowedImageMime | null`
  - `extensionForMime(mime: AllowedImageMime): 'png' | 'jpg' | 'gif' | 'webp'`
  - `newAttachmentId(): string` — `att_` + 6 chars from `abcdefghijklmnopqrstuvwxyz0123456789` (same alphabet as `src/renderer/domain/ids.ts`)
  - `assetsDirFor(dataFilePath: string): string`
  - `attachmentFilePath(dataFilePath: string, cardId: string, id: string, mimeType: AllowedImageMime): string`
  - `AttachmentMetaSchema` (Zod) used by `CardSchema.attachments`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/attachments.test.ts`:

```ts
import {
  assetsDirFor,
  attachmentFilePath,
  extensionForMime,
  newAttachmentId,
  sniffImageMime,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
} from '../shared/attachments';

describe('assetsDirFor', () => {
  it('uses {basename}.assets next to the data file', () => {
    expect(assetsDirFor('/path/to/kanban.json')).toBe('/path/to/kanban.assets');
    expect(assetsDirFor('/path/to/prompts.json')).toBe('/path/to/prompts.assets');
  });
});

describe('sniffImageMime', () => {
  it('recognizes PNG magic', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(sniffImageMime(png)).toBe('image/png');
  });

  it('returns null for a PDF header', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4');
    expect(sniffImageMime(pdf)).toBeNull();
  });
});

describe('attachmentFilePath', () => {
  it('names the file {id}.{ext} from sniffed mime, not the original filename', () => {
    expect(
      attachmentFilePath('/tmp/kanban.json', 'crd_abc123', 'att_xyz789', 'image/jpeg'),
    ).toBe('/tmp/kanban.assets/crd_abc123/att_xyz789.jpg');
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
```

Add to `src/__tests__/schema.test.ts` inside `describe('parseDoc')`:

```ts
  it('defaults omitted card attachments to an empty array', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].attachments).toEqual([]);
  });

  it('keeps recognized attachments', () => {
    const raw = JSON.parse(JSON.stringify(fixture));
    raw.boards[0].lists[0].cards[0].attachments = [
      { id: 'att_aaaaaa', filename: 'shot.png', mimeType: 'image/png' },
    ];
    const result = parseDoc(raw);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.boards[0].lists[0].cards[0].attachments).toEqual([
      { id: 'att_aaaaaa', filename: 'shot.png', mimeType: 'image/png' },
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/__tests__/attachments.test.ts src/__tests__/schema.test.ts -t attachments`

Expected: FAIL — `Cannot find module '../shared/attachments'` and omitted `attachments` is `undefined`.

- [ ] **Step 3: Implement**

`src/shared/attachments.ts` (complete):

```ts
import path from 'path';
import { z } from 'zod';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 10;

export const ALLOWED_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number];

export const IMAGE_EXT_BY_MIME: Record<AllowedImageMime, 'png' | 'jpg' | 'gif' | 'webp'> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export function extensionForMime(mime: AllowedImageMime): 'png' | 'jpg' | 'gif' | 'webp' {
  return IMAGE_EXT_BY_MIME[mime];
}

export const AttachmentMetaSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.enum(ALLOWED_IMAGE_MIMES),
});
export type AttachmentMeta = z.infer<typeof AttachmentMetaSchema>;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newAttachmentId(): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `att_${suffix}`;
}

export function assetsDirFor(dataFilePath: string): string {
  const dir = path.dirname(dataFilePath);
  const ext = path.extname(dataFilePath);
  const base = path.basename(dataFilePath, ext);
  return path.join(dir, `${base}.assets`);
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

export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
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
```

In `CardSchema` after `archived`, add:

```ts
  attachments: z.array(AttachmentMetaSchema).catch([]),
```

Import `AttachmentMetaSchema` from `./attachments`.

In `addCard`'s `list.cards.push({...})`, add `attachments: []` next to `archived: false`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/__tests__/attachments.test.ts src/__tests__/schema.test.ts`

Expected: PASS (other schema cases still pass).

- [ ] **Step 5: Skip commit** — user commits.

---

### Task 2: Main ingest (add / remove / preview)

**Files:**
- Create: `src/main/services/assets.ts`
- Test: `src/__tests__/assetsIngest.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers; `readSettings().dataFilePath` is **not** used here — callers pass `dataFilePath`.
- Produces:
  - `addAttachment(dataFilePath, cardId, filename, bytes: Uint8Array): Promise<AttachmentMeta>`
  - `removeAttachment(dataFilePath, cardId, id: string): Promise<void>` — missing file is success; unlinks any allowed extension for that id
  - `previewAttachment(dataFilePath, cardId, id: string): Promise<string>` — `data:` URL; throws if missing
  - Throws `Error` with messages: `That image is larger than 5 MB.`, `Only PNG, JPEG, GIF, and WebP images are supported.`

- [ ] **Step 1: Write the failing test**

```ts
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { addAttachment, previewAttachment, removeAttachment } from '../main/services/assets';

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

describe('addAttachment', () => {
  let dir: string;
  let dataFile: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-assets-'));
    dataFile = path.join(dir, 'kanban.json');
    await fs.writeFile(dataFile, '{}', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes {id}.png under {basename}.assets/{cardId}/ and returns metadata', async () => {
    const meta = await addAttachment(dataFile, 'crd_abc123', 'shot.png', PNG);
    expect(meta.filename).toBe('shot.png');
    expect(meta.mimeType).toBe('image/png');
    expect(meta.id).toMatch(/^att_[a-z0-9]{6}$/);
    const file = path.join(dir, 'kanban.assets', 'crd_abc123', `${meta.id}.png`);
    expect(await fs.readFile(file)).toEqual(Buffer.from(PNG));
  });

  it('names a missing original filename pasted-image.{ext}', async () => {
    const meta = await addAttachment(dataFile, 'crd_abc123', '', PNG);
    expect(meta.filename).toBe('pasted-image.png');
  });

  it('refuses oversize bytes without creating a file', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    big.set(PNG.subarray(0, 8), 0);
    await expect(addAttachment(dataFile, 'crd_x', 'big.png', big)).rejects.toThrow(
      /larger than 5 MB/,
    );
    await expect(fs.access(path.join(dir, 'kanban.assets'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses non-images', async () => {
    await expect(
      addAttachment(dataFile, 'crd_x', 'doc.pdf', new TextEncoder().encode('%PDF-1.4')),
    ).rejects.toThrow(/PNG, JPEG, GIF, and WebP/);
  });

  it('removeAttachment succeeds when the file is already gone', async () => {
    await expect(removeAttachment(dataFile, 'crd_x', 'att_nope00')).resolves.toBeUndefined();
  });

  it('previewAttachment returns a data URL after add, and remove unlinks', async () => {
    const meta = await addAttachment(dataFile, 'crd_abc123', 'shot.png', PNG);
    const dataUrl = await previewAttachment(dataFile, 'crd_abc123', meta.id);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    await removeAttachment(dataFile, 'crd_abc123', meta.id);
    await expect(previewAttachment(dataFile, 'crd_abc123', meta.id)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/__tests__/assetsIngest.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/main/services/assets.ts`**

```ts
import fs from 'fs/promises';
import path from 'path';
import {
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  assetsDirFor,
  attachmentFilePath,
  extensionForMime,
  newAttachmentId,
  sniffImageMime,
  type AllowedImageMime,
  type AttachmentMeta,
} from '../../shared/attachments';

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
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('That image is larger than 5 MB.');
  }
  const mime = sniffImageMime(bytes);
  if (!mime) {
    throw new Error('Only PNG, JPEG, GIF, and WebP images are supported.');
  }
  const id = newAttachmentId();
  const dest = attachmentFilePath(dataFilePath, cardId, id, mime);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, bytes);
  return { id, filename: displayName(filename, mime), mimeType: mime };
}

export async function removeAttachment(
  dataFilePath: string,
  cardId: string,
  id: string,
): Promise<void> {
  const dir = path.join(assetsDirFor(dataFilePath), cardId);
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
  void dir;
}

export async function previewAttachment(
  dataFilePath: string,
  cardId: string,
  id: string,
): Promise<string> {
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
```

Cap-of-10 is **not** enforced in `addAttachment` (renderer + IPC know current counts; pick can add several). Main pick in Task 3 will check remaining slots.

- [ ] **Step 4: Run tests**

Run: `npx jest src/__tests__/assetsIngest.test.ts`

Expected: PASS

- [ ] **Step 5: Skip commit**

---

### Task 3: Attachment IPC (add, remove, preview, pick, pasteFromClipboard)

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/preload.d.ts` (no change if it only re-exports `ElectronApi`)
- Modify: `src/main/services/registerIpc.ts`
- Modify: `src/main/services/assets.ts` (add `pickAttachments`, `pasteAttachmentFromClipboard`)
- Modify: `src/testUtils/electronMock.ts`
- Test: `src/__tests__/assetsPick.test.ts` (pure remaining-slots helper + pick loop without Electron dialog)

**Interfaces:**
- Consumes: `addAttachment` / `removeAttachment` / `previewAttachment`; `readSettings().dataFilePath`
- Produces IPC (all return `IpcResult<...>` except as noted):

```ts
// CHANNELS
attachmentsAdd: 'attachments:add',
attachmentsRemove: 'attachments:remove',
attachmentsPreview: 'attachments:preview',
attachmentsPick: 'attachments:pick',
attachmentsPasteFromClipboard: 'attachments:paste-from-clipboard',

// preload electron.attachments
add(cardId, filename, mimeTypeIgnored, bytes: ArrayBuffer): Promise<IpcResult<AttachmentMeta>>
remove(cardId, id): Promise<IpcResult<null>>
preview(cardId, id): Promise<IpcResult<string>>  // dataUrl string, not { dataUrl }
pick(cardId): Promise<IpcResult<AttachmentMeta[]>>  // cancel → { ok: true, value: [] }
pasteFromClipboard(cardId): Promise<IpcResult<AttachmentMeta | null>>  // empty clipboard → null
```

Note: spec wrote preview as `{ dataUrl }`. Use `IpcResult<string>` (the data URL) to match other channels. Renderer: `result.value` is the `src`.

When `dataFilePath` is null, every handler returns `{ ok: false, error: 'No data file is open.' }`.

`pickAttachments(dataFilePath, cardId, filePaths: string[], remainingSlots: number)`: for each path, read file, skip/throw per-file; stop adding when remaining slots hit 0 (throw cap error only if **no** file was added and the user picked at least one? Spec: further adds refused with toast. If user picks 3 and 2 slots remain, write 2 and the caller toasts cap. Return the written metas. Implement:

```ts
export async function addAttachmentsFromPaths(
  dataFilePath: string,
  cardId: string,
  filePaths: string[],
  remainingSlots: number,
): Promise<{ added: AttachmentMeta[]; skippedCap: boolean; errors: string[] }>
```

`remainingSlots` comes from the renderer (`MAX_IMAGES - currentCount`) passed as a second IPC arg: `pick(cardId, remainingSlots)`. Spec table only listed `{ cardId }`. **Lock:** `pick({ cardId, remainingSlots })` so main can stop at 10 without reading the JSON.

`pasteFromClipboard`: `clipboard.readImage()`; if `image.isEmpty()` return `null`; else `addAttachment(..., 'pasted-image.png', image.toPNG())`.

Register pick with `dialog.showOpenDialog`: `properties: ['openFile', 'multiSelections']`, filters Images `png, jpg, jpeg, gif, webp`.

- [ ] **Step 1: Write failing tests for `addAttachmentsFromPaths`**

In `src/__tests__/assetsIngest.test.ts` (same tmpdir pattern), add:

```ts
import { addAttachmentsFromPaths } from '../main/services/assets';

it('adds two paths and flags skippedCap when remainingSlots is 1', async () => {
  const a = path.join(dir, 'a.png');
  const b = path.join(dir, 'b.png');
  await fs.writeFile(a, PNG);
  await fs.writeFile(b, PNG);
  const result = await addAttachmentsFromPaths(dataFile, 'crd_abc123', [a, b], 1);
  expect(result.added).toHaveLength(1);
  expect(result.skippedCap).toBe(true);
});
```

- [ ] **Step 2: Run — fail on missing export**

- [ ] **Step 3: Implement helper + IPC**

`addAttachmentsFromPaths`: loop paths; if `added.length >= remainingSlots` set `skippedCap` and break; try `addAttachment` with `path.basename(p)` and `new Uint8Array(await fs.readFile(p))`; on type/size error push `errors`.

`registerIpc` handlers wrap with try/catch `fail(error)`. For add, convert `bytes: ArrayBuffer` to `new Uint8Array(bytes)`.

`electronMock.ts` add:

```ts
attachments: {
  add: jest.fn().mockResolvedValue({ ok: true, value: { id: 'att_mock1', filename: 'x.png', mimeType: 'image/png' } }),
  remove: jest.fn().mockResolvedValue({ ok: true, value: null }),
  preview: jest.fn().mockResolvedValue({ ok: true, value: 'data:image/png;base64,AAAA' }),
  pick: jest.fn().mockResolvedValue({ ok: true, value: [] }),
  pasteFromClipboard: jest.fn().mockResolvedValue({ ok: true, value: null }),
},
```

Also add `data.backup: jest.fn()` if still missing so later tests do not smash the stub.

- [ ] **Step 4: Run `npx jest src/__tests__/assetsIngest.test.ts`** — PASS

- [ ] **Step 5: Skip commit**

---

### Task 4: Move and backup copy `{basename}.assets`

**Files:**
- Modify: `src/main/services/dataFile.ts`
- Test: `src/__tests__/backupDataFile.test.ts`
- Test: `src/__tests__/moveDataFile.test.ts` (create)

**Interfaces:**
- Consumes: `assetsDirFor` from `src/shared/attachments.ts`
- Produces: `backupDataFile` / `moveDataFile` also relocate the sibling assets directory. Export `assetsBackupDirFor(jsonBackupPath: string)` = `assetsDirFor(jsonBackupPath)` (backup json `kanban-bak-….json` → `kanban-bak-….assets`).

Behavior:

**backup:** After successful `copyFile` of JSON:
1. If source assets dir missing → return json dest (today).
2. Else `fs.cp(srcAssets, destAssets, { recursive: true })`.
3. If that throws, `await fs.unlink(jsonDest)` then rethrow so a JSON-only backup is never reported as success.

**move:** After JSON is written, verified, and source JSON unlinked (existing contract):
1. If source assets missing → return.
2. If dest assets exists (overwrite case) → `fs.rm(destAssets, { recursive: true, force: true })`.
3. `fs.rename(srcAssets, destAssets)` ; on `EXDEV`, `fs.cp` recursive then `fs.rm` source.
4. Failure here throws; do **not** move the JSON back.

- [ ] **Step 1: Failing tests**

Extend `backupDataFile.test.ts`:

```ts
  it('copies the sibling .assets folder next to the backup json', async () => {
    const at = new Date(2026, 8, 14, 12, 7, 5);
    const assets = path.join(dir, 'kanban.assets', 'crd_x');
    await fs.mkdir(assets, { recursive: true });
    await fs.writeFile(path.join(assets, 'att_a.png'), 'img');
    await backupDataFile(source, at);
    const copied = path.join(dir, 'kanban-bak-2026-09-14T12-07-05.assets', 'crd_x', 'att_a.png');
    expect(await fs.readFile(copied, 'utf8')).toBe('img');
    expect(await fs.readFile(path.join(assets, 'att_a.png'), 'utf8')).toBe('img');
  });

  it('succeeds with no assets folder', async () => {
    const dest = await backupDataFile(source, new Date(2026, 8, 14, 12, 7, 5));
    expect(await fs.readFile(dest, 'utf8')).toBe('{"version":1}\n');
  });
```

`src/__tests__/moveDataFile.test.ts`:

```ts
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { moveDataFile } from '../main/services/dataFile';

describe('moveDataFile assets', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-move-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('renames kanban.assets to prompts.assets after the json move', async () => {
    const from = path.join(dir, 'kanban.json');
    const to = path.join(dir, 'prompts.json');
    await fs.writeFile(from, '{"version":1}', 'utf8');
    const srcDir = path.join(dir, 'kanban.assets', 'crd_x');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, 'att_a.png'), 'img');

    await moveDataFile(from, to);

    expect(await fs.readFile(to, 'utf8')).toBe('{"version":1}');
    await expect(fs.access(from)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(dir, 'prompts.assets', 'crd_x', 'att_a.png'), 'utf8')).toBe('img');
    await expect(fs.access(path.join(dir, 'kanban.assets'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
```

- [ ] **Step 2: Run — fail because assets stay put**

- [ ] **Step 3: Implement in `dataFile.ts`**

Import `assetsDirFor`. Helper:

```ts
async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function relocateAssets(fromFile: string, toFile: string): Promise<void> {
  const fromDir = assetsDirFor(fromFile);
  const toDir = assetsDirFor(toFile);
  if (!(await dirExists(fromDir))) return;
  if (await dirExists(toDir)) {
    await fs.rm(toDir, { recursive: true, force: true });
  }
  try {
    await fs.rename(fromDir, toDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await fs.cp(fromDir, toDir, { recursive: true });
    await fs.rm(fromDir, { recursive: true, force: true });
  }
}
```

Call `relocateAssets(from, to)` at the end of `moveDataFile`. In `backupDataFile`, after JSON copy, `if (await dirExists(assetsDirFor(from))) { try { await fs.cp(...) } catch (e) { await fs.unlink(to).catch(() => {}); throw e; } }`.

- [ ] **Step 4: Run both test files — PASS**

- [ ] **Step 5: Skip commit**

---

### Task 5: Daemon multimodal prompt + transcript image refs

**Files:**
- Create: `src/main/daemon/queryPrompt.ts`
- Modify: `src/shared/daemonProtocol.ts`
- Modify: `src/main/daemon/turnLifecycle.ts` (`appendUserMessage` / `startTurnSnapshot`)
- Modify: `src/main/daemon/index.ts` (`runTurn` options + `query({ prompt })`)
- Test: `src/__tests__/queryPrompt.test.ts`
- Test: `src/__tests__/daemonTurnLifecycle.test.ts` (user message `images`)

**Interfaces:**
- Consumes: Node `fs` for reads
- Produces:

```ts
export type DaemonImage = { path: string; mimeType: string; filename: string };

export type TranscriptImageRef = {
  filename: string;
  mimeType: string;
  cardId: string;
  id: string;
};

// daemonProtocol TranscriptMessage
images?: TranscriptImageRef[];  // only meaningful for kind: 'user'

// DaemonRequest run and reply
images?: DaemonImage[];

export class UnreadableImageError extends Error {
  constructor(filename: string) {
    super(`Could not read image ${filename}`);
    this.name = 'UnreadableImageError';
  }
}

export async function buildQueryPrompt(
  text: string,
  images: DaemonImage[] | undefined,
): Promise<string | SDKUserPrompt>
```

`SDKUserPrompt` must match the Agent SDK. **Before implementing `runTurn`**, open the installed SDK types and copy the exact `prompt` user-message shape. Expected shape (confirm, do not invent a second one):

```ts
{
  type: 'user',
  message: {
    role: 'user',
    content: Array<
      | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
      | { type: 'text'; text: string }
    >;
  };
}
```

If the installed SDK's `query` only accepts `string`, stop and bump to a version that accepts this (check `npm show @anthropic-ai/claude-agent-sdk version` then install that version — do not guess a version from memory). Empty/omitted `images` → return `text` unchanged (string). Non-empty: read each file as base64 **in order**; first missing file throws `UnreadableImageError` and does **not** call `query`. Content order: all image blocks, then one text block.

`runTurn` extra option `images?: DaemonImage[]`. Before `query`, `const promptArg = await buildQueryPrompt(prompt, options.images)` inside try; catch `UnreadableImageError` → `status: 'failed', lastError: error.message`, `finishTurn()`, return.

`startTurnSnapshot(previous, kind, replyText?, replyImages?: TranscriptImageRef[])`. `appendUserMessage` copies `images` onto the user `TranscriptMessage` when non-empty. `index.ts` reply handler passes `request.images` into `runTurn`; for transcript refs, daemon does not have cardId-relative ids on `DaemonImage`. **Lock:** extend `DaemonImage` to:

```ts
{ path: string; mimeType: string; filename: string; cardId: string; id: string }
```

`startTurnSnapshot` maps those to `TranscriptImageRef` (drop `path`). Main still sends absolute `path`.

- [ ] **Step 1: Failing tests**

`src/__tests__/queryPrompt.test.ts`:

```ts
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildQueryPrompt, UnreadableImageError } from '../main/daemon/queryPrompt';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('buildQueryPrompt', () => {
  it('returns the string when images is omitted or empty', async () => {
    expect(await buildQueryPrompt('hello', undefined)).toBe('hello');
    expect(await buildQueryPrompt('hello', [])).toBe('hello');
  });

  it('orders image blocks then text, and fails before query on a missing file', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-kanban-qp-'));
    const file = path.join(dir, 'att_a.png');
    await fs.writeFile(file, PNG);
    const prompt = await buildQueryPrompt('look', [
      { path: file, mimeType: 'image/png', filename: 'shot.png', cardId: 'crd_1', id: 'att_a' },
    ]);
    expect(typeof prompt).toBe('object');
    const content = (prompt as { message: { content: unknown[] } }).message.content;
    expect(content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png' },
    });
    expect(content[1]).toEqual({ type: 'text', text: 'look' });

    await expect(
      buildQueryPrompt('look', [
        { path: path.join(dir, 'missing.png'), mimeType: 'image/png', filename: 'screenshot.png', cardId: 'crd_1', id: 'att_z' },
      ]),
    ).rejects.toBeInstanceOf(UnreadableImageError);
    await expect(
      buildQueryPrompt('look', [
        { path: path.join(dir, 'missing.png'), mimeType: 'image/png', filename: 'screenshot.png', cardId: 'crd_1', id: 'att_z' },
      ]),
    ).rejects.toThrow('Could not read image screenshot.png');
    await fs.rm(dir, { recursive: true, force: true });
  });
});
```

In `daemonTurnLifecycle.test.ts`, add a case: `startTurnSnapshot(s, 'reply', 'see this', [{ filename: 'a.png', mimeType: 'image/png', cardId: 'crd_1', id: 'att_a' }])` → last message `kind: 'user'`, `text: 'see this'`, `images` length 1. Existing reply-without-images tests must still omit `images`.

- [ ] **Step 2: Run — fail**

- [ ] **Step 3: Implement queryPrompt, protocol, turnLifecycle, index.ts wiring**

`runTurn(..., options)` currently takes `prompt: string`. Keep that string for `startTurnSnapshot` / user transcript. Pass `options.images` into `buildQueryPrompt` for the SDK only.

Reply path: `startTurnSnapshot(snapshot, 'reply', prompt, transcriptImagesFrom(options.images))`.

- [ ] **Step 4: Run `npx jest src/__tests__/queryPrompt.test.ts src/__tests__/daemonTurnLifecycle.test.ts`** — PASS

- [ ] **Step 5: Skip commit**

---

### Task 6: Main session IPC resolves ids to paths

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts` (`session.run` / `session.reply` last optional arg)
- Modify: `src/testUtils/electronMock.ts` (no behavior change required)

**Interfaces:**
- Consumes: `readSettings`, `attachmentFilePath`, `ALLOWED_IMAGE_MIMES` (try each ext if mime missing)
- Produces:

Renderer sends **refs**, not absolute paths:

```ts
export type AttachmentRef = {
  id: string;
  cardId: string;
  filename: string;
  mimeType: AllowedImageMime;
};
```

Put `AttachmentRef` in `src/shared/attachments.ts`.

```ts
session.run(cardId, prompt, cwd, approvalMode, model, images?: AttachmentRef[])
session.reply(cardId, text, cwd, approvalMode, model, sessionId, images?: AttachmentRef[])
```

Main maps each ref with `attachmentFilePath(dataFilePath, ref.cardId, ref.id, ref.mimeType)` after `readSettings()`. If no data file, reject the invoke. Forward `images: DaemonImage[]` to the daemon (include `cardId` and `id`).

Do **not** read files in main for the turn; the daemon does.

- [ ] **Step 1: No isolated test for main.ts** (Electron). Cover via CardViewDialog in Task 8 asserting `session.run`/`reply` mock last argument. If you add a tiny `resolveDaemonImages(dataFilePath, refs: AttachmentRef[]): DaemonImage[]` in `src/main/services/assets.ts`, test it:

```ts
it('joins data file, card id, attachment id, and mime ext', () => {
  expect(
    resolveDaemonImages('/tmp/kanban.json', [
      { id: 'att_a', cardId: 'crd_1', filename: 'a.png', mimeType: 'image/png' },
    ]),
  ).toEqual([
    {
      path: '/tmp/kanban.assets/crd_1/att_a.png',
      mimeType: 'image/png',
      filename: 'a.png',
      cardId: 'crd_1',
      id: 'att_a',
    },
  ]);
});
```

- [ ] **Step 2: Fail then implement `resolveDaemonImages` + wire main/preload**

- [ ] **Step 3: Run ingest + queryPrompt tests still PASS**

- [ ] **Step 4: Skip commit**

---

### Task 7: `ImageAttachmentStrip` + renderer ingest helper

**Files:**
- Create: `src/renderer/lib/ingestImages.ts`
- Create: `src/renderer/components/card/ImageAttachmentStrip.tsx`
- Test: `src/__tests__/ingestImages.test.ts`
- Test: `src/__tests__/imageAttachmentStrip.test.tsx`

**Interfaces:**
- Consumes: `api.attachments.*`, `MAX_IMAGES`, toast strings
- Produces:

```ts
export type IngestTarget = {
  cardId: string;
  currentCount: number;
  onAdded: (meta: AttachmentMeta | AttachmentMeta[]) => void;
};

export async function ingestFiles(files: File[], target: IngestTarget): Promise<void>
export async function ingestPasteEvent(event: ClipboardEvent, target: IngestTarget): Promise<boolean>
// returns true if any image File was found (caller should preventDefault)
export async function ingestPick(target: IngestTarget): Promise<void>
export async function ingestClipboardFallback(target: IngestTarget): Promise<void>
export async function removeStoredAttachment(cardId: string, id: string): Promise<void>
```

`ingestFiles`: for each `File`, if `currentCount + added >= MAX_IMAGES` toast cap and stop; `arrayBuffer()` → `api.attachments.add(cardId, file.name, file.type, buffer)`; on `{ ok: false }` toast write failure; on success `onAdded(meta)` and bump local added count. Do not call add for application/pdf etc. — toast unsupported (explicit drop).

`ingestPasteEvent`: collect `item.getAsFile()` where `type.startsWith('image/')`; if none, return `false`. If some, `preventDefault` is the caller's job when this returns true; then `ingestFiles`. Text in the same paste is **not** consumed by this helper.

`ingestPick`: `api.attachments.pick(cardId, MAX_IMAGES - currentCount)`; toast cap if `value.length === 0` and we needed to know skippedCap — pick IPC should return `{ added, skippedCap }` **or** renderer toasts cap when `currentCount + value.length === MAX_IMAGES` only if user expected more (unknown). **Lock pick IPC result** as `IpcResult<AttachmentMeta[]>` plus toast in renderer: if `remainingSlots === 0` before pick, toast cap and do not open dialog (`if (target.currentCount >= MAX_IMAGES) { toast.error('You can attach up to 10 images.'); return; }`).

`ingestClipboardFallback`: `api.attachments.pasteFromClipboard(cardId)` after renderer found no image files; if `value` non-null, `onAdded(value)` (still honor cap first).

Strip UI:

- Props: `cardId: string; items: AttachmentMeta[]; onChange: (next: AttachmentMeta[]) => void; disabled?: boolean`
- Renders a row of `<img alt={filename} title={filename} />` from `api.attachments.preview` (placeholder gray box on `{ ok: false }`).
- × button `aria-label={`Remove ${filename}`}` → `removeStoredAttachment` then `onChange` without that id. For **reply** strip, pass `persistRemovals?: boolean` default true; when false, only `onChange` (do not unlink until... spec says reply files stay for transcript; removing from composer before send **should** unlink). Reply × calls `remove` IPC too.
- Paperclip `Button variant="ghost" size="icon-sm" aria-label="Attach images"` → `ingestPick`.

- [ ] **Step 1: Tests**

`ingestImages.test.ts` with `installElectronMock()`, mock `toast.error`. Assert `add` called with ArrayBuffer; cap short-circuits before add when `currentCount === 10`.

`imageAttachmentStrip.test.tsx`: render with one item; preview mock; click remove calls `attachments.remove` and `onChange([])`.

- [ ] **Step 2: Fail, implement, pass**

- [ ] **Step 3: Skip commit**

---

### Task 8: Wire composer, view modal, Run/Send

**Files:**
- Modify: `src/renderer/components/card/CardComposerDialog.tsx`
- Modify: `src/renderer/components/card/CardViewDialog.tsx`
- Modify: `src/renderer/components/card/SessionTranscript.tsx`
- Test: `src/__tests__/cardComposerDialog.test.tsx` (strip only when `cardId` set)
- Test: `src/__tests__/cardViewDialogSession.test.tsx` (Run/Send `images`; empty text)
- Test: `src/__tests__/sessionTranscript.test.tsx` (user thumbs)
- Test: `src/__tests__/cardViewDialogArchive.test.tsx` — Archive still left of Copy

**Interfaces:**
- Consumes: strip, ingest helpers, `AttachmentRef`
- Produces: user-visible paste/drop/paperclip; Run/Send payloads

**Composer (existing card only):**
- Below the prompt textarea, `<ImageAttachmentStrip cardId={cardId} items={existing.attachments} onChange={(next) => updateCard(..., { attachments: next })} />`.
- `onPaste` / `onDrop` on the prompt textarea: `ingestPasteEvent` / `ingestFiles` from `dataTransfer.files`; `preventDefault` on drop of files; `onDragOver preventDefault`.
- Adding is immediate `updateCard` (one undo step) after successful IPC, via `onChange([...items, meta])`. Do not wait for Save.

**View modal:**
- Card strip between `PromptBody` and notes (or between prompt and Run footer conceptually — spec: above Run). Place after `PromptBody`, before notes.
- Same `updateCard` binding as composer.
- Reply: `useState<AttachmentMeta[]>([])`. Strip under the reply `Input`. On successful `session.reply`, `setReplyAttachments([])` (files remain on disk).
- Paste on `DialogContent`: if `event.target` is the reply input (or `document.activeElement` is that input), ingest into reply state (`onAdded` concatenates local state, **no** `updateCard`); else ingest into card attachments. If reply ingest returns false (no image files), call `ingestClipboardFallback` only when the reply field is focused; otherwise card fallback.
- `canSendReply` must include `reply.trim().length > 0` (images do not count). `run` already requires `card.prompt`; keep `if (!card.prompt.trim()) return` and disable Run when prompt is whitespace (`disabled={!cwd || !card.prompt.trim()}`).
- `run`: `api.session.run(..., card.attachments.map(a => ({ ...a, cardId })))`.
- `sendReply`: `api.session.reply(..., replyAttachments.map(...))` then clear reply text **and** reply attachment state.

**Transcript:**
- For `message.kind === 'user' && message.images?.length`, render a flex row of `<img>` using `api.attachments.preview(message.images[i].cardId, message.images[i].id)` above the text. Missing preview → placeholder. `alt={filename}`.

- [ ] **Step 1: Failing component tests**

Composer: open edit of existing card → `getByLabelText('Attach images')`; open new prompt → query that label absent.

View session test: set `attachments` on the card; click Run; expect `window.electron.session.run` last arg to equal refs. Reply with text + local images: fire Send; expect `session.reply` last arg. Reply with only images and empty text: Send disabled.

Transcript: applySnapshot user message with `images: [{ filename: 'a.png', mimeType: 'image/png', cardId: 'crd_1', id: 'att_a' }]`; expect `img` with `alt="a.png"` after preview resolves.

Archive test: still `Archive` then `Copy` in footer.

- [ ] **Step 2: Implement UI wiring**

Prevent the prompt textarea from inserting file names on drop (`event.preventDefault()`).

For drop of a folder or `.heic`, toast unsupported (explicit drop).

- [ ] **Step 3: Run**

`npx jest src/__tests__/cardComposerDialog.test.tsx src/__tests__/cardViewDialogSession.test.tsx src/__tests__/sessionTranscript.test.tsx src/__tests__/cardViewDialogArchive.test.tsx src/__tests__/imageAttachmentStrip.test.tsx src/__tests__/ingestImages.test.ts`

Expected: PASS. Pre-existing `modelPickerOverrides.test.tsx` Radix/jsdom failures are out of scope.

- [ ] **Step 4: Skip commit**

---

## Self-review (spec coverage)

| Spec section | Task |
|---|---|
| Sibling `.assets` layout, MIME/ext, 5 MiB, cap 10 | 1–3 |
| Document `attachments`, version 1 | 1 |
| IPC add/remove/preview/pick/clipboard fallback | 2–3 |
| Renderer never writes bytes | 2–3, 7 |
| Card vs reply ownership; delete card keeps files | 2, 8 |
| Move + backup assets | 4 |
| Daemon `images`, content order, missing file | 5–6 |
| Transcript `images` on user messages | 5, 8 |
| Text required | 8 |
| Shared strip, paste/drop/paperclip, no board thumbs, copy text-only | 7–8 |
| Toasts | 7 |
| New unsaved card: no attachments | 8 + Global Constraints |

No video/PDF/base64-in-JSON/OCR/cropping.

---

## Manual check (not automated)

Paste a macOS screenshot into the view-modal reply box; Run a card with a photo and confirm Claude describes it. jsdom cannot do this.
