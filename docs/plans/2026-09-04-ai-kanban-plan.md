# AI Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **No commit steps appear in this plan.** The repository owner stages and
> commits manually. Do not run `git add` or `git commit`. End each task with
> its verification step and stop.

**Goal:** Build a local-only Electron desktop Kanban board whose cards are AI prompts, stored in a single readable JSON file the user chooses the location of, with one-click copy-to-clipboard as the primary action.

**Architecture:** The renderer owns the whole document as one nested tree in a zustand store; the main process is a thin filesystem service reached over four IPC channels. Persistence is a debounced whole-document atomic write. Zod validates on load and the app refuses to write any file it could not parse.

**Tech Stack:** Electron 35 · React 19 · TypeScript 5.8 · webpack 5 (electron-react-boilerplate) · zustand + immer · zod · @hello-pangea/dnd · Tailwind 4 + shadcn/ui · Jest + React Testing Library

**Spec:** [2026-09-04-ai-kanban-spec.md](./2026-09-04-ai-kanban-spec.md)

## Global Constraints

- Never run `git add` or `git commit`. Read-only git commands only.
- Install every dependency with `@latest` or a version verified via `npm view <pkg> version`. Never write a version from memory.
- Data file format: pretty-printed JSON, 2-space indent, `"version": 1`.
- Document shape is **nested** (`boards → lists → cards`) on disk and in memory. Order is array position. There is no `order` field.
- The renderer owns state. The main process contains **no** document mutation logic.
- All writes are atomic: write `<file>.tmp`, then `rename`.
- **Never overwrite a file that failed to parse.** Malformed JSON, structural schema failure, or `version > 1` all put the app in a no-write state.
- Cards store tag **names**, not ids. Tags are global across boards.
- Copy goes through Electron's `clipboard` module over IPC. Production loads the renderer over `file://`, which is not a secure context, so `navigator.clipboard` is unreliable.
- Prompt text renders as monospace, whitespace-preserved plain text. Never render markdown.
- `notes` is never copied to the clipboard.
- No API calls to any model provider. `substitute()` must return a plain string and must not be coupled to the clipboard call.
- `productName`: `AI Kanban`. `appId`: `com.torywalker.ai-kanban`.
- Only board deletion gets a confirm dialog.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `src/shared/schema.ts` | Zod schemas and the TS types inferred from them. The single definition of the document shape, imported by both processes. |
| `src/shared/ipc.ts` | IPC channel name constants and request/response payload types. |
| `src/main/services/settings.ts` | Read/write `userData/settings.json`. Knows nothing about the document. |
| `src/main/services/dataFile.ts` | Atomic read/write/move of the data file, plus the last-written hash used to ignore self-writes. |
| `src/main/services/watcher.ts` | `fs.watch` on the data file; emits only on foreign changes. |
| `src/main/services/registerIpc.ts` | Wires all channels to the services above. The only place `ipcMain` is touched. |
| `src/renderer/globals.css` | Tailwind entry point and shadcn CSS variables. |
| `src/renderer/lib/utils.ts` | `cn()` class merger required by shadcn components. |
| `src/renderer/lib/api.ts` | Typed wrapper over `window.electron`, so components never touch IPC shapes. |
| `src/renderer/lib/useTheme.ts` | Toggles `.dark` on `<html>` from `prefers-color-scheme`. |
| `src/renderer/domain/ids.ts` | Prefixed id generation. |
| `src/renderer/domain/seed.ts` | Builds the first-run document. |
| `src/renderer/domain/dragEnd.ts` | `applyDragEnd` — pure reorder logic. Unit tested. |
| `src/renderer/domain/variables.ts` | `extractVariables` / `substitute`. Pure. |
| `src/renderer/domain/filter.ts` | `cardMatches` / `filterBoard`. Pure. |
| `src/renderer/domain/tags.ts` | Tag palette and `renameTagInDoc`. Pure. |
| `src/renderer/store/docStore.ts` | The zustand store: document, undo history, all mutations. |
| `src/renderer/store/selectors.ts` | Memo-friendly selectors used by components. |
| `src/renderer/store/persistence.ts` | Subscribes to the store, debounces, writes via IPC. |
| `src/renderer/components/ui/*` | shadcn components. Owned source, edited freely. |
| `src/renderer/components/shell/*` | `AppShell`, `WelcomeScreen`, `FileErrorScreen`, `ExternalChangeBanner`, `SettingsDialog`. |
| `src/renderer/components/sidebar/*` | `Sidebar`, `SidebarBoardItem`. |
| `src/renderer/components/board/*` | `BoardView`, `ListColumn`, `AddListColumn`, `FilterBar`. |
| `src/renderer/components/card/*` | `PromptCard`, `CardComposerDialog`, `VariableFillDialog`. |
| `src/renderer/components/tags/*` | `TagBadge`, `TagPicker`. |
| `src/renderer/components/search/CommandPalette.tsx` | The Cmd+K palette. |
| `src/renderer/components/common/*` | `InlineEditableText`, `ConfirmDialog`. Shared primitives. |

### Modified

| Path | Change |
|---|---|
| `.erb/configs/webpack.config.renderer.dev.ts:66-82` | Add `postcss-loader` to both CSS rules. |
| `.erb/configs/webpack.config.renderer.prod.ts:40-61` | Add `postcss-loader` to both CSS rules. |
| `tsconfig.json` | Add `baseUrl` and the `@/*` path alias. |
| `package.json` | Deps, `productName`, `appId`, remove `publish`, jest `moduleNameMapper` for `@/`. |
| `src/main/main.ts` | Remove `ipc-example` and `AppUpdater`; window sizing; wire services. |
| `src/main/preload.ts` | Replace the demo bridge with the real API. |
| `src/main/menu.ts` | App menu items for New Prompt, Undo/Redo, Find, Settings. |
| `src/renderer/App.tsx` | Replace the boilerplate `Hello` route tree with `AppShell`. |
| `src/renderer/index.tsx` | Remove the `ipc-example` demo calls; import `globals.css`. |
| `src/__tests__/App.test.tsx` | Update to render the real shell. |

### Deleted

| Path | Why |
|---|---|
| `src/renderer/App.css` | Replaced by `globals.css`. |

> **Note on the DLL config:** `.erb/configs/webpack.config.renderer.dev.dll.ts:31`
> re-uses `webpack.config.renderer.dev`'s `module` block by reference, so it
> inherits the `postcss-loader` change automatically. Do not edit it.

---

## Milestone 1 — Kill the two config risks

Ends with an app that launches, reads a real file from disk, and renders a
static board. Both unknowns (Tailwind inside ERB's webpack, and the file
round-trip) are dead before any UI exists to throw away.

### Task 1: Tailwind 4 + shadcn wiring and app identity

This task is pure infrastructure. It is one task because none of its pieces
are independently reviewable — Tailwind either compiles or it does not.

**Files:**
- Modify: `.erb/configs/webpack.config.renderer.dev.ts:66-82`
- Modify: `.erb/configs/webpack.config.renderer.prod.ts:40-61`
- Modify: `tsconfig.json`
- Modify: `package.json`
- Modify: `src/main/main.ts`
- Modify: `src/renderer/index.tsx`
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/globals.css`
- Create: `src/renderer/lib/utils.ts`
- Create: `src/renderer/lib/useTheme.ts`
- Create: `components.json`
- Delete: `src/renderer/App.css`

**Interfaces:**
- Consumes: nothing.
- Produces: `cn(...inputs: ClassValue[]): string` from `@/lib/utils`; `useTheme(): void` from `@/lib/useTheme`; the `@/*` alias resolving to `src/renderer/*`.

- [ ] **Step 1: Install the build and UI dependencies**

Verify each version first, then install. Do not copy versions from memory.

```bash
npm i tailwindcss @tailwindcss/postcss tw-animate-css \
      clsx tailwind-merge class-variance-authority lucide-react
npm i -D postcss postcss-loader
```

- [ ] **Step 2: Add `postcss-loader` to the dev CSS rules**

In `.erb/configs/webpack.config.renderer.dev.ts`, replace the two CSS rules
inside `module.rules` with these. Webpack applies loaders right-to-left, so
`postcss-loader` must sit between `css-loader` and `sass-loader`.

```ts
      {
        test: /\.s?(c|a)ss$/,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true,
              importLoaders: 1,
            },
          },
          'postcss-loader',
          'sass-loader',
        ],
        include: /\.module\.s?(c|a)ss$/,
      },
      {
        test: /\.s?css$/,
        use: ['style-loader', 'css-loader', 'postcss-loader', 'sass-loader'],
        exclude: /\.module\.s?(c|a)ss$/,
      },
```

- [ ] **Step 3: Add `postcss-loader` to the production CSS rules**

In `.erb/configs/webpack.config.renderer.prod.ts`, replace the two CSS rules:

```ts
      {
        test: /\.s?(a|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              modules: true,
              sourceMap: true,
              importLoaders: 1,
            },
          },
          'postcss-loader',
          'sass-loader',
        ],
        include: /\.module\.s?(c|a)ss$/,
      },
      {
        test: /\.s?(a|c)ss$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'postcss-loader',
          'sass-loader',
        ],
        exclude: /\.module\.s?(c|a)ss$/,
      },
```

- [ ] **Step 4: Create the PostCSS config**

Create `postcss.config.js` at the repo root. Tailwind 4 ships its PostCSS
integration as a separate package; there is no `tailwindcss` plugin entry
and no `autoprefixer` needed.

```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

- [ ] **Step 5: Create `src/renderer/globals.css`**

Tailwind 4 is configured in CSS, not in a `tailwind.config.js`. These are the
shadcn design tokens; `@theme inline` is what turns them into Tailwind
utilities like `bg-background`.

```css
@import 'tailwindcss';
@import 'tw-animate-css';

@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.269 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.371 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 12%);
  --input: oklch(1 0 0 / 18%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  html,
  body,
  #root {
    height: 100%;
  }
  body {
    @apply bg-background text-foreground overflow-hidden;
  }
}
```

- [ ] **Step 6: Add the `@/*` path alias to `tsconfig.json`**

`webpack.config.base.ts:46` already registers `TsconfigPathsPlugins()`, so
adding `paths` here makes the alias resolve in webpack with no further config.

```json
{
  "compilerOptions": {
    "incremental": true,
    "target": "es2022",
    "module": "node16",
    "lib": ["dom", "es2022"],
    "jsx": "react-jsx",
    "strict": true,
    "sourceMap": true,
    "moduleResolution": "node16",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "outDir": ".erb/dll",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/renderer/*"],
      "@shared/*": ["src/shared/*"]
    }
  },
  "exclude": ["test", "release/build", "release/app/dist", ".erb/dll"]
}
```

- [ ] **Step 7: Teach Jest the aliases**

In `package.json`, add two entries to the existing `jest.moduleNameMapper`
object. Keep the two entries already there.

```json
      "^@/(.*)$": "<rootDir>/src/renderer/$1",
      "^@shared/(.*)$": "<rootDir>/src/shared/$1"
```

- [ ] **Step 8: Create `components.json`**

The `shadcn` CLI expects a Next.js or Vite project and will not detect ERB.
Writing this file by hand is what makes `npx shadcn@latest add <component>`
work anyway. `tailwind.config` is intentionally an empty string — Tailwind 4
has no config file.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/renderer/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 9: Create `src/renderer/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 10: Create `src/renderer/lib/useTheme.ts`**

shadcn's dark tokens are behind a `.dark` class, so something has to set it.
This follows the OS setting and reacts to changes live.

```ts
import { useEffect } from 'react';

export function useTheme(): void {
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (isDark: boolean) => {
      document.documentElement.classList.toggle('dark', isDark);
    };
    apply(query.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
}
```

- [ ] **Step 11: Replace `src/renderer/App.tsx` with a Tailwind smoke test**

This is temporary scaffolding, replaced in Task 4. Its only job is to prove
Tailwind classes and the dark variant actually compile and apply.

```tsx
import { useTheme } from '@/lib/useTheme';

export default function App() {
  useTheme();
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-card-foreground">
          AI Kanban
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tailwind is wired up.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Update `src/renderer/index.tsx`**

Removes the `ipc-example` demo calls and imports the stylesheet.

```tsx
import { createRoot } from 'react-dom/client';
import App from './App';
import './globals.css';

const container = document.getElementById('root') as HTMLElement;
const root = createRoot(container);
root.render(<App />);
```

- [ ] **Step 13: Delete the boilerplate stylesheet**

```bash
rm src/renderer/App.css
```

- [ ] **Step 14: Strip the demo IPC channel and the auto-updater from main**

In `src/main/main.ts`:

1. Delete the entire `class AppUpdater { ... }` block and the
   `import { autoUpdater } from 'electron-updater';` line. The updater's
   `publish` config points at the upstream ERB GitHub repo, so leaving it in
   would have the app check a stranger's releases for updates.
2. Delete the `new AppUpdater();` call and the two comment lines above it at
   the end of `createWindow`.
3. Delete the `ipcMain.on('ipc-example', ...)` block and drop `ipcMain` from
   the `electron` import.
4. Change the `BrowserWindow` sizing options to:

```ts
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
```

- [ ] **Step 15: Set the app identity in `package.json`**

Under the `build` key, change `productName` and `appId`, and delete the whole
`publish` block (there is no release target, and it currently points at the
upstream repository).

```json
    "productName": "AI Kanban",
    "appId": "com.torywalker.ai-kanban",
```

Also change the top-level `"name"`, `"description"`, and `"author"` fields
away from the boilerplate values, and delete the `homepage`, `bugs`,
`repository`, `contributors`, and `collective` keys.

- [ ] **Step 16: Verify the app builds and Tailwind applies**

Run: `npm start`
Expected: the window opens at 1280×800 showing a bordered card reading
"AI Kanban". No CSS errors in the terminal. Switch the OS between light and
dark appearance and confirm the card background follows it.

Then run: `npx tsc --noEmit`
Expected: no errors. In particular this proves the `@/*` alias resolves.

---

### Task 2: The document schema

**Files:**
- Create: `src/shared/schema.ts`
- Create: `src/__tests__/fixtures/kanban-v1.json`
- Test: `src/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `KanbanDocSchema`, `parseDoc(raw: unknown): ParseResult`, and the types `KanbanDoc`, `Board`, `List`, `Card`, `Tag`. `ParseResult` is `{ ok: true; doc: KanbanDoc } | { ok: false; error: string }`. Every later task imports these types from `@shared/schema`.

- [ ] **Step 1: Install zod**

```bash
npm i zod
```

- [ ] **Step 2: Write the fixture the schema must keep parsing forever**

Create `src/__tests__/fixtures/kanban-v1.json`. This file is the contract:
if a future schema change breaks it, an existing user's file would break too.
Note it deliberately **omits** the optional fields, to prove tolerance.

```json
{
  "version": 1,
  "tags": {
    "code": { "color": "#4f8ef7" },
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
              "prompt": "You are a senior engineer.\n\nReview {{file}}.",
              "tags": ["code", "review"],
              "createdAt": "2026-08-30T09:00:00.000Z",
              "updatedAt": "2026-08-30T09:00:00.000Z"
            }
          ]
        },
        { "id": "lst_j0k1l2", "name": "In Flight", "cards": [] }
      ]
    }
  ]
}
```

- [ ] **Step 3: Write the failing tests**

Create `src/__tests__/schema.test.ts`.

```ts
import fixture from './fixtures/kanban-v1.json';
import { parseDoc } from '../shared/schema';

describe('parseDoc', () => {
  it('parses the v1 fixture', () => {
    const result = parseDoc(fixture);
    expect(result.ok).toBe(true);
  });

  it('defaults the omitted optional card fields', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    const card = result.doc.boards[0].lists[0].cards[0];
    expect(card.notes).toBe('');
    expect(card.link).toBe('');
    expect(card.variables).toEqual({});
    expect(card.copyCount).toBe(0);
    expect(card.lastCopiedAt).toBeNull();
  });

  it('rejects a board whose lists array is missing', () => {
    const result = parseDoc({
      version: 1,
      tags: {},
      boards: [{ id: 'brd_x', name: 'Broken' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/lists/);
  });

  it('rejects a future version rather than downgrading it', () => {
    const result = parseDoc({ version: 2, tags: {}, boards: [] });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toMatch(/version/i);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest src/__tests__/schema.test.ts`
Expected: FAIL — `Cannot find module '../shared/schema'`.

- [ ] **Step 5: Write the schema**

Create `src/shared/schema.ts`. `.catch()` on the optional fields is what
produces "tolerant of omissions"; the required fields produce "strict on
structure".

```ts
import { z } from 'zod';

export const CURRENT_VERSION = 1;

export const TagSchema = z.object({
  color: z.string(),
});

export const CardSchema = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  notes: z.string().catch(''),
  link: z.string().catch(''),
  variables: z.record(z.string(), z.string()).catch({}),
  copyCount: z.number().catch(0),
  lastCopiedAt: z.string().nullable().catch(null),
});

export const ListSchema = z.object({
  id: z.string(),
  name: z.string(),
  cards: z.array(CardSchema),
});

export const BoardSchema = z.object({
  id: z.string(),
  name: z.string(),
  lists: z.array(ListSchema),
});

export const KanbanDocSchema = z.object({
  version: z.number(),
  tags: z.record(z.string(), TagSchema),
  boards: z.array(BoardSchema),
});

export type Tag = z.infer<typeof TagSchema>;
export type Card = z.infer<typeof CardSchema>;
export type List = z.infer<typeof ListSchema>;
export type Board = z.infer<typeof BoardSchema>;
export type KanbanDoc = z.infer<typeof KanbanDocSchema>;

export type ParseResult =
  | { ok: true; doc: KanbanDoc }
  | { ok: false; error: string };

/**
 * Validates an already-JSON-parsed value against the document schema.
 *
 * A version higher than this build understands is refused rather than
 * coerced: silently rewriting a newer file into an older shape would
 * destroy fields this build does not know about.
 */
export function parseDoc(raw: unknown): ParseResult {
  const versionCheck = z
    .object({ version: z.number() })
    .safeParse(raw);

  if (versionCheck.success && versionCheck.data.version > CURRENT_VERSION) {
    return {
      ok: false,
      error:
        `This file uses format version ${versionCheck.data.version}, but ` +
        `this version of AI Kanban only understands version ` +
        `${CURRENT_VERSION}. Update the app to open it.`,
    };
  }

  const result = KanbanDocSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.join('.') || '(root)';
    return { ok: false, error: `${path}: ${first.message}` };
  }

  return { ok: true, doc: result.data };
}

export function serializeDoc(doc: KanbanDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest src/__tests__/schema.test.ts`
Expected: PASS, 4 tests.

If the "future version" test fails because the error message differs, fix the
message, not the test — that string is shown to the user.

---

### Task 3: Main-process file service and the IPC bridge

**Files:**
- Create: `src/shared/ipc.ts`
- Create: `src/main/services/settings.ts`
- Create: `src/main/services/dataFile.ts`
- Create: `src/main/services/watcher.ts`
- Create: `src/main/services/registerIpc.ts`
- Create: `src/renderer/lib/api.ts`
- Modify: `src/main/preload.ts`
- Modify: `src/renderer/preload.d.ts`
- Modify: `src/main/main.ts`

**Interfaces:**
- Consumes: `KanbanDoc`, `parseDoc`, `serializeDoc` from `@shared/schema`.
- Produces: `CHANNELS` and `IpcResult<T>` from `@shared/ipc`; `Settings` from `src/main/services/settings`; and the renderer-facing `api` object from `@/lib/api` with this surface:
  - `api.settings.read(): Promise<Settings>`
  - `api.settings.write(patch: Partial<Settings>): Promise<Settings>`
  - `api.data.read(file: string): Promise<IpcResult<string>>`
  - `api.data.write(file: string, contents: string): Promise<IpcResult<null>>`
  - `api.data.pickOpen(): Promise<string | null>`
  - `api.data.pickSave(defaultPath: string): Promise<string | null>`
  - `api.data.move(from: string, to: string): Promise<IpcResult<null>>`
  - `api.data.reveal(file: string): Promise<void>`
  - `api.data.defaultPath(): Promise<string>`
  - `api.data.onChanged(cb: () => void): () => void`
  - `api.clipboard.write(text: string): Promise<void>`
  - `api.clipboard.read(): Promise<string>`
  - `api.shell.openExternal(url: string): Promise<void>`

- [ ] **Step 1: Define the channel names and result envelope**

Create `src/shared/ipc.ts`. Every fallible operation returns `IpcResult`
rather than throwing across the boundary, because a thrown Error loses its
message and stack when it crosses IPC.

```ts
export const CHANNELS = {
  settingsRead: 'settings:read',
  settingsWrite: 'settings:write',
  dataRead: 'data:read',
  dataWrite: 'data:write',
  dataPickOpen: 'data:pick-open',
  dataPickSave: 'data:pick-save',
  dataMove: 'data:move',
  dataReveal: 'data:reveal',
  dataDefaultPath: 'data:default-path',
  dataChanged: 'data:changed',
  clipboardWrite: 'clipboard:write',
  clipboardRead: 'clipboard:read',
  openExternal: 'shell:open-external',
} as const;

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export interface Settings {
  dataFilePath: string | null;
  recentFiles: string[];
  activeBoardId: string | null;
}
```

- [ ] **Step 2: Write the settings service**

Create `src/main/services/settings.ts`. Settings are separate from the
document by necessity — the path to the document cannot live inside the
document.

```ts
import path from 'path';
import fs from 'fs/promises';
import { app } from 'electron';
import type { Settings } from '../../shared/ipc';

const DEFAULTS: Settings = {
  dataFilePath: null,
  recentFiles: [],
  activeBoardId: null,
};

const MAX_RECENTS = 8;

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export function defaultDataFilePath(): string {
  return path.join(app.getPath('documents'), 'ai-kanban', 'kanban.json');
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    // Missing or corrupt settings are not an error worth surfacing:
    // losing your window position is recoverable, unlike losing data.
    return { ...DEFAULTS };
  }
}

export async function writeSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const current = await readSettings();
  const next: Settings = { ...current, ...patch };
  if (next.dataFilePath) {
    next.recentFiles = [
      next.dataFilePath,
      ...next.recentFiles.filter((f) => f !== next.dataFilePath),
    ].slice(0, MAX_RECENTS);
  }
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(
    settingsPath(),
    `${JSON.stringify(next, null, 2)}\n`,
    'utf8',
  );
  return next;
}
```

- [ ] **Step 3: Write the atomic data-file service**

Create `src/main/services/dataFile.ts`.

Two things here are load-bearing. The temp file must live in the **same
directory** as the target, because `rename` is only atomic within a
filesystem. And `lastWrittenHash` is updated on read as well as write, so
that opening a file establishes the baseline the watcher compares against.

```ts
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

let lastWrittenHash: string | null = null;

export function hashContents(contents: string): string {
  return crypto.createHash('sha1').update(contents).digest('hex');
}

export function getLastWrittenHash(): string | null {
  return lastWrittenHash;
}

export async function readDataFile(file: string): Promise<string> {
  const contents = await fs.readFile(file, 'utf8');
  lastWrittenHash = hashContents(contents);
  return contents;
}

/**
 * Atomic write: a crash between these two calls leaves the original file
 * fully intact, because the partial write only ever touched the temp file.
 * The temp file is a sibling so that rename stays within one filesystem.
 */
export async function writeDataFile(
  file: string,
  contents: string,
): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, file);
  lastWrittenHash = hashContents(contents);
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Moves the data file. The old file is only unlinked after the new one has
 * been written AND read back byte-for-byte. Never delete before verifying.
 */
export async function moveDataFile(from: string, to: string): Promise<void> {
  if (path.resolve(from) === path.resolve(to)) return;
  const contents = await fs.readFile(from, 'utf8');
  await writeDataFile(to, contents);
  const verified = await fs.readFile(to, 'utf8');
  if (verified !== contents) {
    throw new Error(
      `Verification failed: ${to} did not read back identically. ` +
        `The original file at ${from} has been left untouched.`,
    );
  }
  await fs.unlink(from);
}
```

- [ ] **Step 4: Write the watcher**

Create `src/main/services/watcher.ts`.

It watches the **containing directory**, not the file. This is deliberate:
most editors save by writing a temp file and renaming it over the target,
which replaces the inode — a watcher attached to the file itself goes deaf
after the first such save.

```ts
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { BrowserWindow } from 'electron';
import { CHANNELS } from '../../shared/ipc';
import { hashContents, getLastWrittenHash } from './dataFile';

let watcher: fs.FSWatcher | null = null;
let pending: NodeJS.Timeout | null = null;

export function stopWatching(): void {
  watcher?.close();
  watcher = null;
  if (pending) clearTimeout(pending);
  pending = null;
}

export function watchDataFile(file: string, window: BrowserWindow): void {
  stopWatching();
  const dir = path.dirname(file);
  const base = path.basename(file);

  try {
    watcher = fs.watch(dir, (_event, changed) => {
      // Ignore our own temp file and everything else in the directory.
      if (changed !== base) return;
      if (pending) clearTimeout(pending);
      pending = setTimeout(async () => {
        try {
          const contents = await fsp.readFile(file, 'utf8');
          // This is the app's own debounced write coming back at us.
          if (hashContents(contents) === getLastWrittenHash()) return;
          if (!window.isDestroyed()) {
            window.webContents.send(CHANNELS.dataChanged);
          }
        } catch {
          // The file can be momentarily absent mid-rename during an
          // external editor's atomic save. The next event will catch it.
        }
      }, 150);
    });
  } catch {
    // The directory may not exist yet on first run. watchDataFile is
    // called again after the file is created.
  }
}
```

- [ ] **Step 5: Register the IPC handlers**

Create `src/main/services/registerIpc.ts`. This is the only file that touches
`ipcMain`. Note there is **no document logic here** — main moves strings, it
does not understand them.

```ts
import { ipcMain, dialog, shell, clipboard, BrowserWindow } from 'electron';
import { CHANNELS, type IpcResult, type Settings } from '../../shared/ipc';
import {
  readSettings,
  writeSettings,
  defaultDataFilePath,
} from './settings';
import {
  readDataFile,
  writeDataFile,
  moveDataFile,
  fileExists,
} from './dataFile';
import { watchDataFile } from './watcher';

function fail(error: unknown): IpcResult<never> {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(CHANNELS.settingsRead, () => readSettings());

  ipcMain.handle(
    CHANNELS.settingsWrite,
    (_e, patch: Partial<Settings>) => writeSettings(patch),
  );

  ipcMain.handle(CHANNELS.dataDefaultPath, () => defaultDataFilePath());

  ipcMain.handle(
    CHANNELS.dataRead,
    async (_e, file: string): Promise<IpcResult<string | null>> => {
      try {
        if (!(await fileExists(file))) return { ok: true, value: null };
        const contents = await readDataFile(file);
        const window = getWindow();
        if (window) watchDataFile(file, window);
        return { ok: true, value: contents };
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    CHANNELS.dataWrite,
    async (_e, file: string, contents: string): Promise<IpcResult<null>> => {
      try {
        await writeDataFile(file, contents);
        const window = getWindow();
        if (window) watchDataFile(file, window);
        return { ok: true, value: null };
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(
    CHANNELS.dataMove,
    async (_e, from: string, to: string): Promise<IpcResult<null>> => {
      try {
        await moveDataFile(from, to);
        const window = getWindow();
        if (window) watchDataFile(to, window);
        return { ok: true, value: null };
      } catch (error) {
        return fail(error);
      }
    },
  );

  ipcMain.handle(CHANNELS.dataPickOpen, async () => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Open AI Kanban file',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(CHANNELS.dataPickSave, async (_e, defaultPath: string) => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showSaveDialog(window, {
      title: 'Choose where your AI Kanban data lives',
      defaultPath,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });

  ipcMain.handle(CHANNELS.dataReveal, (_e, file: string) => {
    shell.showItemInFolder(file);
  });

  ipcMain.handle(CHANNELS.clipboardWrite, (_e, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle(CHANNELS.clipboardRead, () => clipboard.readText());

  ipcMain.handle(CHANNELS.openExternal, (_e, url: string) => {
    // Only ever open http(s). A card's link field is user data, and
    // file:// or custom schemes here would be an unnecessary foot-gun.
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
    return undefined;
  });
}
```

**Note on `properties`:** if the Electron typings reject `properties` on
`showOpenDialog`, the correct key name for this version is what the compiler
says it is — run `npx tsc --noEmit` and use the key it suggests.

- [ ] **Step 6: Replace the preload bridge**

Replace the whole contents of `src/main/preload.ts`.

```ts
import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type IpcResult, type Settings } from '../shared/ipc';

const api = {
  settings: {
    read: (): Promise<Settings> => ipcRenderer.invoke(CHANNELS.settingsRead),
    write: (patch: Partial<Settings>): Promise<Settings> =>
      ipcRenderer.invoke(CHANNELS.settingsWrite, patch),
  },
  data: {
    read: (file: string): Promise<IpcResult<string | null>> =>
      ipcRenderer.invoke(CHANNELS.dataRead, file),
    write: (file: string, contents: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(CHANNELS.dataWrite, file, contents),
    move: (from: string, to: string): Promise<IpcResult<null>> =>
      ipcRenderer.invoke(CHANNELS.dataMove, from, to),
    pickOpen: (): Promise<string | null> =>
      ipcRenderer.invoke(CHANNELS.dataPickOpen),
    pickSave: (defaultPath: string): Promise<string | null> =>
      ipcRenderer.invoke(CHANNELS.dataPickSave, defaultPath),
    reveal: (file: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.dataReveal, file),
    defaultPath: (): Promise<string> =>
      ipcRenderer.invoke(CHANNELS.dataDefaultPath),
    onChanged: (callback: () => void): (() => void) => {
      const listener = () => callback();
      ipcRenderer.on(CHANNELS.dataChanged, listener);
      return () => ipcRenderer.removeListener(CHANNELS.dataChanged, listener);
    },
  },
  clipboard: {
    write: (text: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.clipboardWrite, text),
    read: (): Promise<string> => ipcRenderer.invoke(CHANNELS.clipboardRead),
  },
  shell: {
    openExternal: (url: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.openExternal, url),
  },
};

contextBridge.exposeInMainWorld('electron', api);

export type ElectronApi = typeof api;
```

- [ ] **Step 7: Update the renderer's global typing**

Replace the contents of `src/renderer/preload.d.ts`.

```ts
import type { ElectronApi } from '../main/preload';

declare global {
  interface Window {
    electron: ElectronApi;
  }
}

export {};
```

- [ ] **Step 8: Create the renderer API wrapper**

Create `src/renderer/lib/api.ts`. Components import this, never
`window.electron` directly — so tests can stub one module, and so a change
to the bridge does not ripple through the component tree.

```ts
import type { ElectronApi } from '../../main/preload';

export const api: ElectronApi = window.electron;
```

- [ ] **Step 9: Wire the services into main**

In `src/main/main.ts`:

1. Add the import: `import { registerIpc } from './services/registerIpc';`
2. Immediately after the `let mainWindow: BrowserWindow | null = null;`
   declaration, add:

```ts
registerIpc(() => mainWindow);
```

3. Add `import { stopWatching } from './services/watcher';` and call
   `stopWatching()` inside the existing `mainWindow.on('closed', ...)`
   handler, before `mainWindow = null;`.

- [ ] **Step 10: Verify the whole file round-trip by hand**

Run: `npm start`, then in the renderer devtools console:

```js
const p = await window.electron.data.defaultPath();
await window.electron.data.write(p, '{"version":1,"tags":{},"boards":[]}\n');
await window.electron.data.read(p);
```

Expected: the `read` call returns `{ok: true, value: '{"version":1,...}'}`.

Then confirm on disk:

```bash
cat ~/Documents/ai-kanban/kanban.json
ls ~/Documents/ai-kanban/          # must NOT contain kanban.json.tmp
```

Expected: the JSON is present and no `.tmp` file survives — proving the
rename completed rather than leaving debris.

Finally, prove the watcher ignores self-writes but catches foreign ones. With
the app still running, in the devtools console:

```js
window.electron.data.onChanged(() => console.log('FOREIGN CHANGE'));
```

Then in a terminal: `echo '{"version":1,"tags":{},"boards":[]}' >> ~/Documents/ai-kanban/kanban.json`
Expected: `FOREIGN CHANGE` logs once.

Then from the console: `await window.electron.data.write(p, '{"version":1,"tags":{},"boards":[]}\n')`
Expected: **no** `FOREIGN CHANGE` log. If it logs, the hash baseline is not
being updated on write and the banner will fire on every keystroke.

---

### Task 4: First-run flow, load pipeline, and a static board

Closes Milestone 1: the app now launches, decides whether it has a file,
creates or opens one, validates it, and renders it.

**Files:**
- Create: `src/renderer/domain/ids.ts`
- Create: `src/renderer/domain/seed.ts`
- Create: `src/renderer/store/docStore.ts`
- Create: `src/renderer/components/shell/AppShell.tsx`
- Create: `src/renderer/components/shell/WelcomeScreen.tsx`
- Create: `src/renderer/components/shell/FileErrorScreen.tsx`
- Create: `src/renderer/components/board/BoardView.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/__tests__/App.test.tsx`

**Interfaces:**
- Consumes: `api` from `@/lib/api`; `parseDoc`, `serializeDoc`, `KanbanDoc` from `@shared/schema`.
- Produces:
  - `newId(prefix: 'brd' | 'lst' | 'crd'): string` from `@/domain/ids`
  - `createSeedDoc(): KanbanDoc` from `@/domain/seed`
  - `useDocStore` from `@/store/docStore`, whose state is `{ status, doc, filePath, activeBoardId }` and whose actions at this point are `bootstrap()`, `createAt(file)`, `openAt(file)`, `setActiveBoard(id)`.
  - `status` is the discriminated union `{ kind: 'loading' } | { kind: 'welcome' } | { kind: 'error'; message: string; file: string } | { kind: 'ready' }`.

- [ ] **Step 1: Install zustand and immer, and add the first shadcn components**

```bash
npm i zustand immer
npx shadcn@latest add button input scroll-area
```

If the CLI refuses because it cannot detect the framework, add `--yes`. If it
still refuses, copy the three component sources from ui.shadcn.com into
`src/renderer/components/ui/` by hand — `components.json` already declares
the right aliases, so no path rewriting is needed.

- [ ] **Step 2: Write the id generator**

Create `src/renderer/domain/ids.ts`. Prefixed ids make the data file
self-describing: seeing `lst_` in a `cards` array is immediately a bug.

```ts
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix: 'brd' | 'lst' | 'crd'): string {
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}_${suffix}`;
}
```

- [ ] **Step 3: Write the seed document**

Create `src/renderer/domain/seed.ts`.

```ts
import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { newId } from './ids';

export function createSeedDoc(): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: newId('brd'),
        name: 'Prompts',
        lists: [
          { id: newId('lst'), name: 'Waiting', cards: [] },
          { id: newId('lst'), name: 'In Flight', cards: [] },
          { id: newId('lst'), name: 'Done', cards: [] },
        ],
      },
    ],
  };
}
```

- [ ] **Step 4: Write the store with the load pipeline**

Create `src/renderer/store/docStore.ts`.

`mutate()` exists from the start even though it looks redundant: every
mutation in later tasks routes through it, which is what makes undo (Task 16)
a change to one function instead of thirty.

```ts
import { create } from 'zustand';
import { produce } from 'immer';
import {
  parseDoc,
  serializeDoc,
  type KanbanDoc,
} from '@shared/schema';
import { api } from '@/lib/api';
import { createSeedDoc } from '@/domain/seed';

export type LoadStatus =
  | { kind: 'loading' }
  | { kind: 'welcome' }
  | { kind: 'error'; message: string; file: string }
  | { kind: 'ready' };

interface DocStore {
  status: LoadStatus;
  doc: KanbanDoc | null;
  filePath: string | null;
  activeBoardId: string | null;

  bootstrap: () => Promise<void>;
  createAt: (file: string) => Promise<void>;
  openAt: (file: string) => Promise<void>;
  setActiveBoard: (boardId: string) => void;
  mutate: (recipe: (draft: KanbanDoc) => void) => void;
}

export const useDocStore = create<DocStore>((set, get) => ({
  status: { kind: 'loading' },
  doc: null,
  filePath: null,
  activeBoardId: null,

  /**
   * Decides the opening screen. No stored path, or a stored path whose file
   * has vanished, both mean the welcome screen.
   */
  bootstrap: async () => {
    const settings = await api.settings.read();
    if (!settings.dataFilePath) {
      set({ status: { kind: 'welcome' } });
      return;
    }
    await get().openAt(settings.dataFilePath);
    if (settings.activeBoardId) {
      const doc = get().doc;
      const exists = doc?.boards.some((b) => b.id === settings.activeBoardId);
      if (exists) set({ activeBoardId: settings.activeBoardId });
    }
  },

  createAt: async (file) => {
    const doc = createSeedDoc();
    const written = await api.data.write(file, serializeDoc(doc));
    if (!written.ok) {
      set({ status: { kind: 'error', message: written.error, file } });
      return;
    }
    await api.settings.write({
      dataFilePath: file,
      activeBoardId: doc.boards[0].id,
    });
    set({
      doc,
      filePath: file,
      activeBoardId: doc.boards[0].id,
      status: { kind: 'ready' },
    });
  },

  openAt: async (file) => {
    set({ status: { kind: 'loading' } });
    const read = await api.data.read(file);

    if (!read.ok) {
      set({ status: { kind: 'error', message: read.error, file } });
      return;
    }

    // A configured path pointing at nothing: treat as first run for that
    // path rather than an error, and seed it.
    if (read.value === null) {
      await get().createAt(file);
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(read.value);
    } catch (error) {
      set({
        status: {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
          file,
        },
      });
      return;
    }

    const parsed = parseDoc(raw);
    if (!parsed.ok) {
      set({ status: { kind: 'error', message: parsed.error, file } });
      return;
    }

    await api.settings.write({ dataFilePath: file });
    set({
      doc: parsed.doc,
      filePath: file,
      activeBoardId: parsed.doc.boards[0]?.id ?? null,
      status: { kind: 'ready' },
    });
  },

  setActiveBoard: (boardId) => {
    set({ activeBoardId: boardId });
    void api.settings.write({ activeBoardId: boardId });
  },

  /**
   * The single entry point for every document change. Task 16 adds undo
   * history capture here and nowhere else.
   */
  mutate: (recipe) => {
    const current = get().doc;
    if (!current) return;
    set({ doc: produce(current, recipe) });
  },
}));
```

- [ ] **Step 5: Write the welcome screen**

Create `src/renderer/components/shell/WelcomeScreen.tsx`.

The default path is the primary button so the common case is one click, but
both deliberate options sit right beside it rather than buried in settings.

```tsx
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDocStore } from '@/store/docStore';

export function WelcomeScreen() {
  const [defaultPath, setDefaultPath] = useState('');
  const createAt = useDocStore((s) => s.createAt);
  const openAt = useDocStore((s) => s.openAt);

  useEffect(() => {
    void api.data.defaultPath().then(setDefaultPath);
  }, []);

  const chooseLocation = async () => {
    const file = await api.data.pickSave(defaultPath);
    if (file) await createAt(file);
  };

  const openExisting = async () => {
    const file = await api.data.pickOpen();
    if (file) await openAt(file);
  };

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-[30rem] rounded-xl border border-border bg-card p-8">
        <h1 className="text-xl font-semibold text-card-foreground">
          AI Kanban
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Where should your prompts be stored?
        </p>

        <Button
          className="mt-6 w-full"
          onClick={() => defaultPath && createAt(defaultPath)}
          disabled={!defaultPath}
        >
          Use default location
        </Button>
        <p className="mt-2 truncate text-center font-mono text-xs text-muted-foreground">
          {defaultPath}
        </p>

        <div className="mt-6 flex flex-col gap-1">
          <Button variant="ghost" onClick={chooseLocation}>
            Choose a location&hellip;
          </Button>
          <Button variant="ghost" onClick={openExisting}>
            Open an existing file&hellip;
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Write the file error screen**

Create `src/renderer/components/shell/FileErrorScreen.tsx`.

The reassurance line is not decoration. The single worst outcome for this app
is a user believing a parse error destroyed their prompts.

```tsx
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDocStore } from '@/store/docStore';

interface Props {
  file: string;
  message: string;
}

export function FileErrorScreen({ file, message }: Props) {
  const openAt = useDocStore((s) => s.openAt);

  const openOther = async () => {
    const next = await api.data.pickOpen();
    if (next) await openAt(next);
  };

  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="w-[34rem] rounded-xl border border-destructive/40 bg-card p-8">
        <h1 className="text-lg font-semibold text-card-foreground">
          Couldn&apos;t open this file
        </h1>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {file}
        </p>

        <pre className="mt-4 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
          {message}
        </pre>

        <p className="mt-4 text-sm text-muted-foreground">
          Your file has not been modified. AI Kanban will not write to a file
          it could not read.
        </p>

        <div className="mt-6 flex gap-2">
          <Button onClick={() => openAt(file)}>Retry</Button>
          <Button variant="secondary" onClick={() => api.data.reveal(file)}>
            Reveal in Finder
          </Button>
          <Button variant="ghost" onClick={openOther}>
            Open a different file&hellip;
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Write a read-only board view**

Create `src/renderer/components/board/BoardView.tsx`. Tasks 7 through 9
replace the inner markup; this version exists to prove the load pipeline
renders real data.

```tsx
import { useDocStore } from '@/store/docStore';

export function BoardView() {
  const board = useDocStore((s) =>
    s.doc?.boards.find((b) => b.id === s.activeBoardId) ?? null,
  );

  if (!board) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No board selected.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto p-4">
      {board.lists.map((list) => (
        <div
          key={list.id}
          className="flex w-72 shrink-0 flex-col rounded-lg bg-muted/50 p-2"
        >
          <div className="flex items-baseline justify-between px-1 pb-2">
            <h2 className="text-sm font-semibold">{list.name}</h2>
            <span className="text-xs text-muted-foreground">
              {list.cards.length}
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {list.cards.map((card) => (
              <div
                key={card.id}
                className="rounded-md border border-border bg-card p-2 text-sm"
              >
                {card.title}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8: Write the shell that switches on load status**

Create `src/renderer/components/shell/AppShell.tsx`.

```tsx
import { useEffect } from 'react';
import { useDocStore } from '@/store/docStore';
import { useTheme } from '@/lib/useTheme';
import { WelcomeScreen } from './WelcomeScreen';
import { FileErrorScreen } from './FileErrorScreen';
import { BoardView } from '@/components/board/BoardView';

export function AppShell() {
  useTheme();
  const status = useDocStore((s) => s.status);
  const bootstrap = useDocStore((s) => s.bootstrap);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  if (status.kind === 'loading') {
    return <div className="h-full bg-background" />;
  }
  if (status.kind === 'welcome') {
    return <WelcomeScreen />;
  }
  if (status.kind === 'error') {
    return <FileErrorScreen file={status.file} message={status.message} />;
  }
  return (
    <div className="flex h-full bg-background">
      <BoardView />
    </div>
  );
}
```

- [ ] **Step 9: Point `App.tsx` at the shell**

```tsx
import { AppShell } from '@/components/shell/AppShell';

export default function App() {
  return <AppShell />;
}
```

- [ ] **Step 10: Update the boilerplate smoke test**

Replace `src/__tests__/App.test.tsx`. `window.electron` does not exist in
jsdom, so the preload bridge has to be stubbed.

```tsx
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import App from '../renderer/App';

beforeAll(() => {
  Object.defineProperty(window, 'electron', {
    writable: true,
    value: {
      settings: {
        read: jest.fn().mockResolvedValue({
          dataFilePath: null,
          recentFiles: [],
          activeBoardId: null,
        }),
        write: jest.fn().mockResolvedValue({}),
      },
      data: {
        read: jest.fn(),
        write: jest.fn(),
        move: jest.fn(),
        pickOpen: jest.fn(),
        pickSave: jest.fn(),
        reveal: jest.fn(),
        defaultPath: jest.fn().mockResolvedValue('/tmp/kanban.json'),
        onChanged: jest.fn().mockReturnValue(() => {}),
      },
      clipboard: { write: jest.fn(), read: jest.fn() },
      shell: { openExternal: jest.fn() },
    },
  });
});

describe('App', () => {
  it('shows the welcome screen when no data file is configured', async () => {
    render(<App />);
    expect(
      await screen.findByRole('button', { name: /use default location/i }),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Run the test suite**

Run: `npx jest`
Expected: PASS — the schema tests plus the welcome-screen smoke test.

- [ ] **Step 12: Verify the real first run end to end**

```bash
rm -rf ~/Library/Application\ Support/AI\ Kanban
rm -rf ~/Documents/ai-kanban
npm start
```

Expected: the welcome screen appears. Click `Use default location`. A board
with Waiting / In Flight / Done renders, each showing a count of 0.

Confirm the file was written, then quit and relaunch:

```bash
cat ~/Documents/ai-kanban/kanban.json
```

Expected: the seeded document with `"version": 1`. On relaunch the board
appears directly, with no welcome screen.

Finally, prove the guard rail works. Quit the app, corrupt the file, relaunch:

```bash
echo 'oops' >> ~/Documents/ai-kanban/kanban.json
npm start
```

Expected: the error screen, showing a JSON parse message. Quit, remove the
`oops` line, relaunch, and confirm the board returns — proving the app did
not overwrite the broken file.

---

## Milestone 2 — Boards and lists

Ends with a fully usable board manager. No cards yet.

### Task 5: Debounced persistence and the board/list mutations

**Files:**
- Create: `src/renderer/store/persistence.ts`
- Create: `src/renderer/store/selectors.ts`
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/components/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `useDocStore`, `newId`, `serializeDoc`.
- Produces:
  - `startPersistence(): () => void` from `@/store/persistence`
  - New store field `savedSnapshot: string | null`
  - Store actions, all routed through `mutate`:
    - `addBoard(name: string): string` — returns the new board id
    - `renameBoard(boardId: string, name: string): void`
    - `deleteBoard(boardId: string): void`
    - `moveBoard(fromIndex: number, toIndex: number): void`
    - `addList(boardId: string, name: string): string`
    - `renameList(boardId: string, listId: string, name: string): void`
    - `deleteList(boardId: string, listId: string): void`
  - Selectors from `@/store/selectors`: `selectActiveBoard`, `selectBoardIds`, `selectBoardName(boardId)`, `selectList(boardId, listId)`

- [ ] **Step 1: Add `savedSnapshot` and the board/list actions to the store**

In `src/renderer/store/docStore.ts`:

1. Add `savedSnapshot: string | null;` to the `DocStore` interface and
   `savedSnapshot: null` to the initial state.
2. In **both** `createAt` and `openAt`, include
   `savedSnapshot: serializeDoc(doc)` (respectively `serializeDoc(parsed.doc)`)
   in the `set({ ... })` call that flips status to `ready`. This is what stops
   the app from immediately rewriting a file it just read.
3. Add these action signatures to the interface and implementations to the
   store body:

```ts
  addBoard: (name: string) => string;
  renameBoard: (boardId: string, name: string) => void;
  deleteBoard: (boardId: string) => void;
  moveBoard: (fromIndex: number, toIndex: number) => void;
  addList: (boardId: string, name: string) => string;
  renameList: (boardId: string, listId: string, name: string) => void;
  deleteList: (boardId: string, listId: string) => void;
```

```ts
  addBoard: (name) => {
    const id = newId('brd');
    get().mutate((draft) => {
      draft.boards.push({
        id,
        name,
        lists: [
          { id: newId('lst'), name: 'Waiting', cards: [] },
          { id: newId('lst'), name: 'In Flight', cards: [] },
          { id: newId('lst'), name: 'Done', cards: [] },
        ],
      });
    });
    get().setActiveBoard(id);
    return id;
  },

  renameBoard: (boardId, name) => {
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.name = name;
    });
  },

  deleteBoard: (boardId) => {
    const remaining = (get().doc?.boards ?? []).filter(
      (b) => b.id !== boardId,
    );
    get().mutate((draft) => {
      draft.boards = draft.boards.filter((b) => b.id !== boardId);
    });
    // Deleting the active board must leave a valid selection, or null when
    // nothing is left. Null renders the empty state, never the welcome screen.
    if (get().activeBoardId === boardId) {
      const next = remaining[0]?.id ?? null;
      set({ activeBoardId: next });
      void api.settings.write({ activeBoardId: next });
    }
  },

  moveBoard: (fromIndex, toIndex) => {
    get().mutate((draft) => {
      const [moved] = draft.boards.splice(fromIndex, 1);
      if (moved) draft.boards.splice(toIndex, 0, moved);
    });
  },

  addList: (boardId, name) => {
    const id = newId('lst');
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.lists.push({ id, name, cards: [] });
    });
    return id;
  },

  renameList: (boardId, listId, name) => {
    get().mutate((draft) => {
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      if (list) list.name = name;
    });
  },

  deleteList: (boardId, listId) => {
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.lists = board.lists.filter((l) => l.id !== listId);
    });
  },
```

4. Add `import { newId } from '@/domain/ids';` to the imports.

- [ ] **Step 2: Write the persistence subscription**

Create `src/renderer/store/persistence.ts`.

The `savedSnapshot` comparison is what makes this safe to run unconditionally:
a load, an undo back to the saved state, or a rename to the same name all
produce identical serialized output and write nothing.

```ts
import { serializeDoc } from '@shared/schema';
import { api } from '@/lib/api';
import { useDocStore } from './docStore';

const DEBOUNCE_MS = 500;

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Subscribes the data file to the store. Returns an unsubscribe function.
 * Writes are debounced and skipped entirely when the serialized document
 * matches what is already on disk.
 */
export function startPersistence(): () => void {
  const unsubscribe = useDocStore.subscribe((state, previous) => {
    if (state.doc === previous.doc) return;
    if (state.status.kind !== 'ready') return;
    if (!state.doc || !state.filePath) return;

    const contents = serializeDoc(state.doc);
    if (contents === state.savedSnapshot) return;

    const file = state.filePath;
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      const result = await api.data.write(file, contents);
      if (result.ok) {
        useDocStore.setState({ savedSnapshot: contents });
      } else {
        useDocStore.setState({
          status: { kind: 'error', message: result.error, file },
        });
      }
    }, DEBOUNCE_MS);
  });

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  };
}

/**
 * Flushes any pending write immediately. Called on window close so a change
 * made in the last 500ms is not lost.
 */
export async function flushPersistence(): Promise<void> {
  if (!timer) return;
  clearTimeout(timer);
  timer = null;
  const { doc, filePath, savedSnapshot } = useDocStore.getState();
  if (!doc || !filePath) return;
  const contents = serializeDoc(doc);
  if (contents === savedSnapshot) return;
  await api.data.write(filePath, contents);
  useDocStore.setState({ savedSnapshot: contents });
}
```

- [ ] **Step 3: Write the selectors**

Create `src/renderer/store/selectors.ts`.

Immer gives structural sharing, so a list object keeps its identity when an
unrelated list changes. Selecting an entity **by id** therefore gives a
genuinely stable reference and no re-render — this is the whole reason
components take ids as props rather than objects.

```ts
import type { Board, List } from '@shared/schema';
import type { useDocStore } from './docStore';

type State = ReturnType<typeof useDocStore.getState>;

export const selectActiveBoard = (state: State): Board | null =>
  state.doc?.boards.find((b) => b.id === state.activeBoardId) ?? null;

export const selectBoardIds = (state: State): string[] =>
  state.doc?.boards.map((b) => b.id) ?? [];

export const selectBoardName =
  (boardId: string) =>
  (state: State): string =>
    state.doc?.boards.find((b) => b.id === boardId)?.name ?? '';

export const selectList =
  (boardId: string, listId: string) =>
  (state: State): List | null =>
    state.doc?.boards
      .find((b) => b.id === boardId)
      ?.lists.find((l) => l.id === listId) ?? null;
```

- [ ] **Step 4: Start persistence in the shell and flush on unload**

In `src/renderer/components/shell/AppShell.tsx`, add the import
`import { startPersistence, flushPersistence } from '@/store/persistence';`
and add this effect below the existing `bootstrap` effect:

```tsx
  useEffect(() => {
    const stop = startPersistence();
    const onBeforeUnload = () => {
      void flushPersistence();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      stop();
    };
  }, []);
```

- [ ] **Step 5: Verify persistence writes once, and only when needed**

Run: `npm start`, then in the devtools console:

```js
const store = window.__docStoreForDebug;  // see next step if undefined
```

Simpler check without exposing the store: use the UI in Task 6. For now,
verify the no-op guard by watching the file's modification time. In a
terminal:

```bash
stat -f '%m %N' ~/Documents/ai-kanban/kanban.json
```

Launch the app, wait five seconds, and run the command again. Expected: the
modification time is **unchanged** — loading a document must not rewrite it.

If the timestamp moved, `savedSnapshot` is not being set on load, and the
app is rewriting the file on every launch.

---

### Task 6: Sidebar with board CRUD

**Files:**
- Create: `src/renderer/components/common/InlineEditableText.tsx`
- Create: `src/renderer/components/common/ConfirmDialog.tsx`
- Create: `src/renderer/components/sidebar/Sidebar.tsx`
- Create: `src/renderer/components/sidebar/SidebarBoardItem.tsx`
- Modify: `src/renderer/components/shell/AppShell.tsx`

**Interfaces:**
- Consumes: the Task 5 board actions; `selectBoardIds`, `selectBoardName`.
- Produces:
  - `InlineEditableText` with props `{ value: string; onCommit: (next: string) => void; label: string; className?: string; inputClassName?: string }`
  - `ConfirmDialog` with props `{ open: boolean; onOpenChange: (open: boolean) => void; title: string; body: string; confirmLabel: string; onConfirm: () => void }`
  - `Sidebar` and `SidebarBoardItem` (props `{ boardId: string; index: number }`)

- [ ] **Step 1: Add the shadcn components this task needs**

```bash
npx shadcn@latest add alert-dialog dropdown-menu
```

- [ ] **Step 2: Write `InlineEditableText`**

Create `src/renderer/components/common/InlineEditableText.tsx`.

Blur commits rather than cancels: a user who clicks away from a rename they
just typed means to keep it. Esc is the explicit escape hatch, and it sets a
ref flag so the blur that follows does not re-commit the reverted value.

```tsx
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  value: string;
  onCommit: (next: string) => void;
  label: string;
  className?: string;
  inputClassName?: string;
  /**
   * 'click' (default) starts editing on a single click. 'doubleClick' is for
   * places where a single click already means something else - selecting a
   * board in the sidebar, for instance - so that this component can be the
   * only <button> in the row rather than a button nested inside one.
   */
  editOn?: 'click' | 'doubleClick';
  /** Called on single click when editOn is 'doubleClick'. */
  onActivate?: () => void;
}

export function InlineEditableText({
  value,
  onCommit,
  label,
  className,
  inputClassName,
  editOn = 'click',
  onActivate,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const start = () => {
    setDraft(value);
    cancelled.current = false;
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
  };

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={editOn === 'click' ? `Rename ${label}` : label}
        onClick={editOn === 'click' ? start : onActivate}
        onDoubleClick={editOn === 'doubleClick' ? start : undefined}
        className={cn('truncate text-left', className)}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          setEditing(false);
        }
      }}
      className={cn(
        'w-full rounded-sm bg-background px-1 outline-none ring-2 ring-ring',
        inputClassName,
      )}
    />
  );
}
```

- [ ] **Step 3: Write `ConfirmDialog`**

Create `src/renderer/components/common/ConfirmDialog.tsx`. Only board
deletion uses this; everything else relies on undo.

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
}: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: Write `SidebarBoardItem`**

Create `src/renderer/components/sidebar/SidebarBoardItem.tsx`.

The delete confirmation states the card count, because "delete this board" and
"delete these 37 prompts" are different decisions.

```tsx
import { useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { useDocStore } from '@/store/docStore';
import { cn } from '@/lib/utils';

interface Props {
  boardId: string;
}

export function SidebarBoardItem({ boardId }: Props) {
  const [confirming, setConfirming] = useState(false);
  const board = useDocStore(
    (s) => s.doc?.boards.find((b) => b.id === boardId) ?? null,
  );
  const isActive = useDocStore((s) => s.activeBoardId === boardId);
  const setActiveBoard = useDocStore((s) => s.setActiveBoard);
  const renameBoard = useDocStore((s) => s.renameBoard);
  const deleteBoard = useDocStore((s) => s.deleteBoard);

  if (!board) return null;

  const cardCount = board.lists.reduce(
    (total, list) => total + list.cards.length,
    0,
  );

  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm',
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/50',
      )}
    >
      <div className="min-w-0 flex-1">
        <InlineEditableText
          value={board.name}
          label={`Board: ${board.name}`}
          editOn="doubleClick"
          onActivate={() => setActiveBoard(boardId)}
          onCommit={(next) => renameBoard(boardId, next)}
          className="w-full"
        />
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Board options for ${board.name}`}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirming(true)}
          >
            Delete board
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete "${board.name}"?`}
        body={
          cardCount === 0
            ? 'This board is empty.'
            : `${cardCount} prompt${cardCount === 1 ? '' : 's'} will be deleted. This cannot be undone after you quit.`
        }
        confirmLabel="Delete board"
        onConfirm={() => deleteBoard(boardId)}
      />
    </div>
  );
}
```

If `DropdownMenuItem` does not accept a `variant` prop in the installed
shadcn version, use `className="text-destructive focus:text-destructive"`
instead.

- [ ] **Step 5: Write `Sidebar`**

Create `src/renderer/components/sidebar/Sidebar.tsx`.

```tsx
import { useState } from 'react';
import { Plus, Settings } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useDocStore } from '@/store/docStore';
import { selectBoardIds } from '@/store/selectors';
import { SidebarBoardItem } from './SidebarBoardItem';

export function Sidebar() {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const boardIds = useDocStore(useShallow(selectBoardIds));
  const addBoard = useDocStore((s) => s.addBoard);

  const commit = () => {
    const name = draft.trim();
    if (name) addBoard(name);
    setDraft('');
    setAdding(false);
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-muted/30">
      <div className="px-3 py-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        Boards
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        {boardIds.map((boardId) => (
          <SidebarBoardItem key={boardId} boardId={boardId} />
        ))}

        {adding ? (
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            aria-label="New board name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit();
              if (event.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
            placeholder="Board name"
            className="mt-1 w-full rounded-md bg-background px-2 py-1.5 text-sm outline-none ring-2 ring-ring"
          />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
          >
            <Plus className="size-4" />
            New board
          </button>
        )}
      </div>

      <button
        type="button"
        aria-label="Settings"
        className="flex items-center gap-1.5 border-t border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground"
      >
        <Settings className="size-4" />
        Settings
      </button>
    </aside>
  );
}
```

The Settings button has no handler yet; Task 18 wires it.

- [ ] **Step 6: Render the sidebar in the shell**

In `src/renderer/components/shell/AppShell.tsx`, import `Sidebar` and change
the `ready` branch to:

```tsx
  return (
    <div className="flex h-full bg-background">
      <Sidebar />
      <main className="min-w-0 flex-1">
        <BoardView />
      </main>
    </div>
  );
```

- [ ] **Step 7: Verify board CRUD and persistence together**

Run: `npm start`

1. Click `New board`, type `Client Work`, press Enter. Expected: it appears in
   the sidebar and becomes the active board with three seeded lists.
2. Single-click a different board's name. Expected: it becomes the active
   board and does **not** enter rename mode.
3. Double-click the active board's name. Expected: it becomes an input. Type a
   new name and press Enter. Expected: the name updates.
4. Double-click the name again, type something, press Escape. Expected: the
   original name is restored.

Sidebar names use `editOn="doubleClick"` because a single click there already
means "select this board". The board header and list headers keep the default
single-click behavior, since nothing competes for that click.
5. Wait one second, then check the file:

```bash
grep '"name"' ~/Documents/ai-kanban/kanban.json
```

Expected: the renamed board is present in the file.

6. Quit and relaunch. Expected: both boards are there and the app opens on the
   board that was last active.
7. Open the `⋯` menu on a board and delete it. Expected: the confirm dialog
   states the prompt count, and after confirming, the board is gone and a
   remaining board becomes active.
8. Delete every board. Expected: `No board selected.` renders — **not** the
   welcome screen.

---

### Task 7: Board view with list CRUD

**Files:**
- Create: `src/renderer/components/board/ListColumn.tsx`
- Create: `src/renderer/components/board/AddListColumn.tsx`
- Modify: `src/renderer/components/board/BoardView.tsx`

**Interfaces:**
- Consumes: `addList`, `renameList`, `deleteList`, `renameBoard`, `selectActiveBoard`, `InlineEditableText`.
- Produces: `ListColumn` with props `{ boardId: string; listId: string }`, and `AddListColumn` with props `{ boardId: string }`.

- [ ] **Step 1: Write `ListColumn`**

Create `src/renderer/components/board/ListColumn.tsx`. Cards render as
title-only chips here; Task 9 replaces that block with `PromptCard`.

```tsx
import { MoreHorizontal } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { useDocStore } from '@/store/docStore';
import { selectList } from '@/store/selectors';

interface Props {
  boardId: string;
  listId: string;
}

export function ListColumn({ boardId, listId }: Props) {
  const list = useDocStore(selectList(boardId, listId));
  const renameList = useDocStore((s) => s.renameList);
  const deleteList = useDocStore((s) => s.deleteList);

  if (!list) return null;

  return (
    <div className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-muted/50">
      <div className="flex items-center gap-1 px-3 py-2">
        <InlineEditableText
          value={list.name}
          label={`list name for ${list.name}`}
          onCommit={(next) => renameList(boardId, listId, next)}
          className="flex-1 text-sm font-semibold"
        />
        <span className="text-xs tabular-nums text-muted-foreground">
          {list.cards.length}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`List options for ${list.name}`}>
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => deleteList(boardId, listId)}>
              Delete list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-2 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {list.cards.map((card) => (
          <div
            key={card.id}
            className="rounded-md border border-border bg-card p-2 text-sm"
          >
            {card.title}
          </div>
        ))}
      </div>
    </div>
  );
}
```

`Delete list` has no confirmation by design — Task 16 makes `Cmd+Z` recover it.

- [ ] **Step 2: Write `AddListColumn`**

Create `src/renderer/components/board/AddListColumn.tsx`.

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useDocStore } from '@/store/docStore';

interface Props {
  boardId: string;
}

export function AddListColumn({ boardId }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const addList = useDocStore((s) => s.addList);

  const commit = () => {
    const name = draft.trim();
    if (name) addList(boardId, name);
    setDraft('');
    setAdding(false);
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-10 w-72 shrink-0 items-center gap-1.5 rounded-lg bg-muted/30 px-3 text-sm text-muted-foreground hover:bg-muted/60"
      >
        <Plus className="size-4" />
        Add another list
      </button>
    );
  }

  return (
    <div className="w-72 shrink-0 rounded-lg bg-muted/50 p-2">
      <input
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        aria-label="New list name"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft('');
            setAdding(false);
          }
        }}
        placeholder="List name"
        className="w-full rounded-md bg-background px-2 py-1.5 text-sm outline-none ring-2 ring-ring"
      />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `BoardView`**

Replace the contents of `src/renderer/components/board/BoardView.tsx`.

```tsx
import { useDocStore } from '@/store/docStore';
import { selectActiveBoard } from '@/store/selectors';
import { InlineEditableText } from '@/components/common/InlineEditableText';
import { ListColumn } from './ListColumn';
import { AddListColumn } from './AddListColumn';

export function BoardView() {
  const board = useDocStore(selectActiveBoard);
  const renameBoard = useDocStore((s) => s.renameBoard);

  if (!board) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No board selected. Create one from the sidebar.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center border-b border-border px-4 py-3">
        <InlineEditableText
          value={board.name}
          label={`board name for ${board.name}`}
          onCommit={(next) => renameBoard(board.id, next)}
          className="text-base font-semibold"
        />
      </header>

      <div className="flex flex-1 items-start gap-3 overflow-x-auto p-4">
        {board.lists.map((list) => (
          <ListColumn key={list.id} boardId={board.id} listId={list.id} />
        ))}
        <AddListColumn boardId={board.id} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify list CRUD**

Run: `npm start`

1. Click `Add another list`, type `Blocked`, press Enter. Expected: a fourth
   column appears with a count of 0.
2. Click a list's name, rename it, press Enter. Expected: the name updates.
3. Delete a list from its `⋯` menu. Expected: it disappears immediately with
   no dialog.
4. Wait one second and confirm the file reflects all three changes:

```bash
python3 -c "import json;d=json.load(open('$HOME/Documents/ai-kanban/kanban.json'));print([l['name'] for b in d['boards'] for l in b['lists']])"
```

Expected: the printed list names match what is on screen.

---

## Milestone 3 — Cards: the actual tool

Ends with a working prompt library.

### Task 8: Card store actions and the composer dialog

**Files:**
- Create: `src/renderer/components/card/CardComposerDialog.tsx`
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/components/board/ListColumn.tsx`

**Interfaces:**
- Consumes: `mutate`, `newId`, `Card` from `@shared/schema`.
- Produces:
  - `addCard(boardId: string, listId: string, fields: NewCardFields): string`
  - `updateCard(boardId: string, listId: string, cardId: string, patch: Partial<Card>): void`
  - `deleteCard(boardId: string, listId: string, cardId: string): void`
  - `NewCardFields` = `{ title: string; prompt: string; tags?: string[]; notes?: string; link?: string }`
  - `CardComposerDialog` with props `{ open: boolean; onOpenChange: (open: boolean) => void; boardId: string; listId: string; cardId: string | null }` — `cardId: null` means create, otherwise edit.

- [ ] **Step 1: Add the dialog and textarea components**

```bash
npx shadcn@latest add dialog textarea label
```

- [ ] **Step 2: Add the card actions to the store**

In `src/renderer/store/docStore.ts`, add to the imports:

```ts
import type { Card, KanbanDoc } from '@shared/schema';
```

Add the type and the interface members:

```ts
export interface NewCardFields {
  title: string;
  prompt: string;
  tags?: string[];
  notes?: string;
  link?: string;
}
```

```ts
  addCard: (boardId: string, listId: string, fields: NewCardFields) => string;
  updateCard: (
    boardId: string,
    listId: string,
    cardId: string,
    patch: Partial<Card>,
  ) => void;
  deleteCard: (boardId: string, listId: string, cardId: string) => void;
```

Add the implementations. `updatedAt` is stamped centrally here so no caller
can forget it:

```ts
  addCard: (boardId, listId, fields) => {
    const id = newId('crd');
    const now = new Date().toISOString();
    get().mutate((draft) => {
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      if (!list) return;
      list.cards.push({
        id,
        title: fields.title,
        prompt: fields.prompt,
        tags: fields.tags ?? [],
        notes: fields.notes ?? '',
        link: fields.link ?? '',
        variables: {},
        copyCount: 0,
        lastCopiedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    return id;
  },

  updateCard: (boardId, listId, cardId, patch) => {
    get().mutate((draft) => {
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      const card = list?.cards.find((c) => c.id === cardId);
      if (!card) return;
      Object.assign(card, patch, { updatedAt: new Date().toISOString() });
    });
  },

  deleteCard: (boardId, listId, cardId) => {
    get().mutate((draft) => {
      const list = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId);
      if (list) list.cards = list.cards.filter((c) => c.id !== cardId);
    });
  },
```

- [ ] **Step 3: Write the composer dialog**

Create `src/renderer/components/card/CardComposerDialog.tsx`.

One component serves create and edit, so the two can never drift apart. The
prompt textarea is monospace because the prompt is copied verbatim and
whitespace is significant. Task 12 adds the tag picker below the prompt;
Task 15 adds the detected-variable hint.

```tsx
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useDocStore } from '@/store/docStore';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  listId: string;
  cardId: string | null;
}

export function CardComposerDialog({
  open,
  onOpenChange,
  boardId,
  listId,
  cardId,
}: Props) {
  const existing = useDocStore((s) =>
    cardId
      ? (s.doc?.boards
          .find((b) => b.id === boardId)
          ?.lists.find((l) => l.id === listId)
          ?.cards.find((c) => c.id === cardId) ?? null)
      : null,
  );
  const addCard = useDocStore((s) => s.addCard);
  const updateCard = useDocStore((s) => s.updateCard);

  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [notes, setNotes] = useState('');
  const [link, setLink] = useState('');

  // Reset the fields every time the dialog opens, so a cancelled edit does
  // not leak into the next card.
  useEffect(() => {
    if (!open) return;
    setTitle(existing?.title ?? '');
    setPrompt(existing?.prompt ?? '');
    setNotes(existing?.notes ?? '');
    setLink(existing?.link ?? '');
  }, [open, existing]);

  const save = () => {
    const trimmedTitle = title.trim() || 'Untitled prompt';
    if (cardId) {
      updateCard(boardId, listId, cardId, {
        title: trimmedTitle,
        prompt,
        notes,
        link: link.trim(),
      });
    } else {
      addCard(boardId, listId, {
        title: trimmedTitle,
        prompt,
        notes,
        link: link.trim(),
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cardId ? 'Edit prompt' : 'New prompt'}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-title">Title</Label>
            <Input
              id="card-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What this prompt does"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-prompt">Prompt</Label>
            <Textarea
              id="card-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder="The prompt text, copied verbatim."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-notes">Notes</Label>
            <Textarea
              id="card-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Outcome, what to change next time. Never copied."
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="card-link">Link</Label>
            <Input
              id="card-link"
              value={link}
              onChange={(event) => setLink(event.target.value)}
              placeholder="https://"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{cardId ? 'Save' : 'Add prompt'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Add the composer trigger to `ListColumn`**

In `src/renderer/components/board/ListColumn.tsx`:

1. Add imports:

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { CardComposerDialog } from '@/components/card/CardComposerDialog';
```

2. Add state inside the component: `const [composing, setComposing] = useState(false);`
3. Add this below the cards container, inside the outer `div`:

```tsx
      <button
        type="button"
        onClick={() => setComposing(true)}
        className="mx-2 mb-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/50"
      >
        <Plus className="size-4" />
        Add prompt
      </button>

      <CardComposerDialog
        open={composing}
        onOpenChange={setComposing}
        boardId={boardId}
        listId={listId}
        cardId={null}
      />
```

- [ ] **Step 5: Verify card creation and the file shape**

Run: `npm start`

1. Click `Add prompt` on a list. Fill in a title and a **multi-line** prompt,
   then click `Add prompt`. Expected: the card's title appears in the column
   and the count increments.
2. Wait a second, then inspect what was written:

```bash
python3 -c "import json;d=json.load(open('$HOME/Documents/ai-kanban/kanban.json'));c=[c for b in d['boards'] for l in b['lists'] for c in l['cards']][0];print(json.dumps(c,indent=2))"
```

Expected: every field from the spec is present — `notes`, `link`,
`variables`, `copyCount`, `lastCopiedAt`, `createdAt`, `updatedAt` — and the
prompt's newlines are stored as `\n` escapes.

3. Confirm the multi-line prompt round-trips: quit, relaunch, open the card's
   editor, and check the line breaks are intact.

---

### Task 9: The prompt card — accordion, copy, edit, delete, paste-to-create

This is the task that makes the app worth opening.

**Files:**
- Create: `src/renderer/lib/clipboard.ts`
- Create: `src/renderer/lib/relativeTime.ts`
- Create: `src/renderer/components/card/PromptCard.tsx`
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/components/board/ListColumn.tsx`
- Modify: `src/renderer/components/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `updateCard`, `deleteCard`, `addCard`, `CardComposerDialog`, `api`.
- Produces:
  - `copyText(text: string): Promise<void>` from `@/lib/clipboard`
  - `relativeTime(iso: string): string` from `@/lib/relativeTime`
  - `recordCopy(boardId: string, listId: string, cardId: string): void` on the store
  - `PromptCard` with props `{ boardId: string; listId: string; cardId: string }`

- [ ] **Step 1: Add the toast component**

```bash
npx shadcn@latest add sonner
```

- [ ] **Step 2: Write the clipboard helper**

Create `src/renderer/lib/clipboard.ts`. Every copy in the app goes through
this one function.

```ts
import { api } from './api';

/**
 * Copies via Electron's main-process clipboard, never navigator.clipboard.
 * The packaged app serves the renderer from file://, which is not a secure
 * context, so the web Clipboard API is not dependable there.
 */
export async function copyText(text: string): Promise<void> {
  await api.clipboard.write(text);
}
```

- [ ] **Step 3: Write the relative time formatter**

Create `src/renderer/lib/relativeTime.ts`.

```ts
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
```

- [ ] **Step 4: Add `recordCopy` to the store**

In `src/renderer/store/docStore.ts`, add
`recordCopy: (boardId: string, listId: string, cardId: string) => void;` to
the interface and this implementation.

Note it deliberately does **not** touch `updatedAt`. Copying is not editing,
and conflating them would make "recently changed" meaningless.

```ts
  recordCopy: (boardId, listId, cardId) => {
    get().mutate((draft) => {
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (!card) return;
      card.copyCount += 1;
      card.lastCopiedAt = new Date().toISOString();
    });
  },
```

- [ ] **Step 5: Write `PromptCard`**

Create `src/renderer/components/card/PromptCard.tsx`.

Three details are deliberate. The prompt block is `whitespace-pre-wrap
font-mono` so what you read is exactly what you copy. It is capped at
`max-h-56` with its own scroll so one enormous prompt cannot swallow the
column. And `notes` is displayed but visually separated, because it must
never be mistaken for part of the prompt. Task 12 adds the tag row and
Task 15 replaces the copy button with the variable-aware version.

```tsx
import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  MoreHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { useDocStore } from '@/store/docStore';
import { copyText } from '@/lib/clipboard';
import { relativeTime } from '@/lib/relativeTime';
import { api } from '@/lib/api';
import { CardComposerDialog } from './CardComposerDialog';

interface Props {
  boardId: string;
  listId: string;
  cardId: string;
}

export function PromptCard({ boardId, listId, cardId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const card = useDocStore(
    (s) =>
      s.doc?.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId) ?? null,
  );
  const recordCopy = useDocStore((s) => s.recordCopy);
  const deleteCard = useDocStore((s) => s.deleteCard);

  if (!card) return null;

  const copy = async () => {
    await copyText(card.prompt);
    recordCopy(boardId, listId, cardId);
    toast.success('Prompt copied');
  };

  return (
    <div className="rounded-md border border-border bg-card shadow-sm">
      <div className="flex items-start gap-1 p-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="min-w-0 flex-1 text-left text-sm font-medium text-card-foreground hover:underline"
        >
          <span className="line-clamp-2">{card.title}</span>
        </button>

        <Button
          size="icon"
          variant="ghost"
          aria-label={`Copy prompt: ${card.title}`}
          onClick={copy}
          className="size-7 shrink-0"
        >
          <Copy className="size-3.5" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          aria-label={expanded ? 'Collapse prompt' : 'Expand prompt'}
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
          className="size-7 shrink-0"
        >
          {expanded ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-2 px-2 pb-2 text-xs text-muted-foreground">
        {card.copyCount > 0 && card.lastCopiedAt ? (
          <span className="tabular-nums">
            copied {card.copyCount}&times; &middot;{' '}
            {relativeTime(card.lastCopiedAt)}
          </span>
        ) : null}

        {card.link ? (
          <button
            type="button"
            aria-label="Open link"
            onClick={() => api.shell.openExternal(card.link)}
            className="hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </button>
        ) : null}

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Options for ${card.title}`}>
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              Edit&hellip;
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => deleteCard(boardId, listId, cardId)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {expanded ? (
        <div className="border-t border-border px-2 py-2">
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-foreground">
            {card.prompt}
          </pre>

          {card.notes ? (
            <p className="mt-2 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
              {card.notes}
            </p>
          ) : null}

          <Button size="sm" className="mt-2 w-full" onClick={copy}>
            <Copy className="size-3.5" />
            Copy
          </Button>
        </div>
      ) : null}

      <CardComposerDialog
        open={editing}
        onOpenChange={setEditing}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />
    </div>
  );
}
```

- [ ] **Step 6: Render `PromptCard` in `ListColumn` and add paste-to-create**

In `src/renderer/components/board/ListColumn.tsx`:

1. Add imports:

```tsx
import { PromptCard } from '@/components/card/PromptCard';
```

2. Replace the title-only chip block with:

```tsx
        {list.cards.map((card) => (
          <PromptCard
            key={card.id}
            boardId={boardId}
            listId={listId}
            cardId={card.id}
          />
        ))}
```

3. Add `const addCard = useDocStore((s) => s.addCard);` and this handler:

```tsx
  const pasteAsCard = (event: React.ClipboardEvent<HTMLDivElement>) => {
    // Do not hijack paste while the user is typing in a field.
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, [contenteditable="true"]')) return;

    const text = event.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    event.preventDefault();

    const firstLine = text.trim().split('\n')[0];
    const title =
      firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
    addCard(boardId, listId, { title, prompt: text });
  };
```

4. Make the column focusable so it can receive a paste, and attach the
   handler. Change the outer `div` to:

```tsx
    <div
      role="group"
      aria-label={`List: ${list.name}`}
      tabIndex={0}
      onPaste={pasteAsCard}
      className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
```

- [ ] **Step 7: Mount the toaster**

In `src/renderer/components/shell/AppShell.tsx`, add
`import { Toaster } from '@/components/ui/sonner';` and place `<Toaster />`
inside the `ready` branch's outer `div`, after `</main>`.

- [ ] **Step 8: Verify the core loop**

Run: `npm start`

1. Create a card with a long multi-line prompt. Click the chevron. Expected:
   the card expands in place, the prompt renders in monospace with line
   breaks preserved, and a very long prompt scrolls inside the card rather
   than stretching the column.
2. Expand two cards at once. Expected: both stay open.
3. Click the copy icon. Expected: a "Prompt copied" toast, and the card
   footer now reads `copied 1× · just now`. Paste into a text editor and
   confirm the text is byte-identical, including trailing whitespace.
4. Add notes to a card via its editor. Expand it. Expected: the notes appear
   below a dashed separator. Copy the card and paste. Expected: the notes are
   **not** in the clipboard.
5. Add a `https://` link. Expected: the ↗ icon appears and opens the URL in
   the default browser, not in an Electron window.
6. Click a card title. Expected: the editor opens prefilled. Change the title,
   save, and confirm the card updates.
7. Copy some multi-line text in another app. Click a list's background (a
   focus ring appears), then press `Cmd+V`. Expected: a new card appears with
   the first line as its title and the full text as its prompt.
8. Open a card's editor, focus the prompt textarea, and press `Cmd+V`.
   Expected: the text pastes into the textarea and **no** new card is
   created — this proves the guard in `pasteAsCard` works.

---

## Milestone 4 — Drag and drop

### Task 10: `applyDragEnd` and its unit tests

The one place in this app where a subtle bug is near-certain and invisible.

**Files:**
- Create: `src/renderer/domain/dragEnd.ts`
- Test: `src/__tests__/dragEnd.test.ts`

**Interfaces:**
- Consumes: `KanbanDoc` from `@shared/schema`.
- Produces:
  - `DND_TYPES = { board: 'BOARD', list: 'LIST', card: 'CARD' }` from `@/domain/dragEnd`
  - `applyDragEnd(doc: KanbanDoc, result: DropResult, activeBoardId: string | null): KanbanDoc` — returns the same object reference when the drag was a no-op.

- [ ] **Step 1: Install the drag-and-drop library**

```bash
npm i @hello-pangea/dnd
```

- [ ] **Step 2: Write the failing tests**

Create `src/__tests__/dragEnd.test.ts`.

The critical case is `same list, moved down`. `@hello-pangea/dnd` reports
`destination.index` as the index **after** the dragged item has been removed
from its source. So the only correct implementation removes first and then
inserts at the raw destination index. An implementation that inserts before
removing is off by one in exactly this case and no other — which is why it
survives casual testing.

```ts
import type { DropResult } from '@hello-pangea/dnd';
import { CURRENT_VERSION, type KanbanDoc } from '../shared/schema';
import { applyDragEnd, DND_TYPES } from '../renderer/domain/dragEnd';

function card(id: string) {
  return {
    id,
    title: id,
    prompt: '',
    tags: [],
    notes: '',
    link: '',
    variables: {},
    copyCount: 0,
    lastCopiedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function doc(): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: 'brd_1',
        name: 'One',
        lists: [
          { id: 'lst_a', name: 'A', cards: [card('c1'), card('c2'), card('c3')] },
          { id: 'lst_b', name: 'B', cards: [] },
        ],
      },
      { id: 'brd_2', name: 'Two', lists: [] },
    ],
  };
}

function drop(over: Partial<DropResult>): DropResult {
  return {
    draggableId: 'c1',
    type: DND_TYPES.card,
    reason: 'DROP',
    mode: 'FLUID',
    source: { droppableId: 'lst_a', index: 0 },
    destination: { droppableId: 'lst_a', index: 0 },
    combine: null,
    ...over,
  } as DropResult;
}

const titles = (d: KanbanDoc, listIndex: number) =>
  d.boards[0].lists[listIndex].cards.map((c) => c.id);

describe('applyDragEnd', () => {
  it('moves a card down within the same list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c1',
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_a', index: 2 },
      }),
      'brd_1',
    );
    // Not ['c2','c1','c3'] — that is the off-by-one an insert-before-remove
    // implementation produces.
    expect(titles(next, 0)).toEqual(['c2', 'c3', 'c1']);
  });

  it('moves a card up within the same list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c3',
        source: { droppableId: 'lst_a', index: 2 },
        destination: { droppableId: 'lst_a', index: 0 },
      }),
      'brd_1',
    );
    expect(titles(next, 0)).toEqual(['c3', 'c1', 'c2']);
  });

  it('moves a card to the front of another list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c2',
        source: { droppableId: 'lst_a', index: 1 },
        destination: { droppableId: 'lst_b', index: 0 },
      }),
      'brd_1',
    );
    expect(titles(next, 0)).toEqual(['c1', 'c3']);
    expect(titles(next, 1)).toEqual(['c2']);
  });

  it('moves a card into an empty list', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'c1',
        source: { droppableId: 'lst_a', index: 0 },
        destination: { droppableId: 'lst_b', index: 0 },
      }),
      'brd_1',
    );
    expect(titles(next, 1)).toEqual(['c1']);
  });

  it('reorders lists', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'lst_a',
        type: DND_TYPES.list,
        source: { droppableId: 'board', index: 0 },
        destination: { droppableId: 'board', index: 1 },
      }),
      'brd_1',
    );
    expect(next.boards[0].lists.map((l) => l.id)).toEqual(['lst_b', 'lst_a']);
  });

  it('reorders boards', () => {
    const next = applyDragEnd(
      doc(),
      drop({
        draggableId: 'brd_1',
        type: DND_TYPES.board,
        source: { droppableId: 'sidebar', index: 0 },
        destination: { droppableId: 'sidebar', index: 1 },
      }),
      null,
    );
    expect(next.boards.map((b) => b.id)).toEqual(['brd_2', 'brd_1']);
  });

  it('returns the identical document when dropped outside a target', () => {
    const original = doc();
    const next = applyDragEnd(original, drop({ destination: null }), 'brd_1');
    expect(next).toBe(original);
  });

  it('returns the identical document when dropped where it started', () => {
    const original = doc();
    const next = applyDragEnd(
      original,
      drop({
        source: { droppableId: 'lst_a', index: 1 },
        destination: { droppableId: 'lst_a', index: 1 },
      }),
      'brd_1',
    );
    expect(next).toBe(original);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest src/__tests__/dragEnd.test.ts`
Expected: FAIL — `Cannot find module '../renderer/domain/dragEnd'`.

- [ ] **Step 4: Write the implementation**

Create `src/renderer/domain/dragEnd.ts`.

Returning `doc` unchanged on a no-op matters beyond neatness: the persistence
subscription in Task 5 short-circuits on `state.doc === previous.doc`, so a
cancelled drag causes no disk write at all.

```ts
import { produce } from 'immer';
import type { DropResult } from '@hello-pangea/dnd';
import type { KanbanDoc } from '@shared/schema';

export const DND_TYPES = {
  board: 'BOARD',
  list: 'LIST',
  card: 'CARD',
} as const;

export function applyDragEnd(
  doc: KanbanDoc,
  result: DropResult,
  activeBoardId: string | null,
): KanbanDoc {
  const { type, source, destination } = result;

  // Dropped outside any droppable.
  if (!destination) return doc;

  // Dropped exactly where it started.
  if (
    source.droppableId === destination.droppableId &&
    source.index === destination.index
  ) {
    return doc;
  }

  return produce(doc, (draft) => {
    if (type === DND_TYPES.board) {
      const [moved] = draft.boards.splice(source.index, 1);
      if (moved) draft.boards.splice(destination.index, 0, moved);
      return;
    }

    const board = draft.boards.find((b) => b.id === activeBoardId);
    if (!board) return;

    if (type === DND_TYPES.list) {
      const [moved] = board.lists.splice(source.index, 1);
      if (moved) board.lists.splice(destination.index, 0, moved);
      return;
    }

    const from = board.lists.find((l) => l.id === source.droppableId);
    const to = board.lists.find((l) => l.id === destination.droppableId);
    if (!from || !to) return;

    // Remove first, then insert at the raw destination index. The library
    // reports destination.index relative to the list AFTER removal, so this
    // order is required for same-list moves to land correctly.
    const [moved] = from.cards.splice(source.index, 1);
    if (!moved) return;
    to.cards.splice(destination.index, 0, moved);
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest src/__tests__/dragEnd.test.ts`
Expected: PASS, 8 tests.

Then run the whole suite: `npx jest`
Expected: PASS.

---

### Task 11: Wire drag and drop into the UI

**Files:**
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/components/board/BoardView.tsx`
- Modify: `src/renderer/components/board/ListColumn.tsx`
- Modify: `src/renderer/components/card/PromptCard.tsx`
- Modify: `src/renderer/components/sidebar/Sidebar.tsx`
- Modify: `src/renderer/components/sidebar/SidebarBoardItem.tsx`

**Interfaces:**
- Consumes: `applyDragEnd`, `DND_TYPES`.
- Produces:
  - `commit(next: KanbanDoc): void` on the store — the single funnel every document change passes through. **Task 16 hooks this and nothing else.**
  - `applyDrag(result: DropResult): void` on the store
  - `PromptCard` gains a required `index: number` prop
  - `SidebarBoardItem` gains a required `dragHandleProps` prop of type `DraggableProvidedDragHandleProps | null | undefined`

- [ ] **Step 1: Extract `commit` from `mutate`**

This supersedes the note in Task 4 Step 4. Drag-and-drop produces a whole new
document rather than a recipe, and mis-drags are the single most likely
mistake in this app — so undo has to cover them. Routing both paths through
one function is what guarantees that.

In `src/renderer/store/docStore.ts`, add `commit` to the interface and replace
`mutate`:

```ts
  commit: (next: KanbanDoc) => void;
  applyDrag: (result: DropResult) => void;
```

```ts
  commit: (next) => {
    set({ doc: next });
  },

  mutate: (recipe) => {
    const current = get().doc;
    if (!current) return;
    get().commit(produce(current, recipe));
  },

  applyDrag: (result) => {
    const current = get().doc;
    if (!current) return;
    const next = applyDragEnd(current, result, get().activeBoardId);
    // Identical reference means a no-op drag; skip the commit entirely so it
    // does not consume an undo slot or trigger a write.
    if (next === current) return;
    get().commit(next);
  },
```

Add the imports:

```ts
import type { DropResult } from '@hello-pangea/dnd';
import { applyDragEnd } from '@/domain/dragEnd';
```

- [ ] **Step 2: Make the card draggable**

In `src/renderer/components/card/PromptCard.tsx`:

1. Add `import { Draggable } from '@hello-pangea/dnd';` and add
   `index: number;` to `Props`.
2. Wrap the returned JSX. The drag handle is the whole card, but the copy and
   chevron buttons still work because the library ignores drags that begin on
   an interactive element:

```tsx
  return (
    <Draggable draggableId={cardId} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={
            snapshot.isDragging
              ? 'rounded-md border border-border bg-card shadow-lg ring-2 ring-ring'
              : 'rounded-md border border-border bg-card shadow-sm'
          }
        >
          {/* the existing card body, with its outer div's className removed */}
        </div>
      )}
    </Draggable>
  );
```

Move the existing card body inside, and delete the old outer
`<div className="rounded-md border …">` wrapper so there is only one.

- [ ] **Step 3: Make the list a droppable and a draggable**

In `src/renderer/components/board/ListColumn.tsx`:

1. Add `import { Draggable, Droppable } from '@hello-pangea/dnd';` and
   `import { DND_TYPES } from '@/domain/dragEnd';`
2. Add `index: number;` to `Props`.
3. Wrap the column in a `Draggable` (so lists reorder) and the cards area in a
   `Droppable` (so cards land). The drag handle is the **header only** —
   making the whole column a handle would make it impossible to scroll the
   card area:

```tsx
  return (
    <Draggable draggableId={listId} index={index}>
      {(listProvided) => (
        <div
          ref={listProvided.innerRef}
          {...listProvided.draggableProps}
          role="group"
          aria-label={`List: ${list.name}`}
          tabIndex={0}
          onPaste={pasteAsCard}
          className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-muted/50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div
            {...listProvided.dragHandleProps}
            className="flex items-center gap-1 px-3 py-2"
          >
            {/* the existing header contents */}
          </div>

          <Droppable droppableId={listId} type={DND_TYPES.card}>
            {(cardsProvided) => (
              <div
                ref={cardsProvided.innerRef}
                {...cardsProvided.droppableProps}
                className="flex min-h-2 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2"
              >
                {list.cards.map((card, index) => (
                  <PromptCard
                    key={card.id}
                    boardId={boardId}
                    listId={listId}
                    cardId={card.id}
                    index={index}
                  />
                ))}
                {cardsProvided.placeholder}
              </div>
            )}
          </Droppable>

          {/* the existing Add prompt button and CardComposerDialog */}
        </div>
      )}
    </Draggable>
  );
```

`cardsProvided.placeholder` is not optional — without it, the list does not
make room for the card being dragged and the drop feels broken.

- [ ] **Step 4: Add the board's `DragDropContext`**

In `src/renderer/components/board/BoardView.tsx`:

1. Add imports:

```tsx
import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { DND_TYPES } from '@/domain/dragEnd';
```

2. Add `const applyDrag = useDocStore((s) => s.applyDrag);`
3. Wrap the lists row. A horizontal `Droppable` of type `LIST` contains the
   list `Draggable`s, and each list contains its own card `Droppable` — the
   nesting is what makes both gestures work at once:

```tsx
      <DragDropContext onDragEnd={applyDrag}>
        <Droppable
          droppableId="board"
          direction="horizontal"
          type={DND_TYPES.list}
        >
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex flex-1 items-start gap-3 overflow-x-auto p-4"
            >
              {board.lists.map((list, index) => (
                <ListColumn
                  key={list.id}
                  boardId={board.id}
                  listId={list.id}
                  index={index}
                />
              ))}
              {provided.placeholder}
              <AddListColumn boardId={board.id} />
            </div>
          )}
        </Droppable>
      </DragDropContext>
```

- [ ] **Step 5: Make the sidebar boards draggable**

In `src/renderer/components/sidebar/Sidebar.tsx`:

1. Add imports:

```tsx
import { DragDropContext, Draggable, Droppable } from '@hello-pangea/dnd';
import { DND_TYPES } from '@/domain/dragEnd';
```

2. Add `const applyDrag = useDocStore((s) => s.applyDrag);`
3. Replace the `boardIds.map(...)` block with its own `DragDropContext` — the
   sidebar is a separate context from the board, so a board can never be
   dropped into a list:

```tsx
        <DragDropContext onDragEnd={applyDrag}>
          <Droppable droppableId="sidebar" type={DND_TYPES.board}>
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {boardIds.map((boardId, index) => (
                  <Draggable key={boardId} draggableId={boardId} index={index}>
                    {(dragProvided) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                      >
                        <SidebarBoardItem
                          boardId={boardId}
                          dragHandleProps={dragProvided.dragHandleProps}
                        />
                      </div>
                    )}
                  </Draggable>
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
```

- [ ] **Step 6: Accept the drag handle in `SidebarBoardItem`**

In `src/renderer/components/sidebar/SidebarBoardItem.tsx`:

1. Add the import and prop:

```tsx
import type { DraggableProvidedDragHandleProps } from '@hello-pangea/dnd';
```

```tsx
interface Props {
  boardId: string;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
}
```

2. Spread `{...dragHandleProps}` onto the outer `div`.

- [ ] **Step 7: Verify every drag gesture**

Run: `npm start`. Create a board with three lists and several cards.

1. Drag a card from the top of a list to the **bottom of the same list**.
   Expected: it lands last. If it lands second-to-last, the remove/insert
   order in `applyDragEnd` is wrong — the unit test should have caught it, so
   re-run `npx jest`.
2. Drag a card to another list. Expected: it lands at the drop position and
   both list counts update.
3. Drag a card into an empty list. Expected: it lands.
4. Drag a card and release it over the sidebar. Expected: nothing happens, and
   the card returns to its original position.
5. Drag a list by its **header**. Expected: the columns reorder.
6. Scroll a long list's cards with the wheel. Expected: it scrolls and does
   not initiate a list drag.
7. Drag a board in the sidebar. Expected: the order changes and persists after
   a relaunch.
8. Click the copy icon on a card. Expected: it copies and does **not** start a
   drag.
9. Reorder a card, wait a second, then check the file order matches the screen:

```bash
python3 -c "import json;d=json.load(open('$HOME/Documents/ai-kanban/kanban.json'));print([[c['title'] for c in l['cards']] for b in d['boards'] for l in b['lists']])"
```

---

## Milestone 5 — Tags and search

### Task 12: Tags

**Files:**
- Create: `src/renderer/domain/tags.ts`
- Create: `src/renderer/components/tags/TagBadge.tsx`
- Create: `src/renderer/components/tags/TagPicker.tsx`
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/components/card/PromptCard.tsx`
- Modify: `src/renderer/components/card/CardComposerDialog.tsx`

**Interfaces:**
- Consumes: `mutate`, `KanbanDoc`.
- Produces:
  - `TAG_PALETTE: string[]`, `nextTagColor(doc: KanbanDoc): string`, `collectTagCounts(doc: KanbanDoc): Record<string, number>`, `normalizeTagName(raw: string): string` from `@/domain/tags`
  - Store actions: `ensureTag(name: string): string` (returns the normalized name), `setCardTags(boardId, listId, cardId, tags: string[]): void`, `renameTag(from: string, to: string): void`, `deleteTag(name: string): void`
  - `TagBadge` with props `{ name: string; onRemove?: () => void }`
  - `TagPicker` with props `{ selected: string[]; onChange: (next: string[]) => void }`

- [ ] **Step 1: Add the components this task needs**

```bash
npx shadcn@latest add badge popover command
```

- [ ] **Step 2: Write the tag domain helpers**

Create `src/renderer/domain/tags.ts`.

Normalization is what stops `Code`, `code`, and ` code ` from becoming three
different tags in an ad-hoc-entry UI.

```ts
import type { KanbanDoc } from '@shared/schema';

export const TAG_PALETTE = [
  '#4f8ef7',
  '#e0a341',
  '#5cb85c',
  '#d9534f',
  '#9b6dd6',
  '#39b3ab',
  '#e2679a',
  '#8a8f98',
];

export function normalizeTagName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Picks the palette entry least used so far, so a handful of tags stay
 * visually distinct instead of all landing on the first color.
 */
export function nextTagColor(doc: KanbanDoc): string {
  const used = new Set(Object.values(doc.tags).map((t) => t.color));
  return TAG_PALETTE.find((color) => !used.has(color)) ?? TAG_PALETTE[0];
}

export function collectTagCounts(doc: KanbanDoc): Record<string, number> {
  const counts: Record<string, number> = {};
  Object.keys(doc.tags).forEach((name) => {
    counts[name] = 0;
  });
  doc.boards.forEach((board) =>
    board.lists.forEach((list) =>
      list.cards.forEach((card) =>
        card.tags.forEach((name) => {
          counts[name] = (counts[name] ?? 0) + 1;
        }),
      ),
    ),
  );
  return counts;
}
```

- [ ] **Step 3: Add the tag actions to the store**

In `src/renderer/store/docStore.ts`, add these to the interface and body, plus
`import { normalizeTagName, nextTagColor } from '@/domain/tags';`

```ts
  ensureTag: (name: string) => string;
  setCardTags: (
    boardId: string,
    listId: string,
    cardId: string,
    tags: string[],
  ) => void;
  renameTag: (from: string, to: string) => void;
  deleteTag: (name: string) => void;
```

```ts
  ensureTag: (name) => {
    const normalized = normalizeTagName(name);
    if (!normalized) return '';
    get().mutate((draft) => {
      if (!draft.tags[normalized]) {
        draft.tags[normalized] = { color: nextTagColor(draft) };
      }
    });
    return normalized;
  },

  setCardTags: (boardId, listId, cardId, tags) => {
    const normalized = Array.from(
      new Set(tags.map(normalizeTagName).filter(Boolean)),
    );
    get().mutate((draft) => {
      normalized.forEach((name) => {
        if (!draft.tags[name]) {
          draft.tags[name] = { color: nextTagColor(draft) };
        }
      });
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (!card) return;
      card.tags = normalized;
      card.updatedAt = new Date().toISOString();
    });
  },

  /**
   * Renaming sweeps every card. Cards store tag names, which is what keeps
   * the data file readable; the cost is this O(n) pass on a rare action.
   */
  renameTag: (from, to) => {
    const target = normalizeTagName(to);
    if (!target || target === from) return;
    get().mutate((draft) => {
      const existing = draft.tags[from];
      if (!existing) return;
      delete draft.tags[from];
      draft.tags[target] = draft.tags[target] ?? existing;
      draft.boards.forEach((board) =>
        board.lists.forEach((list) =>
          list.cards.forEach((card) => {
            if (!card.tags.includes(from)) return;
            card.tags = Array.from(
              new Set(card.tags.map((t) => (t === from ? target : t))),
            );
          }),
        ),
      );
    });
  },

  deleteTag: (name) => {
    get().mutate((draft) => {
      delete draft.tags[name];
      draft.boards.forEach((board) =>
        board.lists.forEach((list) =>
          list.cards.forEach((card) => {
            card.tags = card.tags.filter((t) => t !== name);
          }),
        ),
      );
    });
  },
```

- [ ] **Step 4: Write `TagBadge`**

Create `src/renderer/components/tags/TagBadge.tsx`. The color comes from the
document's tag registry, with a neutral fallback so a card referencing a tag
that is somehow missing still renders.

```tsx
import { X } from 'lucide-react';
import { useDocStore } from '@/store/docStore';
import { TAG_PALETTE } from '@/domain/tags';

interface Props {
  name: string;
  onRemove?: () => void;
}

export function TagBadge({ name, onRemove }: Props) {
  const color = useDocStore(
    (s) => s.doc?.tags[name]?.color ?? TAG_PALETTE[TAG_PALETTE.length - 1],
  );

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {name}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove tag ${name}`}
          onClick={onRemove}
          className="hover:opacity-70"
        >
          <X className="size-3" />
        </button>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 5: Write `TagPicker`**

Create `src/renderer/components/tags/TagPicker.tsx`.

Ad-hoc creation is the requirement, so typing a name that does not exist
offers `Create "name"` inline rather than sending you to a tag manager.

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useDocStore } from '@/store/docStore';
import { normalizeTagName } from '@/domain/tags';
import { TagBadge } from './TagBadge';

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
}

export function TagPicker({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const allTags = useDocStore((s) => Object.keys(s.doc?.tags ?? {}));

  const normalizedQuery = normalizeTagName(query);
  const canCreate =
    normalizedQuery.length > 0 && !allTags.includes(normalizedQuery);

  const toggle = (name: string) => {
    onChange(
      selected.includes(name)
        ? selected.filter((t) => t !== name)
        : [...selected, name],
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((name) => (
        <TagBadge
          key={name}
          name={name}
          onRemove={() => onChange(selected.filter((t) => t !== name))}
        />
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="Add tag"
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3" />
          Tag
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Find or create a tag"
              value={query}
              onValueChange={setQuery}
            />
            <CommandList>
              <CommandEmpty>No matching tags.</CommandEmpty>
              <CommandGroup>
                {allTags.map((name) => (
                  <CommandItem key={name} value={name} onSelect={() => toggle(name)}>
                    <span className="flex-1">{name}</span>
                    {selected.includes(name) ? (
                      <span className="text-xs text-muted-foreground">
                        added
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
                {canCreate ? (
                  <CommandItem
                    value={`create-${normalizedQuery}`}
                    onSelect={() => {
                      onChange([...selected, normalizedQuery]);
                      setQuery('');
                    }}
                  >
                    Create &ldquo;{normalizedQuery}&rdquo;
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 6: Add tags to the composer**

In `src/renderer/components/card/CardComposerDialog.tsx`:

1. Import `TagPicker`.
2. Add state: `const [tags, setTags] = useState<string[]>([]);` and reset it in
   the existing open-effect with `setTags(existing?.tags ?? []);`
3. Add a field between the prompt and notes:

```tsx
          <div className="flex flex-col gap-1.5">
            <Label>Tags</Label>
            <TagPicker selected={tags} onChange={setTags} />
          </div>
```

4. In `save`, pass the tags. For the create branch add `tags` to the
   `addCard` fields object. For the edit branch, call
   `setCardTags(boardId, listId, cardId, tags)` after `updateCard` — this
   registers any newly created tag names in the document's tag map.
   Add `const setCardTags = useDocStore((s) => s.setCardTags);`

- [ ] **Step 7: Show tags on the card**

In `src/renderer/components/card/PromptCard.tsx`, import `TagBadge` and insert
this directly above the footer row:

```tsx
      {card.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1 px-2 pb-1.5">
          {card.tags.map((name) => (
            <TagBadge key={name} name={name} />
          ))}
        </div>
      ) : null}
```

- [ ] **Step 8: Verify tagging**

Run: `npm start`

1. Open a card's editor, click `+ Tag`, type `Code Review`, and choose
   `Create "code-review"`. Expected: the offered name is normalized to
   lowercase and hyphenated.
2. Save. Expected: the badge appears on the card with a color.
3. Add a second tag to a different card. Expected: it gets a **different**
   palette color.
4. Add the same tag to a third card via the picker's existing-tag list.
   Expected: same color, and the tag is not duplicated in the file.
5. Check the file:

```bash
python3 -c "import json;d=json.load(open('$HOME/Documents/ai-kanban/kanban.json'));print(d['tags']);print([c['tags'] for b in d['boards'] for l in b['lists'] for c in l['cards']])"
```

Expected: the top-level `tags` map holds each name once with a color, and
cards reference tags by **name**.

6. Delete every card carrying a tag. Expected: the tag remains in the
   top-level `tags` map — tags survive their last use.

---

### Task 13: In-board filter bar

**Files:**
- Create: `src/renderer/domain/filter.ts`
- Create: `src/renderer/store/uiStore.ts`
- Create: `src/renderer/components/board/FilterBar.tsx`
- Modify: `src/renderer/components/board/BoardView.tsx`
- Modify: `src/renderer/components/board/ListColumn.tsx`
- Modify: `src/renderer/components/card/PromptCard.tsx`

**Interfaces:**
- Consumes: `Card` from `@shared/schema`.
- Produces:
  - `FilterState = { text: string; tags: string[] }`, `EMPTY_FILTER`, `isFilterActive(f: FilterState): boolean`, `cardMatches(card: Card, f: FilterState): boolean` from `@/domain/filter`
  - `useUiStore` from `@/store/uiStore` with `{ filter, setFilterText, toggleFilterTag, clearFilter }`
  - `FilterBar` (no props)

- [ ] **Step 1: Write the filter predicate**

Create `src/renderer/domain/filter.ts`.

Text matches across title, prompt, notes, and tag names — searching for a
phrase you remember from the middle of a prompt is the whole point. Tags are
**AND**-ed, because narrowing is what tag chips are for.

```ts
import type { Card } from '@shared/schema';

export interface FilterState {
  text: string;
  tags: string[];
}

export const EMPTY_FILTER: FilterState = { text: '', tags: [] };

export function isFilterActive(filter: FilterState): boolean {
  return filter.text.trim().length > 0 || filter.tags.length > 0;
}

export function cardMatches(card: Card, filter: FilterState): boolean {
  if (!filter.tags.every((tag) => card.tags.includes(tag))) return false;

  const needle = filter.text.trim().toLowerCase();
  if (!needle) return true;

  return (
    card.title.toLowerCase().includes(needle) ||
    card.prompt.toLowerCase().includes(needle) ||
    card.notes.toLowerCase().includes(needle) ||
    card.tags.some((tag) => tag.includes(needle))
  );
}
```

- [ ] **Step 2: Write the UI store**

Create `src/renderer/store/uiStore.ts`. This is transient view state and
deliberately never persisted — reopening the app should not restore a filter
you forgot you set.

```ts
import { create } from 'zustand';
import { EMPTY_FILTER, type FilterState } from '@/domain/filter';

interface UiStore {
  filter: FilterState;
  paletteOpen: boolean;
  focusCardId: string | null;

  setFilterText: (text: string) => void;
  toggleFilterTag: (tag: string) => void;
  clearFilter: () => void;
  setPaletteOpen: (open: boolean) => void;
  setFocusCardId: (cardId: string | null) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  filter: EMPTY_FILTER,
  paletteOpen: false,
  focusCardId: null,

  setFilterText: (text) =>
    set((state) => ({ filter: { ...state.filter, text } })),

  toggleFilterTag: (tag) =>
    set((state) => ({
      filter: {
        ...state.filter,
        tags: state.filter.tags.includes(tag)
          ? state.filter.tags.filter((t) => t !== tag)
          : [...state.filter.tags, tag],
      },
    })),

  clearFilter: () => set({ filter: EMPTY_FILTER }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setFocusCardId: (focusCardId) => set({ focusCardId }),
}));
```

- [ ] **Step 3: Write `FilterBar`**

Create `src/renderer/components/board/FilterBar.tsx`.

```tsx
import { Search, X } from 'lucide-react';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { collectTagCounts } from '@/domain/tags';
import { isFilterActive } from '@/domain/filter';
import { TagBadge } from '@/components/tags/TagBadge';

export function FilterBar() {
  const filter = useUiStore((s) => s.filter);
  const setFilterText = useUiStore((s) => s.setFilterText);
  const toggleFilterTag = useUiStore((s) => s.toggleFilterTag);
  const clearFilter = useUiStore((s) => s.clearFilter);

  const tagNames = useDocStore((s) =>
    s.doc ? Object.keys(collectTagCounts(s.doc)).sort() : [],
  );

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="Filter prompts on this board"
          value={filter.text}
          onChange={(event) => setFilterText(event.target.value)}
          placeholder="Filter this board"
          className="h-7 w-56 rounded-md border border-border bg-background pr-2 pl-7 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <div className="flex flex-1 flex-wrap items-center gap-1">
        {tagNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => toggleFilterTag(name)}
            className={
              filter.tags.includes(name)
                ? 'rounded-full ring-2 ring-ring'
                : 'rounded-full opacity-50 hover:opacity-100'
            }
            aria-pressed={filter.tags.includes(name)}
          >
            <TagBadge name={name} />
          </button>
        ))}
      </div>

      {isFilterActive(filter) ? (
        <button
          type="button"
          onClick={clearFilter}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-3.5" />
          Clear
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Apply the filter in `ListColumn` and freeze dragging**

This step contains the one genuinely subtle interaction in the feature.

`@hello-pangea/dnd` reports `source.index` and `destination.index` against
**what is rendered**. If the rendered cards are a filtered subset, those
indices do not correspond to positions in `list.cards`, and a drag silently
moves the wrong card. Disabling drag while a filter is active is the correct
fix; translating indices through the filter would be a bug farm.

In `src/renderer/components/board/ListColumn.tsx`:

1. Add imports:

```tsx
import { useUiStore } from '@/store/uiStore';
import { cardMatches, isFilterActive } from '@/domain/filter';
```

2. Inside the component:

```tsx
  const filter = useUiStore((s) => s.filter);
  const filtering = isFilterActive(filter);
  const visibleCards = filtering
    ? list.cards.filter((card) => cardMatches(card, filter))
    : list.cards;
```

3. Change the header count to show `n/m` while filtering:

```tsx
        <span className="text-xs tabular-nums text-muted-foreground">
          {filtering
            ? `${visibleCards.length}/${list.cards.length}`
            : list.cards.length}
        </span>
```

4. Render `visibleCards` instead of `list.cards`, and pass the card's index in
   the **unfiltered** array so a later un-filtered drag is still correct:

```tsx
                {visibleCards.map((card) => (
                  <PromptCard
                    key={card.id}
                    boardId={boardId}
                    listId={listId}
                    cardId={card.id}
                    index={list.cards.indexOf(card)}
                    dragDisabled={filtering}
                  />
                ))}
```

5. Add `isDropDisabled={filtering}` to the cards `Droppable` and
   `isDragDisabled={filtering}` to the list `Draggable`.

- [ ] **Step 5: Accept `dragDisabled` in `PromptCard`**

Add `dragDisabled?: boolean;` to `Props` and pass
`isDragDisabled={dragDisabled}` to the card's `Draggable`.

- [ ] **Step 6: Render the filter bar**

In `src/renderer/components/board/BoardView.tsx`, import `FilterBar` and place
`<FilterBar />` directly below the `</header>` line.

- [ ] **Step 7: Verify filtering**

Run: `npm start`. Create at least six cards across three lists, with tags on
some and a distinctive phrase buried mid-prompt in one.

1. Type that mid-prompt phrase into the filter. Expected: only that card
   remains, the columns stay in place, and each header shows `n/m`.
2. Clear the text and click two tag chips. Expected: only cards carrying
   **both** tags remain.
3. With a filter active, try to drag a card. Expected: it does not move. This
   is the guard rail — if it does move, verify `isDragDisabled` is wired.
4. Click `Clear`, then drag a card. Expected: dragging works again and lands
   correctly.
5. Quit and relaunch with a filter active. Expected: the filter is empty.

---

### Task 14: Cmd+K command palette

**Files:**
- Create: `src/renderer/components/search/CommandPalette.tsx`
- Modify: `src/renderer/components/shell/AppShell.tsx`
- Modify: `src/renderer/components/card/PromptCard.tsx`

**Interfaces:**
- Consumes: `useUiStore`, `cardMatches`, `setActiveBoard`.
- Produces: `CommandPalette` (no props).

- [ ] **Step 1: Write the palette**

Create `src/renderer/components/search/CommandPalette.tsx`.

The palette searches every board — that is its entire reason for existing
next to the filter bar. Each result shows `Board · List` so the answer to
"where is it?" arrives with the answer to "what is it?".

```tsx
import { useEffect, useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';

interface Hit {
  cardId: string;
  title: string;
  boardId: string;
  boardName: string;
  listName: string;
  tags: string[];
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);
  const setFocusCardId = useUiStore((s) => s.setFocusCardId);
  const doc = useDocStore((s) => s.doc);
  const setActiveBoard = useDocStore((s) => s.setActiveBoard);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  const hits = useMemo<Hit[]>(() => {
    if (!doc) return [];
    const collected: Hit[] = [];
    doc.boards.forEach((board) =>
      board.lists.forEach((list) =>
        list.cards.forEach((card) =>
          collected.push({
            cardId: card.id,
            title: card.title,
            boardId: board.id,
            boardName: board.name,
            listName: list.name,
            tags: card.tags,
          }),
        ),
      ),
    );
    return collected;
  }, [doc]);

  const jump = (hit: Hit) => {
    setActiveBoard(hit.boardId);
    setFocusCardId(hit.cardId);
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search all prompts" />
      <CommandList>
        <CommandEmpty>No prompts found.</CommandEmpty>
        <CommandGroup>
          {hits.map((hit) => (
            <CommandItem
              key={hit.cardId}
              // cmdk filters on `value`, so everything searchable goes here.
              // The prompt body is intentionally excluded: including whole
              // prompts makes every query match nearly everything.
              value={`${hit.title} ${hit.tags.join(' ')} ${hit.boardName} ${hit.listName}`}
              onSelect={() => jump(hit)}
            >
              <span className="flex-1 truncate">{hit.title}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {hit.boardName} &middot; {hit.listName}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
```

**On scope:** the spec says the palette matches prompt bodies too. cmdk's
`value` is a single fuzzy-matched string, and pasting entire prompts into it
makes every query match almost everything. Title, tags, board, and list are
matched here; **mid-prompt text search lives in the filter bar**, which does
match prompt bodies. Verify this trade-off feels right in Step 4 and say so if
you want the prompt body added back.

- [ ] **Step 2: Make the card respond to a jump**

In `src/renderer/components/card/PromptCard.tsx`:

1. Add imports: `import { useEffect, useRef, useState } from 'react';` and
   `import { useUiStore } from '@/store/uiStore';`
2. Inside the component:

```tsx
  const focusCardId = useUiStore((s) => s.focusCardId);
  const setFocusCardId = useUiStore((s) => s.setFocusCardId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusCardId !== cardId) return;
    scrollRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setExpanded(true);
    const timer = setTimeout(() => setFocusCardId(null), 1600);
    return () => clearTimeout(timer);
  }, [focusCardId, cardId, setFocusCardId]);
```

3. Attach `ref={scrollRef}` to the card's inner content wrapper (not the
   `Draggable` ref, which is already taken by `provided.innerRef`) and add a
   highlight ring while focused:

```tsx
        <div ref={scrollRef} className={focusCardId === cardId ? 'rounded-md ring-2 ring-ring' : undefined}>
          {/* card body */}
        </div>
```

- [ ] **Step 3: Mount the palette**

In `src/renderer/components/shell/AppShell.tsx`, import `CommandPalette` and
place `<CommandPalette />` beside `<Toaster />` in the `ready` branch.

- [ ] **Step 4: Verify the palette**

Run: `npm start`. Have at least two boards with cards on each.

1. Press `Cmd+K`. Expected: the palette opens with every prompt listed,
   each showing `Board · List`.
2. Type part of a card title from the **other** board and press Enter.
   Expected: the active board switches, the card scrolls into view, expands,
   and shows a brief highlight ring.
3. Type a tag name. Expected: cards carrying that tag are listed.
4. Press `Escape`. Expected: the palette closes.
5. Press `Cmd+K` while the cursor is in a card's prompt textarea. Expected:
   the palette still opens — this shortcut is intentionally global.

---

## Milestone 6 — Variables, undo, safety, and file management

### Task 15: Template variables

**Files:**
- Create: `src/renderer/domain/variables.ts`
- Create: `src/renderer/components/card/VariableFillDialog.tsx`
- Test: `src/__tests__/variables.test.ts`
- Modify: `src/renderer/components/card/PromptCard.tsx`
- Modify: `src/renderer/components/card/CardComposerDialog.tsx`

**Interfaces:**
- Consumes: `updateCard`, `recordCopy`, `copyText`.
- Produces:
  - `extractVariables(prompt: string): string[]` — unique names in first-appearance order
  - `substitute(prompt: string, values: Record<string, string>): string`
  - `VariableFillDialog` with props `{ open, onOpenChange, boardId, listId, cardId }`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/variables.test.ts`. These are cheap and the substitution
is what lands on your clipboard, so getting it wrong is the most annoying
possible bug.

```ts
import { extractVariables, substitute } from '../renderer/domain/variables';

describe('extractVariables', () => {
  it('finds names in first-appearance order without duplicates', () => {
    expect(
      extractVariables('Review {{file}} for {{concern}}, then {{file}} again.'),
    ).toEqual(['file', 'concern']);
  });

  it('tolerates internal whitespace', () => {
    expect(extractVariables('a {{ file }} b')).toEqual(['file']);
  });

  it('returns an empty array when there are none', () => {
    expect(extractVariables('plain prompt')).toEqual([]);
  });
});

describe('substitute', () => {
  it('replaces every occurrence', () => {
    expect(substitute('{{a}} and {{a}}', { a: 'x' })).toBe('x and x');
  });

  it('leaves a placeholder intact when no value is supplied', () => {
    expect(substitute('{{a}} {{b}}', { a: 'x' })).toBe('x {{b}}');
  });

  it('does not treat a replacement value as a pattern', () => {
    // A value containing $& would be a capture reference in String.replace.
    expect(substitute('{{a}}', { a: '$&woops' })).toBe('$&woops');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest src/__tests__/variables.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/domain/variables.ts`.

The replacer is a **function**, not a string. A string replacement would
interpret `$&`, `$1` and friends inside the user's value — so pasting a value
containing a dollar sign would silently corrupt the prompt you copy.

```ts
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

export function extractVariables(prompt: string): string[] {
  const found: string[] = [];
  for (const match of prompt.matchAll(VARIABLE_PATTERN)) {
    const name = match[1];
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

export function substitute(
  prompt: string,
  values: Record<string, string>,
): string {
  return prompt.replace(VARIABLE_PATTERN, (whole, name: string) => {
    const value = values[name];
    return value === undefined || value === '' ? whole : value;
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest src/__tests__/variables.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the fill dialog**

Create `src/renderer/components/card/VariableFillDialog.tsx`.

Values are written back to the card so the next use is prefilled — repeat
runs become Enter, Enter.

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDocStore } from '@/store/docStore';
import { extractVariables, substitute } from '@/domain/variables';
import { copyText } from '@/lib/clipboard';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  listId: string;
  cardId: string;
}

export function VariableFillDialog({
  open,
  onOpenChange,
  boardId,
  listId,
  cardId,
}: Props) {
  const card = useDocStore(
    (s) =>
      s.doc?.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId) ?? null,
  );
  const updateCard = useDocStore((s) => s.updateCard);
  const recordCopy = useDocStore((s) => s.recordCopy);

  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !card) return;
    setValues({ ...card.variables });
  }, [open, card]);

  if (!card) return null;
  const names = extractVariables(card.prompt);

  const copy = async () => {
    // substitute() returns a plain string and knows nothing about the
    // clipboard. Keep it that way: a future "run this prompt" feature
    // consumes exactly this value.
    const text = substitute(card.prompt, values);
    await copyText(text);
    updateCard(boardId, listId, cardId, { variables: values });
    recordCopy(boardId, listId, cardId);
    toast.success('Prompt copied');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{card.title}</DialogTitle>
        </DialogHeader>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void copy();
          }}
        >
          {names.map((name) => (
            <div key={name} className="flex flex-col gap-1.5">
              <Label htmlFor={`var-${name}`} className="font-mono text-xs">
                {`{{${name}}}`}
              </Label>
              <Input
                id={`var-${name}`}
                value={values[name] ?? ''}
                onChange={(event) =>
                  setValues((prev) => ({ ...prev, [name]: event.target.value }))
                }
              />
            </div>
          ))}
          <button type="submit" className="hidden" aria-hidden="true" />
        </form>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={copy}>Copy</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 6: Make the card's copy button variable-aware**

In `src/renderer/components/card/PromptCard.tsx`:

1. Add imports:

```tsx
import { extractVariables } from '@/domain/variables';
import { VariableFillDialog } from './VariableFillDialog';
```

2. Add state and the derived variable list:

```tsx
  const [filling, setFilling] = useState(false);
  const variableNames = extractVariables(card.prompt);
  const hasVariables = variableNames.length > 0;
```

3. Replace the header copy `Button` with a version whose **appearance predicts
   its behavior** — a distinct label means you are never surprised by a dialog:

```tsx
        {hasVariables ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Fill ${variableNames.length} variables and copy: ${card.title}`}
            onClick={() => setFilling(true)}
            className="h-7 shrink-0 px-1.5 font-mono text-[11px]"
          >
            {`{{${variableNames.length}}}`}
          </Button>
        ) : (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Copy prompt: ${card.title}`}
            onClick={copy}
            className="size-7 shrink-0"
          >
            <Copy className="size-3.5" />
          </Button>
        )}
```

4. Do the same for the expanded body's `Copy` button: when `hasVariables`, its
   label is `Fill & copy` and it opens the dialog.
5. Render the dialog next to `CardComposerDialog`:

```tsx
      {hasVariables ? (
        <VariableFillDialog
          open={filling}
          onOpenChange={setFilling}
          boardId={boardId}
          listId={listId}
          cardId={cardId}
        />
      ) : null}
```

- [ ] **Step 7: Show detected variables in the composer**

In `src/renderer/components/card/CardComposerDialog.tsx`, import
`extractVariables` and add this below the prompt textarea, so the syntax is
discoverable rather than documented somewhere you will not read:

```tsx
            {extractVariables(prompt).length > 0 ? (
              <p className="font-mono text-[11px] text-muted-foreground">
                Variables: {extractVariables(prompt).join(', ')}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Wrap a placeholder in double braces to make it fillable at copy
                time, e.g. {'{{file}}'}.
              </p>
            )}
```

- [ ] **Step 8: Verify the variable flow**

Run: `npm start`

1. Create a card whose prompt contains `Review {{file}} for {{concern}}.`
   Expected: the composer shows `Variables: file, concern` as you type.
2. Save. Expected: the card's copy button reads `{{2}}` rather than showing a
   copy icon.
3. Click it, fill both fields, press Enter. Expected: a "Prompt copied" toast.
   Paste elsewhere and confirm both placeholders were substituted.
4. Click `{{2}}` again. Expected: both fields are prefilled with what you
   typed last time.
5. Enter a value containing `$&` and copy. Expected: the pasted text contains
   `$&` literally. If it contains something else, the replacer is a string
   instead of a function.
6. Leave one field blank and copy. Expected: that placeholder stays as
   `{{concern}}` in the pasted text rather than becoming empty — you can see
   that you missed one.
7. Confirm a card with no braces still copies in exactly one click.

---

### Task 16: Undo and redo

**Files:**
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/components/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `commit`.
- Produces: `undo(): void`, `redo(): void`, `canUndo: boolean`, `canRedo: boolean` on the store.

> **A simplification worth noting.** The spec anticipated needing to coalesce
> text edits so typing would not create one undo step per keystroke. That
> turned out to be unnecessary: `InlineEditableText` commits only on Enter or
> blur, and `CardComposerDialog` commits only on Save. **No mutation in this
> app fires per keystroke**, so a plain snapshot stack is already correct.
> Do not add coalescing.

- [ ] **Step 1: Add history to the store**

In `src/renderer/store/docStore.ts`:

1. Add to the interface:

```ts
  past: KanbanDoc[];
  future: KanbanDoc[];
  undo: () => void;
  redo: () => void;
```

2. Add `past: [], future: []` to the initial state.
3. Add the limit constant above the store:

```ts
const MAX_HISTORY = 50;
```

4. Replace `commit` so it is the only place history is recorded. Because both
   `mutate` and `applyDrag` route through it, undo covers mis-drags for free —
   which was the whole reason for choosing snapshots.

```ts
  commit: (next) => {
    const current = get().doc;
    if (!current || current === next) return;
    set({
      doc: next,
      past: [...get().past, current].slice(-MAX_HISTORY),
      // Any new change invalidates the redo branch.
      future: [],
    });
  },
```

5. Add `undo` and `redo`. They bypass `commit` deliberately — an undo must not
   itself become an undoable step.

```ts
  undo: () => {
    const { past, doc } = get();
    const previous = past[past.length - 1];
    if (!previous || !doc) return;
    set({
      doc: previous,
      past: past.slice(0, -1),
      future: [doc, ...get().future].slice(0, MAX_HISTORY),
    });
  },

  redo: () => {
    const { future, doc } = get();
    const next = future[0];
    if (!next || !doc) return;
    set({
      doc: next,
      past: [...get().past, doc].slice(-MAX_HISTORY),
      future: future.slice(1),
    });
  },
```

6. In both `createAt` and `openAt`, add `past: [], future: []` to the `set`
   call that flips status to `ready`. Loading a different document must not
   leave you able to undo into the previous one.

- [ ] **Step 2: Bind the keyboard shortcuts**

In `src/renderer/components/shell/AppShell.tsx`, add this effect.

The input guard is not a workaround — it is the correct behavior. `Cmd+Z`
inside a text field should undo your typing, not revert a board change you
made five minutes ago.

```tsx
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'z') return;
      if (!event.metaKey && !event.ctrlKey) return;

      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;

      event.preventDefault();
      const store = useDocStore.getState();
      if (event.shiftKey) store.redo();
      else store.undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
```

- [ ] **Step 3: Verify undo across every mutation type**

Run: `npm start`

1. Drag a card to another list, then press `Cmd+Z`. Expected: it returns to
   its exact original position and index. **This is the case undo exists for.**
2. Press `Shift+Cmd+Z`. Expected: it moves back.
3. Delete a list, press `Cmd+Z`. Expected: the list returns with all its cards.
4. Rename a board, press `Cmd+Z`. Expected: the old name returns.
5. Rename a board by typing four characters and pressing Enter, then press
   `Cmd+Z` **once**. Expected: the whole rename reverts in one step — not four.
6. Click into a card's prompt textarea, type, and press `Cmd+Z`. Expected: your
   typing is undone and the board does not change.
7. Undo several steps, then make a new change, then press `Shift+Cmd+Z`.
   Expected: nothing happens — the redo branch was correctly discarded.
8. Undo back to the loaded state, wait a second, and check the file's
   modification time. Expected: the file matches what is on screen.
9. Reload the document via Settings (or relaunch). Expected: `Cmd+Z` does
   nothing — history does not survive a document switch.

---

### Task 17: External change banner

**Files:**
- Create: `src/renderer/components/shell/ExternalChangeBanner.tsx`
- Modify: `src/renderer/store/persistence.ts`
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/store/uiStore.ts`
- Modify: `src/renderer/components/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `api.data.onChanged`, `openAt`.
- Produces:
  - `writeNow(): Promise<void>` from `@/store/persistence`
  - `reload(): Promise<void>` on the doc store
  - `externalChange: boolean` and `setExternalChange(v: boolean)` on the UI store
  - `ExternalChangeBanner` (no props)

- [ ] **Step 1: Add an unconditional write to persistence**

In `src/renderer/store/persistence.ts`, add this export. It differs from
`flushPersistence` by ignoring the `savedSnapshot` equality check — "Keep
mine" must write even when the app believes disk already matches, because
disk demonstrably does not.

```ts
/**
 * Writes the in-memory document immediately, regardless of whether the app
 * thinks disk is already up to date. Used by "Keep mine", where an external
 * process has changed the file behind us.
 */
export async function writeNow(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const { doc, filePath } = useDocStore.getState();
  if (!doc || !filePath) return;
  const contents = serializeDoc(doc);
  const result = await api.data.write(filePath, contents);
  if (result.ok) {
    useDocStore.setState({ savedSnapshot: contents });
  } else {
    useDocStore.setState({
      status: { kind: 'error', message: result.error, file: filePath },
    });
  }
}
```

- [ ] **Step 2: Add `reload` to the doc store**

```ts
  reload: () => Promise<void>;
```

```ts
  reload: async () => {
    const file = get().filePath;
    if (!file) return;
    // openAt already handles parse failure, resets history, and refreshes
    // savedSnapshot. Reuse it rather than duplicating the load pipeline.
    await get().openAt(file);
  },
```

- [ ] **Step 3: Add the flag to the UI store**

Add `externalChange: boolean` (initial `false`) and
`setExternalChange: (value: boolean) => void` to `useUiStore`.

- [ ] **Step 4: Write the banner**

Create `src/renderer/components/shell/ExternalChangeBanner.tsx`.

Both buttons are explicit and neither is destructive by default. Auto-reload
would discard in-flight UI edits; auto-write would discard the external edit.

```tsx
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useDocStore } from '@/store/docStore';
import { useUiStore } from '@/store/uiStore';
import { writeNow } from '@/store/persistence';

export function ExternalChangeBanner() {
  const visible = useUiStore((s) => s.externalChange);
  const setExternalChange = useUiStore((s) => s.setExternalChange);
  const reload = useDocStore((s) => s.reload);
  const filePath = useDocStore((s) => s.filePath);

  if (!visible) return null;

  const fileName = filePath?.split('/').pop() ?? 'the data file';

  return (
    <div className="flex items-center gap-3 border-b border-border bg-accent px-4 py-2 text-sm">
      <AlertTriangle className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex-1">
        <span className="font-mono">{fileName}</span> changed on disk.
      </span>
      <Button
        size="sm"
        onClick={async () => {
          setExternalChange(false);
          await reload();
        }}
      >
        Reload from file
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={async () => {
          setExternalChange(false);
          await writeNow();
          toast.success('Kept your version');
        }}
      >
        Keep mine
      </Button>
    </div>
  );
}
```

- [ ] **Step 5: Subscribe to the change event**

In `src/renderer/components/shell/AppShell.tsx`, import
`ExternalChangeBanner`, add the subscription effect, and render the banner
above `<main>` inside the `ready` branch.

```tsx
  useEffect(() => {
    return api.data.onChanged(() => {
      useUiStore.getState().setExternalChange(true);
    });
  }, []);
```

Place the banner so it spans the full width, above the sidebar/board row:

```tsx
  return (
    <div className="flex h-full flex-col bg-background">
      <ExternalChangeBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <BoardView />
        </main>
      </div>
      <Toaster />
      <CommandPalette />
    </div>
  );
```

- [ ] **Step 6: Verify the banner and both branches**

Run: `npm start`

1. **The critical negative test first.** With the app open, rename a list and
   wait two seconds. Expected: **no banner appears.** The app's own write must
   not trip its own watcher. If a banner appears, the hash baseline is not
   being updated on write, and the feature is unusable.
2. In a terminal, hand-edit the file — change a list's name:

```bash
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/Documents/ai-kanban/kanban.json')
d = json.load(open(p))
d['boards'][0]['lists'][0]['name'] = 'Edited Externally'
json.dump(d, open(p, 'w'), indent=2)
PY
```

Expected: the banner appears within about a second.

3. Click `Reload from file`. Expected: the banner clears and the list shows
   `Edited Externally`.
4. Repeat the external edit, then click `Keep mine`. Expected: the banner
   clears, a "Kept your version" toast appears, and the file on disk now
   matches the app again:

```bash
grep 'Edited Externally' ~/Documents/ai-kanban/kanban.json
```

Expected: no match — the app's version won, as requested.

5. Externally write **invalid** JSON, then click `Reload from file`. Expected:
   the error screen appears with the parse message. Fix the file and click
   `Retry`. Expected: the board returns.

---

### Task 18: Settings dialog, file management, and menu cleanup

**Files:**
- Create: `src/renderer/components/shell/SettingsDialog.tsx`
- Modify: `src/renderer/store/docStore.ts`
- Modify: `src/renderer/components/sidebar/Sidebar.tsx`
- Modify: `src/main/menu.ts`

**Interfaces:**
- Consumes: `api.data.pickSave`, `api.data.pickOpen`, `api.data.move`, `api.data.reveal`, `api.settings.read`, `openAt`, `writeNow`.
- Produces:
  - `setFilePath(file: string): void` on the doc store
  - `SettingsDialog` with props `{ open: boolean; onOpenChange: (open: boolean) => void }`

- [ ] **Step 1: Add `setFilePath` to the doc store**

```ts
  setFilePath: (file: string) => void;
```

```ts
  setFilePath: (file) => {
    set({ filePath: file });
    void api.settings.write({ dataFilePath: file });
  },
```

- [ ] **Step 2: Write the settings dialog**

Create `src/renderer/components/shell/SettingsDialog.tsx`.

`Move data file…` and `Open a file…` are deliberately separate commands with
separate labels, because one relocates your data and the other switches which
document you are looking at. A single "change location" button that sometimes
did each would eventually look exactly like data loss.

```tsx
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { useDocStore } from '@/store/docStore';
import { writeNow } from '@/store/persistence';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  const filePath = useDocStore((s) => s.filePath);
  const setFilePath = useDocStore((s) => s.setFilePath);
  const openAt = useDocStore((s) => s.openAt);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    void api.settings.read().then((s) => setRecents(s.recentFiles));
  }, [open]);

  const move = async () => {
    if (!filePath) return;
    const target = await api.data.pickSave(filePath);
    if (!target || target === filePath) return;

    // Flush first: moving a file whose latest changes are still sitting in a
    // pending debounce would move a stale document.
    await writeNow();

    const result = await api.data.move(filePath, target);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setFilePath(target);
    toast.success('Data file moved');
  };

  const openOther = async () => {
    const target = await api.data.pickOpen();
    if (!target) return;
    await writeNow();
    await openAt(target);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Data file</h3>
          <p className="rounded-md bg-muted px-2 py-1.5 font-mono text-xs break-all">
            {filePath ?? 'None'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={move} disabled={!filePath}>
              Move data file&hellip;
            </Button>
            <Button size="sm" variant="secondary" onClick={openOther}>
              Open a file&hellip;
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => filePath && api.data.reveal(filePath)}
              disabled={!filePath}
            >
              Reveal in Finder
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Moving relocates your data and removes the old file only after the
            new one has been verified. Opening switches which file you are
            editing and leaves both on disk.
          </p>
        </section>

        {recents.filter((f) => f !== filePath).length > 0 ? (
          <section className="flex flex-col gap-1">
            <h3 className="text-sm font-medium">Recent files</h3>
            {recents
              .filter((f) => f !== filePath)
              .map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={async () => {
                    await writeNow();
                    await openAt(file);
                    onOpenChange(false);
                  }}
                  className="truncate rounded-md px-2 py-1 text-left font-mono text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {file}
                </button>
              ))}
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Wire the sidebar's settings button**

In `src/renderer/components/sidebar/Sidebar.tsx`, import `SettingsDialog`, add
`const [settingsOpen, setSettingsOpen] = useState(false);`, add
`onClick={() => setSettingsOpen(true)}` to the existing settings button, and
render the dialog before the closing `</aside>`:

```tsx
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
```

- [ ] **Step 4: Clean the boilerplate out of the application menu**

`src/main/menu.ts` still points at the upstream project. In **both**
`buildDarwinTemplate` and `buildDefaultTemplate`:

1. Delete every `Help` submenu item whose `click` handler opens an
   `electron-react-boilerplate` URL (`Learn More`, `Documentation`,
   `Community Discussions`, `Search Issues`).
2. Change the `About` / app-name menu label references from `ElectronReact` to
   `AI Kanban`.

Leave the `Edit` submenu's `undo` / `redo` roles alone. Those act on the
focused text field, which is correct — document-level undo is the renderer's
`Cmd+Z` handler from Task 16, which deliberately ignores events originating in
text fields.

- [ ] **Step 5: Verify file management**

Run: `npm start`

1. Open Settings from the sidebar. Expected: the current path is shown.
2. Click `Move data file…`, choose a new location such as
   `~/Desktop/kanban.json`. Expected: a "Data file moved" toast, and:

```bash
ls ~/Desktop/kanban.json ~/Documents/ai-kanban/kanban.json
```

Expected: the new file exists and the **old one is gone**.
3. Make a change, wait a second, and confirm it lands in the new location.
4. Click `Open a file…` and select a different JSON file (create one first by
   copying the current one elsewhere). Expected: the board switches to that
   file's contents and **both files still exist**.
5. Reopen Settings. Expected: the previous file is listed under `Recent files`.
   Click it. Expected: it opens.
6. Check the app menu. Expected: no `electron-react-boilerplate` links remain.
7. Full restart check: quit and relaunch. Expected: the app opens the last file
   used, on the last active board.

---

## Self-Review

Run against the spec after the plan is complete.

### Spec coverage

| Spec section | Covered by |
|---|---|
| 3.1 JSON format, `version: 1` | Task 2 (`serializeDoc`), Task 2 fixture |
| 3.2 Nested shape, order by index | Task 2 schema, Task 10 `applyDragEnd` |
| 3.3 Renderer owns doc, atomic write, debounce | Task 3 `dataFile.ts`, Task 5 `persistence.ts` |
| 3.4 Validation table | Task 2 `parseDoc`, Task 4 error screen |
| 3.5 External edits, hash-based self-write filter | Task 3 `watcher.ts`, Task 17 banner |
| 3.6 settings.json, first run, move vs open | Task 3 `settings.ts`, Task 4 welcome, Task 18 dialog |
| 4.1 Card fields | Task 2 schema, Task 8 `addCard` |
| 4.2 Tags: names on cards, global registry, colors | Task 12 |
| 5 Stack choices | Tasks 1, 4, 10 |
| 6.1 Accordion, monospace, max-h, modal edit | Task 9 |
| 6.2 Copy via Electron clipboard, variable-aware button | Task 9, Task 15 |
| 6.3 Modal composer, Cmd+V paste-create | Task 8, Task 9 |
| 6.4 Filter bar + Cmd+K palette | Tasks 13, 14 |
| 6.5 Undo/redo, board-delete confirm | Task 16, Task 6 |
| 6.6 Inline rename, ghost add-list, board drag, counts, theme, empty state | Tasks 6, 7, 11, 1 |
| 7 `substitute()` seam kept clean | Task 15 |
| 8 Test carve-out | Tasks 2, 10, 15 |
| 9 App identity, remove demo IPC and updater | Task 1 |

### Design calls surfaced while planning

All four were fed back into the spec, so the two documents now agree. Recorded here as rationale.

1. **Coalescing dropped (Task 16).** No mutation fires per keystroke, so a plain snapshot stack is already correct. Spec §6.5 anticipated a problem the design removed.
2. **`version > 1` shows the error screen rather than a read-only mode (Task 2/4).** A read-only mode would thread a flag through every mutation for a case that only occurs after a downgrade. The hard requirement — never write a file we do not understand — is fully met.
3. **The `Cmd+K` palette matches title, tags, board, and list, not prompt bodies (Task 14).** cmdk fuzzy-matches one string; whole prompts in it make every query match everything. Mid-prompt search is the filter bar's job, and it does search prompt bodies.
4. **Dragging is disabled while a filter is active (Task 13).** The library reports indices against rendered items, so dragging a filtered subset moves the wrong card. This is a correctness fix, not a limitation.

### Interface consistency check

`commit` is introduced in Task 11 and is the only history hook in Task 16 — Task 4's `mutate` comment is superseded there explicitly. `PromptCard` gains `index` in Task 11 and `dragDisabled` in Task 13; both are listed in those tasks' Produces blocks. `CardComposerDialog`'s props are fixed in Task 8 and unchanged afterward. Store action names used in later tasks (`setCardTags`, `recordCopy`, `applyDrag`, `reload`, `setFilePath`) are each defined in exactly one task.
