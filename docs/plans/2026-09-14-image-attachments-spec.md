# AI Kanban — Image Attachments Design Spec

**Date:** 2026-09-14
**Status:** Approved
**Base specs:** [2026-09-04-ai-kanban-spec.md](./2026-09-04-ai-kanban-spec.md), [2026-09-09-ai-kanban-agent-sessions-spec.md](./2026-09-09-ai-kanban-agent-sessions-spec.md)

## 1. Purpose

Let a user attach photos to a card and to a chat reply the same way other Claude chat UIs do: paste, drag-and-drop, or a paperclip picker; see thumbnails; remove them; then have those pixels go to the model as real image content (not a path dumped into the prompt).

Two surfaces, one asset store:

- **Card attachments** travel with the card. Every Run (and Run again) sends the card's current prompt **and** its current attachments.
- **Reply attachments** belong to that one Send. They are not written onto the card. After a successful send they leave the composer (thumbnails may still appear on that user turn in the transcript).

Prompt or reply **text is required**. Images are optional extras, never a substitute for text.

## 2. Non-goals

- Video, audio, PDFs, or arbitrary file types.
- Embedding image bytes in `kanban.json`.
- Copying images onto the system clipboard when the user copies a prompt (Copy stays text-only).
- Editing/cropping images in-app.
- OCR or "describe this image" as a separate feature — the model sees the pixels on Run/Send like any other chat.
- A dedicated attachments pane on the collapsed board card. Thumbnails live in the edit composer and the view/chat modal.

## 3. Storage

### 3.1 Sibling asset folder

For a data file `/path/to/kanban.json`, images live in `/path/to/kanban.assets/`. The rule is: directory of the data file + `{basename}.assets`, where `basename` is the filename without its last extension (`kanban.json` → `kanban.assets`, `prompts.json` → `prompts.assets`).

The folder is created lazily on the first successful ingest. An empty board has no assets directory.

### 3.2 On-disk layout

```
kanban.json
kanban.assets/
  crd_xxxxxx/
    att_yyyyyy.png
    att_zzzzzz.jpg
```

- One subdirectory per card id.
- One file per attachment, named `{attachmentId}.{ext}`.
- `ext` is taken from the sniffed MIME type, not the original filename (`image/png` → `png`, `image/jpeg` → `jpg`, `image/gif` → `gif`, `image/webp` → `webp`).
- The original filename is stored only in the document, for display.

Reply-only images (not on the card) use the same card subdirectory with a distinct id. They are not referenced from `kanban.json`. The transcript snapshot may point at that file for as long as it remains on disk.

### 3.3 Document fields

`Card` gains:

```
attachments: Array<{
  id: string;          // att_ + 6 chars, same id helper as other entities
  filename: string;    // original name, e.g. "screenshot.png"
  mimeType: string;    // one of the allowed MIME types below
}>
```

Omitted or missing on old files → `[]` via Zod `.catch([])`. Document `version` stays **1**. This is the same additive, tolerant pattern as `notes`, `color`, and `archived`.

Ids in `attachments` must match files under `kanban.assets/{cardId}/`. A missing file at Run/Send is an error for that turn (toast / session `lastError`), not a crash. The whole turn fails before `query()` is called — the readable attachments are **not** sent without the missing one, since a prompt referring to a screenshot the model never received is worse than a turn that names the file. See §6 and §8.

### 3.4 Allowed types and limits

| MIME | Extensions accepted from picker/drop |
|---|---|
| `image/png` | `.png` |
| `image/jpeg` | `.jpg`, `.jpeg` |
| `image/gif` | `.gif` |
| `image/webp` | `.webp` |

- **Max size:** 5 MiB per image (Anthropic's practical per-image cap). Oversize ingest is refused with a toast; nothing is written.
- **Max count:** 10 images on a card, and 10 on a single reply. Further adds are refused with a toast.
- **Clipboard screenshots** with no filename are named `pasted-image.{ext}`.

Anything else (HEIC, SVG, a PDF, a folder) is ignored for that item, with a toast if the user explicitly picked/dropped it. Silent ignore is only for mixed clipboard payloads that also contain text the field should still accept.

## 4. Ingest (main process)

The renderer never writes image bytes to disk. Main exposes:

| IPC | Role |
|---|---|
| `attachments.add` | `{ cardId, filename, mimeType, bytes: ArrayBuffer }` → writes the file, returns `{ id, filename, mimeType }` |
| `attachments.remove` | `{ cardId, id }` → unlinks the file if present (missing file is success) |
| `attachments.preview` | `{ cardId, id }` → `{ ok, value: dataUrl }` for `<img src>` (reads the file; no custom protocol required) |
| `attachments.pick` | `{ cardId, remainingSlots }` → native multi-select image dialog; main reads each path, writes into the card's asset dir up to `remainingSlots`, returns `{ ok, value: AttachmentMeta[] }`. Cancelled dialog → `{ ok: true, value: [] }` |

Paste and drop originate in the renderer (they already have `File` / clipboard items). Those go through `attachments.add` as bytes. The paperclip uses `attachments.pick` so native paths stay in main.

Clipboard screenshots that never appear as `File` objects (common on macOS) are read in main via `clipboard.readImage()` when the renderer reports a paste with no files and no usable `text/plain` hijack — the reply/composer paste handler asks main `attachments.pasteFromClipboard(cardId)` as a fallback after checking `clipboardData.items`.

### 4.1 Who owns the card record

`attachments.add` writes the **file** only. The renderer then `updateCard`s (or, for replies, holds local state) so ingest remains one undo step with the document mutation, matching tags-on-save.

Reply attachments skip `updateCard`. They live in React state on `CardViewDialog` plus files on disk until Send succeeds, then the composer list is cleared. Files are left in place so the transcript can still preview them.

Removing a **card** attachment: renderer calls `attachments.remove` and patches `card.attachments` in the same user action (one undo step for the JSON; the file is not restored by undo — acceptable, same class as "undo cannot revive a deleted session").

Deleting a **card** does **not** delete its asset subdirectory. Archived cards keep their files. Orphans after a card delete are acceptable; restoring via undo still has the files.

## 5. Move and backup

- **Move data file:** after the JSON has been written, verified, and the old JSON unlinked (existing `moveDataFile` contract), rename/copy `{fromBasename}.assets` to `{toBasename}.assets` in the destination directory. If the source assets folder does not exist, do nothing. If the user confirmed overwriting an existing JSON, replace a destination assets folder if one exists (it belongs to the file being replaced). Failure to move assets after a successful JSON move is reported as an error; the JSON is already at the new path (do not try to roll the JSON back).
- **Create Backup:** copy the JSON as today **and**, if present, copy the assets folder to `{backupBasename}.assets` next to `{backupBasename}.json` (e.g. `kanban-bak-2026-09-14T12-07-05.json` + `kanban-bak-2026-09-14T12-07-05.assets/`). A JSON-only backup when assets exist is incomplete and must not be reported as success.

## 6. Daemon / model

`run` and `reply` on the daemon protocol gain an optional `images` array:

```
{ path: string; mimeType: string; filename: string; cardId: string; id: string }[]
```

`path` is an absolute filesystem path main resolved from the asset folder. `cardId` and `id` ride along so the daemon can record a path-free transcript reference (below) without having to re-derive one from the path. Empty or omitted `images` keeps today's string `prompt` / `text` behavior — no SDK shape change for text-only turns.

When `images` is non-empty, `query()` is called with a user message whose `content` is:

1. One `image` block per file (base64 source, `media_type` = `mimeType`), in attachment order.
2. One `text` block with the prompt/reply string.

The daemon reads files itself. A missing/unreadable file fails that turn with a clear `lastError` (`Could not read image screenshot.png`) and does not start the SDK call.

`startTurnSnapshot` still records the user's text. User transcript entries gain optional `images?: { filename: string; mimeType: string; cardId: string; id: string }[]` so the View can request previews. Older cached snapshots without `images` render as they do today.

Text-only Send/Run guards stay: whitespace-only text is refused even if images are queued.

## 7. UI

Shared `ImageAttachmentStrip`: thumbnails (via `attachments.preview`), filename on hover, × to remove, paperclip button. Used under the prompt in the **edit composer** and under the reply field in the **view modal**.

**Edit composer:** strip bound to `card.attachments`. Paste into the prompt textarea (and the strip) adds images instead of inserting binary garbage. Drop on the prompt field or strip. Paperclip calls `attachments.pick`. Save is **not** required to persist a newly added card image: adding writes the file and updates the card immediately (one undo step), so Run from the view sees it without an extra Save. Closing the composer does not discard attachments already written.

**View modal:**
- Card attachments shown above Run (same strip; can add/remove there too, so attaching before Run does not require Edit).
- Reply composer has its own strip (ephemeral). Paste/drop/paperclip target the reply field while it is focused; otherwise, if the view is open and the reply box is not focused, paste into the dialog adds to **card** attachments — except when the reply input is focused, then paste adds to the reply.
- Send stays disabled when reply text is empty, even with reply images. Run stays disabled when the prompt is empty, even with card images. (Existing "no cwd" disable still applies to Run.)

**Collapsed board card:** no image thumbnails. A card with attachments looks like any other card on the board.

**Transcript:** a user message that had images renders a row of small thumbnails above/beside the text.

Toasts: oversize, too many, unsupported type, ingest/write failure, missing file at Run/Send.

## 8. Error handling

| Case | Behavior |
|---|---|
| Oversize / wrong type / at cap | Toast; no file written; existing attachments unchanged |
| Disk write failure | Toast with the OS error; no document patch |
| Missing file at Run/Send | Turn fails with `lastError`; no SDK `query()` |
| Assets folder missing on preview | Thumbnail placeholder, not a dialog crash |
| Paste of text + image | Image ingested; text still goes into the focused field |
| Paste of image only into prompt/reply | Image ingested; field text unchanged |

## 9. Testing

Unit/component tests (no live model, no real clipboard hardware):

- `backupPath` / asset-folder sibling naming (`kanban.json` → `kanban.assets`).
- Schema: omitted `attachments` → `[]`; recognized entries kept.
- `backupDataFile` / `moveDataFile` copy or relocate the assets folder with the JSON.
- Ingest helpers: MIME/extension mapping, 5 MiB reject, cap of 10.
- Daemon prompt builder: text-only stays a string; with images, content order is images then text; missing file does not call `query`.
- Composer/view: Archive/Copy layout unchanged; strip appears; adding calls IPC; Send/Run remain disabled with images but empty text; reply Send includes `images` in `session.reply`.

Untestable here, same as the rest of the app: a real Claude turn that "sees" a screenshot, and OS-level clipboard flavors that jsdom cannot reproduce. Those stay a manual check.

## 10. Decisions already locked

- Sibling `.assets` folder, not base64 in JSON.
- Paste, drag-and-drop, and paperclip picker.
- Prompt/reply text required; images optional.
- Multimodal content blocks to the Agent SDK, not "please Read this path".
