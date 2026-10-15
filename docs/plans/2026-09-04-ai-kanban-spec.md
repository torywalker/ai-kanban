# AI Kanban — Design Spec

**Date:** 2026-09-04
**Status:** Agreed (resolved via design interview)
**Plan:** [2026-09-04-ai-kanban-plan.md](./2026-09-04-ai-kanban-plan.md)

## 1. Purpose

A local-only desktop Kanban board whose cards are **AI prompts**. The board's
columns represent prompt lifecycle state (Waiting / In Flight / Done). The
primary daily action is *find a prompt and copy it to the clipboard*.

It is a prompt **library with status**, not a chat client. v1 never calls a
model API.

## 2. Non-goals (v1)

- Running prompts against any API (no API keys, streaming, cost tracking, model picker).
- Cloud sync, sharing, or multi-user anything.
- Attachments, images, due dates, checklists, assignees.
- Prompt version history.
- Export to other formats — the data file *is* the export.
- Multi-window.

## 3. Storage

### 3.1 Format

A single **pretty-printed JSON** file (2-space indent), chosen for
inspectability and universal importability. Multi-line prompts appear as
`\n`-escaped strings; this was accepted knowingly over YAML.

```json
{
  "version": 1,
  "tags": {
    "code":   { "color": "#4f8ef7" },
    "review": { "color": "#e0a341" }
  },
  "boards": [
    {
      "id": "brd_a1b2c3",
      "name": "Client Work",
      "lists": [
        {
          "id": "lst_d4e5f6",
          "name": "Waiting",
          "cards": [
            {
              "id": "crd_g7h8i9",
              "title": "Refactor auth",
              "prompt": "You are a senior engineer.\n\nReview {{file}} for {{concern}}.",
              "tags": ["code", "review"],
              "notes": "First run hallucinated the middleware API.",
              "link": "https://github.com/org/repo/pull/812",
              "variables": { "file": "src/auth.ts", "concern": "race conditions" },
              "copyCount": 4,
              "lastCopiedAt": "2026-09-04T14:22:10.000Z",
              "createdAt": "2026-08-30T09:00:00.000Z",
              "updatedAt": "2026-09-04T14:22:10.000Z"
            }
          ]
        }
      ]
    }
  ]
}
```

### 3.2 Shape

**Nested on disk and in memory** — one tree, identical in both places. No
normalization layer, no id→entity maps. **Order is array position**; there is
no `order` field. Moving a card is a splice.

### 3.3 Ownership

The **renderer owns the document**. The main process is a thin filesystem
service. Reducer logic never crosses the process boundary.

```
RENDERER                          MAIN
zustand store (the document)
  |
  +- subscribe -> debounce 500ms
  +- write(json) ------IPC------> fs.writeFile(path.tmp)
                                  fs.rename(path.tmp, path)
                                  lastWrittenHash = sha1(json)
```

Writes are **atomic**: write to `<file>.tmp` in the same directory, then
`rename`. A crash mid-write can never truncate the real file.

### 3.4 Validation

Zod. **Strict on structure, tolerant of omissions.**

| Input | Behavior |
|---|---|
| Missing `notes` / `link` / `variables` / `copyCount` / `lastCopiedAt` | Default applied, load succeeds |
| Malformed JSON | Error screen with the parser message; **app refuses to write** |
| `board.lists` absent or not an array | Error screen; app refuses to write |
| `version` > 1 | Error screen explaining the app is too old; app refuses to write |

The rule: **never overwrite a file we could not understand.**

### 3.5 External edits

Main watches the data file and tracks a SHA-1 of the last content it wrote.
On a change whose hash differs, it emits `data:changed`. The renderer shows a
non-blocking banner:

```
+--------------------------------------+
| ! kanban.json changed on disk        |
|   [ Reload from file ]  [ Keep mine ]|
+--------------------------------------+
```

Never auto-reloads (would discard in-flight UI edits), never auto-clobbers.

### 3.6 Settings and file location

`settings.json` in `app.getPath('userData')` — hand-rolled, no `electron-store`:

```json
{
  "dataFilePath": "/Users/x/Documents/ai-kanban/kanban.json",
  "recentFiles": ["/Users/x/Dropbox/prompts.json"],
  "activeBoardId": "brd_a1b2c3"
}
```

**First run:** welcome screen. `Use default location` is the primary button
(`~/Documents/ai-kanban/kanban.json`), with `Choose a location…` and
`Open an existing file…` alongside. Seeds one board with Waiting / In Flight / Done.

**Two distinct commands**, because they have different consequences:

- `Move data file…` — write to the new path, **verify it reads back**, then unlink the old. Never delete before the new file parses.
- `Open a file…` — switch documents. Both files untouched. Adds to `recentFiles`.

## 4. Data model

### 4.1 Card

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `crd_` + 6 chars |
| `title` | `string` | required, may be empty string |
| `prompt` | `string` | the payload |
| `tags` | `string[]` | tag **names**, not ids |
| `notes` | `string` | outcome / what went wrong. **Never copied.** |
| `link` | `string` | one URL; opens via `shell.openExternal` |
| `variables` | `Record<string,string>` | last-used `{{var}}` values |
| `copyCount` | `number` | |
| `lastCopiedAt` | `string \| null` | ISO 8601 |
| `createdAt` / `updatedAt` | `string` | ISO 8601 |

**No `status` field** — the containing list *is* the status.
**No `model` field** — an `opus` / `sonnet` tag does that job.

### 4.2 Tags

Cards store tag **names**. A top-level `tags` map holds color, so a tag can
exist before use and survives its last card's deletion. Tags are **global
across all boards**. Renaming sweeps every card (O(n), rare action).

Colors auto-assign from a fixed palette on creation, editable later.

## 5. Stack

| Concern | Choice | Why |
|---|---|---|
| State | `zustand` + `immer` | Selector subscriptions — renaming a list re-renders that list, not 200 cards |
| Validation | `zod` | Schema doubles as the TS types |
| Drag & drop | `@hello-pangea/dnd` | Maintained fork of react-beautiful-dnd; React 19 in peers; nested lists-of-cards is its primary documented use case. `react-beautiful-dnd` is deprecated and caps at React 18 |
| Styling | Tailwind 4 + shadcn/ui | Supplies Dialog, DropdownMenu, Popover, Badge, Sonner, cmdk Command — nearly this app's whole primitive set, as source we own |
| Routing | **none** | `MemoryRouter` has no URL to share, so it only bought a back button. `activeBoardId` in the store is one concept instead of two |

## 6. Interaction

### 6.1 Card

Collapsed: title, tag badges, copy button, chevron.
Expanded (inline accordion, several may be open at once): read-only prompt,
`max-h-56` with internal scroll, Copy button. Title click opens the editor modal.

```
+- Waiting -----------------+
| +-----------------------+ |
| | Refactor auth   {{2}} v| |  <- collapsed
| | code  review          | |
| +-----------------------+ |
| +-----------------------+ |
| | Write release notes # ^| |  <- expanded
| | docs                  | |
| | ..................... | |
| | You are a technical   | |
| | writer. Given the     | |  max-h-56
| | diff below, produce.. | |  overflow-y
| |      [ # Copy ]       | |
| +-----------------------+ |
+---------------------------+
```

Prompt text renders as **monospace, whitespace-preserved plain text — never
rendered markdown.** In a tool whose job is faithful copying, what you see
must be exactly what reaches the clipboard.

### 6.2 Copy

Copying goes through **Electron's `clipboard` module over IPC**, not
`navigator.clipboard`: production loads the renderer over `file://`, which is
not a secure context, so the web Clipboard API is unreliable there.

- Card with **no** `{{vars}}`: one click → clipboard → toast. Increments `copyCount`, sets `lastCopiedAt`.
- Card **with** `{{vars}}`: button renders `{{n}}` instead of the copy icon, so behavior is predictable from appearance. Opens a fill dialog prefilled from `card.variables`; on copy, values are persisted back for next time.

### 6.3 Creating cards

`+ Add prompt` opens a modal composer (title, prompt, tags) — cards are
complete when born. The same component is reused for editing.

`Cmd+V` with a list focused creates a card straight from the clipboard, title
derived from the first line (truncated to 60 chars).

### 6.4 Search

Two surfaces, two intents:

- **In-board filter bar** — free text (matching title, prompt, notes, and tag names) + tag chips, narrows the current board in place. Columns remain, showing `n/m` per list header, so status stays visible. **Dragging is disabled while a filter is active**: the drag library reports indices against rendered items, so dragging a filtered subset would move the wrong card.
- **`Cmd+K` palette** — searches every board, jumps to the card. Matches title, tags, board name, and list name. Prompt bodies are excluded: cmdk fuzzy-matches a single string, and whole prompts in it make nearly every query match everything. Mid-prompt text search is the filter bar's job, and it does search prompt bodies and notes.

### 6.5 Mistakes

`Cmd+Z` / `Shift+Cmd+Z` over up to 50 whole-document snapshots held in memory
(the document is a few hundred KB; this is free). Covers deletes, renames, and
**mis-drags — the likeliest error in a drag-and-drop app**.

No coalescing is needed. Every text edit in the app commits on an explicit
action — Enter or blur for inline renames, Save in the composer — so no
mutation ever fires per keystroke and a plain snapshot stack is already
correct.

Undo history is in-memory only and does not survive quit.

Only **board deletion** gets a confirm dialog — the one action with a large
blast radius. List and card deletion rely on `Cmd+Z`.

### 6.6 Renames and misc

- Board and list names use inline click-to-edit: Enter commits, Esc cancels, blur commits.
- A ghost `+ Add another list` column sits at the right end of every board.
- Boards reorder by drag in the sidebar (its own `DragDropContext`).
- List headers show a card count. No WIP limits.
- Theme follows the OS, light and dark via shadcn CSS variables.
- Deleting the last remaining board lands on an empty state, not the welcome screen.

## 7. Forward compatibility

v1 ships copy-only, but keeps the seam:

```
substitute(prompt, values) -> string
                           +-> clipboard        (v1)
                           +-> runPrompt()      (v2, no refactor needed)
```

`substitute()` returns a plain string and is not coupled to the clipboard call.
A future response would land in `notes`.

## 8. Testing

Smoke-test level overall, with a deliberate carve-out for the one place
eyeballs reliably fail:

- `applyDragEnd` — 6 cases. Critically, **same-list-moved-down** needs a different destination index than a cross-list move, because the source splice shifts everything after it. That bug presents as "card landed one slot off" and is easy to misread as a mis-drag.
- `KanbanDoc.safeParse` against a v1 fixture, so schema changes can't silently break existing files.
- RTL smoke: board renders, composer opens.
- Not tested: simulated drags.

## 9. App identity

- `productName`: `AI Kanban`
- `appId`: `com.torywalker.ai-kanban`
- Window 1280×800, minimum 900×600
- The `ipc-example` demo channel and the `AppUpdater` block are deleted — the updater points at the upstream ERB GitHub repo and there is no publish target.
