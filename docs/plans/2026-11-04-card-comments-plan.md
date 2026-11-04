# Card Comments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user add timestamped status comments to a card from a collapsible sidebar in the card view modal, with a small count indicator on the board card.

**Architecture:** Comments are plain data on the card (`Card.comments`), written through the existing `updateCard` store action, so they ride along with undo, persistence, archive and move-to-board for free. The UI is one new `CommentsPanel` component rendered as a right-hand column inside `CardViewDialog`; its open/closed state lives in `uiStore`, collapsed by default.

**Tech Stack:** Electron, React 19, TypeScript, Zustand + immer, zod, Tailwind, Jest + Testing Library, pnpm.

**Spec:** the "Decisions" section below (agreed with the user in the design Q&A, 2026-11-04).

## Decisions (the spec)

- **Purpose:** the user's own status log for a card ("waiting to deploy until X"). Not visible to the agent, not authored by the agent. No authors, no threads.
- **Data:** `Card.comments: { id: string; text: string; createdAt: string; editedAt?: string }[]`, `.catch([])` in the schema. Document `version` does not change.
- **Order:** newest first, with the add box pinned at the top of the panel.
- **Add:** Cmd/Ctrl+Enter submits; blank or whitespace-only text is rejected. Text is trimmed.
- **Edit/delete:** inline edit per comment (sets `editedAt`, shows "edited"); hover delete button with no confirmation. Both go through `updateCard`, so undo covers them.
- **Display:** plain text with line breaks preserved (`whitespace-pre-wrap`, no markdown). Relative time ("2h ago"), full date in the `title` tooltip.
- **Sidebar:** collapsed by default. A "Comments (N)" toggle sits in the dialog's top-right button cluster, next to Expand. Open, it is a right-hand column about 280px (`w-72`) wide; the dialog widens by that amount instead of squeezing the main content. The open/closed choice is global (not per card) and remembered across cards and relaunches. Never auto-opens.
- **Board card:** `PromptCard` shows a small comment-count indicator (icon plus number) only when the count is above zero. No latest-comment preview. Comments are not searched by the command palette.
- **Archived cards** keep their comments; no cleanup.

## Global Constraints

- Work on branch `kanban/crd_habdps` in this worktree. Use `pnpm`, never `npm`. Committing is expected here.
- Verify with `pnpm exec tsc --noEmit` and `pnpm exec jest <path>`; do not launch the app to check routine changes.
- Reuse shared components (`Button`, `Textarea`, `Badge` from `@/components/ui`). The comment row and the count indicator are each a component, not inline markup repeated twice.
- Tests stub `window.electron` via `installElectronMock()` from `src/testUtils/electronMock`, as in `src/__tests__/cardViewDialogNotes.test.tsx`.
- Every place that constructs a full `Card` literal (store `addCard`, test fixtures) must gain `comments: []`; `tsc` will list them.

## Review Focus

1. Opening a data file written before this feature. Expected: cards load with `comments: []`, no error (Task 1 test).
2. A malformed `comments` value in the file. Expected: card still opens with no comments (Task 1 test).
3. Submitting blank or whitespace text. Expected: nothing is added (Task 2 test).
4. Editing a comment to blank. Expected: edit is rejected and the original text stays (Task 2 test).
5. Moving a card to another board, or archiving it. Expected: comments travel with it (Task 1 test).
6. Opening a different card with the panel open. Expected: the panel shows that card's comments and the in-progress draft does not leak across (Task 2 test).

---

### Task 1: Comments data model and board-card indicator

**Files:**
- Modify: `src/shared/schema.ts` (add `CommentSchema`, `Comment` type, `comments` on `CardSchema`)
- Modify: `src/renderer/store/docStore.ts` (add `comments: []` in the `addCard` literal near line 640-657)
- Modify: `src/renderer/components/card/PromptCard.tsx` (indicator in the badge row near line 259)
- Create: `src/renderer/components/card/CommentCount.tsx`
- Modify: any other `Card` literal `tsc` flags (fixtures)
- Test: `src/__tests__/cardComments.test.tsx`

**Interfaces:**
- Consumes: `newId` from `@/domain/ids` (not needed here), `useDocStore.addCard/updateCard/moveCardToBoard`.
- Produces:
  - `CommentSchema = z.object({ id: z.string(), text: z.string(), createdAt: z.string(), editedAt: z.string().optional() })`; `type Comment = z.infer<typeof CommentSchema>` exported from `src/shared/schema.ts`.
  - `Card.comments: Comment[]`.
  - `CommentCount({ count }: { count: number }): JSX.Element | null`, which renders nothing when `count` is 0, otherwise a `MessageSquare` icon (lucide-react) and the number, with `aria-label={`${count} comments`}`.

- [ ] **Step 1: Write the failing tests** in `src/__tests__/cardComments.test.tsx`:
  - `'parses a card without comments as an empty list'`: `CardSchema.parse` on a card object lacking `comments` gives `comments` equal to `[]`.
  - `'a malformed comments value falls back to an empty list'`: `comments: 'oops'` gives `[]`.
  - `'comments survive moving a card to another board'`: add a card, `updateCard(..., { comments: [c] })`, `moveCardToBoard`, assert the moved card's `comments` equals `[c]`.
  - `'PromptCard shows a count only when there are comments'`: render `PromptCard` for a card with 0 comments, expect `queryByLabelText(/comments/)` to be null; with 2, expect `getByLabelText('2 comments')`.
- [ ] **Step 2: Run to verify failure:** `pnpm exec jest src/__tests__/cardComments.test.tsx`. Expected: FAIL (`comments` / `CommentCount` do not exist).
- [ ] **Step 3: Implement** the schema change and `comments: []` in `addCard`; create `CommentCount` and render it in `PromptCard`'s badge row (`flex flex-wrap items-center gap-1`), passing `card.comments.length`. Style it like the neighbouring muted badges (`text-[11px] text-muted-foreground`). Fix every `tsc`-flagged `Card` literal.
- [ ] **Step 4: Verify:** `pnpm exec tsc --noEmit && pnpm exec jest src/__tests__/cardComments.test.tsx`. Expected: both pass.
- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: card comments data model and board-card count"
```

---

### Task 2: Comments sidebar in the card view modal

**Files:**
- Create: `src/renderer/components/card/CommentsPanel.tsx` (panel: add box plus list)
- Create: `src/renderer/components/card/CommentItem.tsx` (one comment: relative time, inline edit, delete)
- Create: `src/renderer/lib/relativeTime.ts`
- Modify: `src/renderer/store/uiStore.ts` (open/closed preference)
- Modify: `src/renderer/components/card/CardViewDialog.tsx` (toggle button, layout, widening)
- Test: `src/__tests__/cardViewDialogComments.test.tsx`, `src/__tests__/relativeTime.test.ts`

**Interfaces:**
- Consumes: `Comment`, `Card.comments` (Task 1); `useDocStore.updateCard(boardId, listId, cardId, patch)`; `newId` from `@/domain/ids` (use prefix `'cmt'`); `CommentCount` is not needed here.
- Produces:
  - `relativeTime(iso: string, now?: Date): string`: "just now" under 1 minute, then "Nm ago", "Nh ago", "Nd ago", and for 30+ days a locale date (`toLocaleDateString`). Backed by no library.
  - `uiStore`: `commentsOpen: boolean` and `setCommentsOpen: (open: boolean) => void`. Initial value reads `localStorage['ai-kanban.commentsOpen'] === 'true'` and the setter writes it, both inside `try/catch` so a blocked or missing storage leaves it `false` and never throws.
  - `CommentsPanel({ boardId, listId, cardId }: { boardId: string; listId: string; cardId: string })`: reads the card's `comments` from `useDocStore`, renders the add `Textarea` (placeholder "Add a comment…", Cmd/Ctrl+Enter submits) above the newest-first list, and writes via `updateCard`. Fixed width `w-72`, left border, `min-h-0` with its own `overflow-y-auto` list so it scrolls independently of the dialog body.
  - `CommentItem({ comment, onEdit, onDelete }: { comment: Comment; onEdit: (text: string) => void; onDelete: () => void })`: shows `whitespace-pre-wrap` text, `relativeTime(createdAt)` with `title={new Date(createdAt).toLocaleString()}`, an "edited" marker when `editedAt` is set, an edit button, and a delete button revealed on hover/focus (`group-hover` plus `focus-within`). Edit swaps in a `Textarea`; Enter-less: Cmd/Ctrl+Enter saves, Esc cancels, blank is rejected (keeps original).

- [ ] **Step 1: Write the failing tests.**
  - `relativeTime.test.ts`: `'45s'` gives `'just now'`; 5 minutes gives `'5m ago'`; 3 hours gives `'3h ago'`; 2 days gives `'2d ago'` (pass an explicit `now`).
  - `cardViewDialogComments.test.tsx` (mirror the setup of `cardViewDialogNotes.test.tsx`):
    - `'comments panel is collapsed by default and the toggle shows the count'`: card with 2 comments, expect `getByRole('button', { name: /comments \(2\)/i })` and `queryByPlaceholderText('Add a comment…')` null.
    - `'opening the panel lists comments newest first'`: click the toggle; the older comment's text appears after the newer one in document order.
    - `'Cmd+Enter adds a trimmed comment and clears the box'`: type `'  waiting on deploy  '`, `userEvent.keyboard('{Meta>}{Enter}{/Meta}')`; store card has one comment with `text === 'waiting on deploy'` and a `createdAt`; textarea is empty.
    - `'blank comment is not added'`: whitespace only plus submit leaves `comments` empty.
    - `'editing a comment saves text and marks it edited'`; `'editing to blank keeps the original'`.
    - `'deleting a comment removes it'` (hover not required; the button is in the DOM, visually hidden until hover).
    - `'the open preference is shared across cards'`: set `commentsOpen` in `uiStore`, render a different card, panel is open.
    - `'switching cards clears the draft'`: type a draft, re-render with another `cardId`, textarea is empty (give `CommentsPanel` `key={cardId}` in the dialog).
- [ ] **Step 2: Run to verify failure:** `pnpm exec jest src/__tests__/relativeTime.test.ts src/__tests__/cardViewDialogComments.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `relativeTime`, the `uiStore` fields, `CommentItem` and `CommentsPanel` per the interfaces above.
- [ ] **Step 4: Integrate into `CardViewDialog.tsx`.**
  - Add a ghost `Button` (`size="icon-sm"`, `MessageSquare` icon plus count) absolutely positioned at `top-3.5 right-[4.5rem]`, left of Expand; `aria-label={`Comments (${card.comments.length})`}`, `aria-expanded={commentsOpen}`, toggling `setCommentsOpen`. Widen the header's `pr-16` to `pr-28` so the title clears the third button.
  - Make `DialogContent` a row: wrap the existing header, body and footer in one `div.flex.min-h-0.min-w-0.flex-1.flex-col.gap-4` (keeping their `shrink-0`/scroll behavior unchanged) and render `<CommentsPanel key={cardId} .../>` as its sibling only when `commentsOpen`. The absolutely positioned buttons stay relative to `DialogContent`.
  - Widen only when the panel is open: append `sm:max-w-[calc(42rem+18rem)]` for the collapsed size (`sm:max-w-2xl` + `w-72`); the expanded size (`92vw`) is unchanged because the panel takes its share from it. Compute this in the `sizedDialog` expression near line 461-466.
  - Confirm the existing dialog tests still pass; the layout wrapper must not change what they query.
- [ ] **Step 5: Verify:** `pnpm exec tsc --noEmit && pnpm exec jest src/__tests__/relativeTime.test.ts src/__tests__/cardViewDialogComments.test.tsx src/__tests__/cardViewDialogNotes.test.tsx src/__tests__/cardViewDialogExpand.test.tsx src/__tests__/cardViewDialogTerminal.test.tsx`. Expected: all pass. Then run the whole suite once: `pnpm exec jest`.
- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: comments sidebar in the card view modal"
```
