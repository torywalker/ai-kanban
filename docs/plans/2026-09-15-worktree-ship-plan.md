# Worktrees and Ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional git worktrees per card Run, plus an explicit Ship that merges the card branch into a chosen destination with a per-repo queue and in-worktree conflict turns.

**Architecture:** Renderer never shells out. Main owns `git` via `execFile`. A worktree lives under Electron `userData/worktrees/<hash(primary)>/<cardId>/` on branch `kanban/<cardId>`. Session `cwd` is that folder when worktrees are on. Ship takes a per-realpath lock, merges the destination into the worktree, optionally resumes the card session with a fixed conflict prompt (max 2), then fast-forwards the destination (working tree only if that branch is checked out).

**Tech Stack:** Electron IPC, Node `child_process.execFile` + `crypto`, Zod (document version stays 1), Zustand `docStore`, existing session daemon `reply` for conflict turns, `sonner` toasts, existing `ConfirmDialog` / a two-choice alert dialog.

**Spec:** [docs/plans/2026-09-15-worktree-ship-spec.md](./2026-09-15-worktree-ship-spec.md)

## Global Constraints

- Do **not** `git add` or `git commit`. Skip every Commit step. The user stages and commits.
- Document `version` stays **1**. New card fields use `.catch(null)`.
- Global `useWorktrees` defaults to **`false`**.
- Renderer never invokes `git`. All git is main-process.
- Integration is **merge**, never rebase. Never stash. Never `git checkout` in the primary to land a Ship.
- Worktree dirs are **outside** the project, under `userData`.
- Feature branch name is exactly `kanban/${cardId}`.
- Ship **button** label is exactly `Ship` (no branch name in the label).
- A dirty card worktree is committed deterministically before the merge (no agent turn); if it is still dirty afterwards, Ship fails without cleanup.
- Conflict-resolution prompt is the constant `SHIP_CONFLICT_PROMPT` in Task 7. Cap **2** conflict turns per Ship attempt.
- `recordedTargetBranch` is written **only when creating** a worktree, not when reusing one (so Run again does not retarget the chooser).
- Pre-existing `modelPickerOverrides.test.tsx` Radix/jsdom failures are out of scope.

---

## File map

| File | Responsibility |
|---|---|
| `src/shared/worktree.ts` | `SessionWorktree`, `resolveUseWorktree`, `featureBranchFor`, `SHIP_CONFLICT_PROMPT`, chooser types, `planShipChooser`, `truncateBranch` |
| `src/shared/schema.ts` | `Card.useWorktree`, `Card.sessionWorktree` |
| `src/shared/ipc.ts` | `Settings.useWorktrees`; `git.*` / `session.ship*` channels |
| `src/main/services/git.ts` | `execFile` wrapper; inspect branch/dirty/toplevel/ref; `mergeInProgress` |
| `src/main/services/worktree.ts` | Path under userData; add/reuse/remove/delete branch |
| `src/main/services/shipMerge.ts` | Merge destination into worktree; FF checked-out vs ref-only |
| `src/main/services/shipQueue.ts` | FIFO lock keyed by `fs.realpath` of primary |
| `src/main/services/ship.ts` | Orchestrate Ship + conflict replies + abort-then-restart leftover MERGE |
| `src/main/services/settings.ts` | Default `useWorktrees: false` |
| `src/main/services/registerIpc.ts` / `preload.ts` / `main.ts` | IPC |
| `src/renderer/store/docStore.ts` | Defaults, `useWorktrees`, persist `sessionWorktree` |
| `src/renderer/components/shell/SettingsDialog.tsx` | Global checkbox |
| `src/renderer/components/card/CardComposerDialog.tsx` | Default / Always / Never |
| `src/renderer/components/card/ShipTargetDialog.tsx` | Chooser modal |
| `src/renderer/components/card/CardViewDialog.tsx` | prepareRun cwd; Ship; helper text; queue wait |
| `src/testUtils/electronMock.ts` | Stubs |

---

### Task 1: Shared types, schema, resolve helper

**Files:**
- Create: `src/shared/worktree.ts`
- Modify: `src/shared/schema.ts`
- Modify: `src/shared/ipc.ts` (`Settings.useWorktrees`)
- Modify: `src/renderer/store/docStore.ts` (`addCard`: `useWorktree: null`, `sessionWorktree: null`)
- Modify: `src/main/services/settings.ts` (`DEFAULTS.useWorktrees: false`)
- Test: `src/__tests__/worktreeResolve.test.ts`
- Test: `src/__tests__/schema.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new
- Produces:
  - `export interface SessionWorktree { path: string; branch: string; recordedTargetBranch: string }`
  - `export const SessionWorktreeSchema` (Zod object, used by Card)
  - `export function resolveUseWorktree(card: boolean | null, global: boolean): boolean` — `card ?? global`
  - `export function featureBranchFor(cardId: string): string` — `` `kanban/${cardId}` ``
  - `export function truncateBranch(name: string, maxChars = 32): string` — if `name.length <= maxChars` return name; else first `maxChars - 1` chars + `…` (unicode ellipsis)
  - Card: `useWorktree: z.boolean().nullable().catch(null)`, `sessionWorktree: SessionWorktreeSchema.nullable().catch(null)`
  - `Settings.useWorktrees: boolean`

- [ ] **Step 1: Failing tests**

```ts
import { resolveUseWorktree, featureBranchFor, truncateBranch } from '../shared/worktree';

it('inherits the global flag when the card is null', () => {
  expect(resolveUseWorktree(null, true)).toBe(true);
  expect(resolveUseWorktree(null, false)).toBe(false);
});
it('card true/false win', () => {
  expect(resolveUseWorktree(true, false)).toBe(true);
  expect(resolveUseWorktree(false, true)).toBe(false);
});
it('names the feature branch', () => {
  expect(featureBranchFor('crd_abc123')).toBe('kanban/crd_abc123');
});
it('truncates long branch names with an ellipsis', () => {
  expect(truncateBranch('main')).toBe('main');
  expect(truncateBranch('a'.repeat(40), 32).endsWith('…')).toBe(true);
  expect(truncateBranch('a'.repeat(40), 32).length).toBe(32);
});
```

Schema: omitted `useWorktree` / `sessionWorktree` on the v1 fixture → `null`. A written `sessionWorktree` object round-trips.

- [ ] **Step 2: Implement** `src/shared/worktree.ts` + schema + settings default + `addCard` fields.

- [ ] **Step 3: Run**

`npx jest src/__tests__/worktreeResolve.test.ts src/__tests__/schema.test.ts`

Expected: PASS.

- [ ] **Step 4: Skip commit**

---

### Task 2: Git inspect helpers

**Files:**
- Create: `src/main/services/git.ts`
- Test: `src/__tests__/gitInspect.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `export type GitExecResult = { ok: true; stdout: string } | { ok: false; stderr: string; code: number | null }`
  - `export async function git(cwd: string, args: string[]): Promise<GitExecResult>` — `execFile('git', args, { cwd, encoding: 'utf8' })`. Never `shell: true`.
  - `export async function gitTopLevel(cwd: string): Promise<string | null>` — `rev-parse --show-toplevel`; null if fail
  - `export type HeadState = { kind: 'branch'; name: string } | { kind: 'detached' }`
  - `export async function gitHead(cwd: string): Promise<HeadState>` — `rev-parse --abbrev-ref HEAD`; `HEAD` → detached
  - `export async function gitIsDirty(cwd: string): Promise<boolean>` — `status --porcelain` nonempty
  - `export async function gitRefExists(cwd: string, ref: string): Promise<boolean>` — `show-ref --verify --quiet refs/heads/${ref}`
  - `export async function gitMergeInProgress(cwd: string): Promise<boolean>` — `rev-parse -q --verify MERGE_HEAD` ok

- [ ] **Step 1: Failing tests** against a temp `git init` repo (`fs.mkdtempSync`). Cover: branch name after `git checkout -b main`, dirty after writing a file, detached after `checkout --detach`, `MERGE_HEAD` after a conflicted merge of two branches.

- [ ] **Step 2: Implement** `git.ts`. On `execFile` error, `ok: false` with `stderr` and `error.code`.

- [ ] **Step 3: Run**

`npx jest src/__tests__/gitInspect.test.ts`

Expected: PASS.

- [ ] **Step 4: Skip commit**

---

### Task 3: Create, reuse, remove worktrees

**Files:**
- Create: `src/main/services/worktree.ts`
- Test: `src/__tests__/worktreeLifecycle.test.ts`

**Interfaces:**
- Consumes: `git`, `featureBranchFor`, `SessionWorktree`
- Produces:
  - `export function worktreePathFor(userDataRoot: string, primaryRoot: string, cardId: string): string` — `path.join(userDataRoot, 'worktrees', sha1(primaryRoot).slice(0, 16), cardId)`
  - `export async function ensureWorktree(opts: { userDataRoot: string; primary: string; cardId: string; existing: SessionWorktree | null }): Promise<SessionWorktree>`
    - Resolve `primaryRoot` via `gitTopLevel`. If null, throw `Working directory is not a git repository.`
    - `gitHead(primary)`: if detached, throw `Cannot start a worktree from a detached HEAD. Check out a branch first.`
    - If `existing` is set and `existing.path` exists as a directory, return `existing` **unchanged** (do not rewrite `recordedTargetBranch`).
    - Else `git worktree add -b ${featureBranchFor(cardId)} ${dest} HEAD` with `cwd: primaryRoot`. Dest = `worktreePathFor(...)`. `fs.mkdir` parent. On success return `{ path: dest, branch, recordedTargetBranch: head.name }`.
    - If add fails because the branch already exists, `git worktree add ${dest} ${branch}` (attach). `recordedTargetBranch` still current HEAD name (this is a create, not a reuse of `existing`).
  - `export async function removeWorktree(primary: string, wt: SessionWorktree): Promise<void>` — `git worktree remove --force ${wt.path}` from primary; then `git branch -D ${wt.branch}` (ignore fail if already gone).

- [ ] **Step 1: Failing tests** in a temp repo with one commit on `main`. `ensureWorktree` with `existing: null` creates a second checkout on `kanban/crd_test1` whose `HEAD` matches. Second call with that `existing` does not create another directory and keeps `recordedTargetBranch` even if primary is then on another branch (checkout `other` in primary, then ensure — recorded stays `main`). `removeWorktree` deletes the directory. Non-git folder throws the spec string. Detached HEAD throws the spec string.

- [ ] **Step 2: Implement**

- [ ] **Step 3: Run**

`npx jest src/__tests__/worktreeLifecycle.test.ts src/__tests__/gitInspect.test.ts`

Expected: PASS.

- [ ] **Step 4: Skip commit**

---

### Task 4: Ship chooser planner

**Files:**
- Modify: `src/shared/worktree.ts`
- Test: `src/__tests__/shipChooser.test.ts`

**Interfaces:**
- Consumes: `HeadState` conceptually (duplicate a small type in shared so renderer can import without Node git):

```ts
export type ShipHead = { kind: 'branch'; name: string } | { kind: 'detached' };

export type ShipChooserPlan =
  | { kind: 'direct'; destination: string }
  | { kind: 'choose'; recorded: string; current: string }
  | { kind: 'recorded-missing'; current: string }
  | { kind: 'detached-with-recorded'; recorded: string }
  | { kind: 'blocked'; message: string };

export function planShipChooser(input: {
  recorded: string;
  current: ShipHead;
  recordedExists: boolean;
}): ShipChooserPlan
```

Blocked message when detached and recorded missing: `Cannot ship: the original branch is gone and HEAD is detached.`

- [ ] **Step 1: Failing tests** for every spec §7 row (same name → direct even if you pretend history moved; different + exists → choose; recorded gone + branch current → recorded-missing; detached + recorded exists → detached-with-recorded; detached + missing → blocked).

- [ ] **Step 2: Implement** `planShipChooser` with no I/O.

- [ ] **Step 3: Run**

`npx jest src/__tests__/shipChooser.test.ts`

Expected: PASS.

- [ ] **Step 4: Skip commit**

---

### Task 5: Merge into worktree and fast-forward destination

**Files:**
- Create: `src/main/services/shipMerge.ts`
- Test: `src/__tests__/shipMerge.test.ts`

**Interfaces:**
- Consumes: `git`, `gitIsDirty`, `gitHead`, `gitMergeInProgress`
- Produces:
  - `export async function abortMergeIfNeeded(worktreePath: string): Promise<void>` — if `gitMergeInProgress`, `git merge --abort`
  - `export async function mergeDestinationIntoWorktree(worktreePath: string, destinationBranch: string): Promise<'clean' | 'conflict' | { failed: string }>` — `git merge --no-edit ${destinationBranch}`. Exit 0 → `clean`. Nonzero and `gitMergeInProgress` → `conflict`. Else `{ failed: stderr }`
  - `export async function fastForwardDestination(opts: { primary: string; destinationBranch: string; featureBranch: string }): Promise<void>`
    - Read `gitHead(primary)`.
    - If `kind === 'branch' && name === destinationBranch`: if `gitIsDirty(primary)` throw `Cannot ship into the checked-out branch while it has uncommitted changes.` Else `git merge --ff-only ${featureBranch}` (cwd primary). Nonzero → throw stderr.
    - Else: `git merge-base --is-ancestor ${destinationBranch} ${featureBranch}` must succeed. Then `git update-ref refs/heads/${destinationBranch} ${featureBranch}` (or `rev-parse` feature SHA then update-ref). Do **not** checkout. Dirty primary is allowed.

- [ ] **Step 1: Failing tests**
  - Two branches, feature is ancestor-ahead of main, checkout main clean → FF updates working tree file.
  - Destination `topic` not checked out (primary on `main`), FF updates `topic` ref; `main` working tree file unchanged.
  - Dirty main + destination main → throws the spec dirty string.
  - Dirty main + destination `topic` → succeeds (ref-only).
  - Diverged branches in worktree merge → `conflict` and `MERGE_HEAD` present.
  - `abortMergeIfNeeded` clears `MERGE_HEAD`.

- [ ] **Step 2: Implement**

- [ ] **Step 3: Run**

`npx jest src/__tests__/shipMerge.test.ts`

Expected: PASS.

- [ ] **Step 4: Skip commit**

---

### Task 6: Per-repo FIFO queue

**Files:**
- Create: `src/main/services/shipQueue.ts`
- Test: `src/__tests__/shipQueue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export interface ShipQueueEntry {
  cardId: string;
  title: string;
}

export interface ShipQueueSnapshot {
  repoKey: string;
  active: ShipQueueEntry | null;
  waiters: ShipQueueEntry[];
}

export function createShipQueue(onChange: (snap: ShipQueueSnapshot) => void): {
  enqueue(repoKey: string, entry: ShipQueueEntry, job: (signal: AbortSignal) => Promise<void>): Promise<void>;
  cancel(cardId: string): void;
  snapshotFor(repoKey: string): ShipQueueSnapshot;
  snapshotForCard(cardId: string): ShipQueueSnapshot | null;
};
```

`enqueue` returns a promise that resolves when that card’s job finishes (or rejects if the job throws). Waiters are FIFO. Only one `job` runs per `repoKey`. Each active queue item owns an `AbortController`; `cancel(cardId)` rejects a waiter with `Ship cancelled.`, or aborts an active item’s signal. Jobs must observe `signal.aborted`; Task 7's wait for an agent turn listens to this signal so an active cancellation cannot hold the lock.

`onChange` fires after every start/finish/cancel.

- [ ] **Step 1: Failing tests** with deferred jobs: second enqueue waits; order of completion is first then second; waiter cancel never runs its job; snapshots list the blocking title.

- [ ] **Step 2: Implement** a `Map<repoKey, { active, waiters: Array<{entry, resolve, reject, job, controller}> }>`; start the next waiter in `finally`, even when the prior job throws or is aborted.

- [ ] **Step 3: Run**

`npx jest src/__tests__/shipQueue.test.ts`

Expected: PASS.

- [ ] **Step 4: Skip commit**

---

### Task 7: IPC, settings wiring, Ship orchestrator

**Files:**
- Modify: `src/shared/ipc.ts` channels
- Modify: `src/main/preload.ts`
- Modify: `src/main/services/registerIpc.ts` (or `main.ts` if session handlers live there)
- Create: `src/main/services/ship.ts`
- Modify: `src/main/services/settings.ts` already has the default from Task 1
- Modify: `src/renderer/store/docStore.ts` — `useWorktrees` like `approvalMode`
- Modify: `src/testUtils/electronMock.ts`
- Test: `src/__tests__/shipOrchestrator.test.ts` (mock `sendDaemonRequest` and git via the real temp-repo helpers)

**Interfaces:**
- Consumes: Tasks 1–6, `sendDaemonRequest`, `app.getPath('userData')`
- Produces IPC:

```ts
// CHANNELS
gitEnsureWorktree: 'git:ensure-worktree'
gitRemoveWorktree: 'git:remove-worktree'
gitShipPlan: 'git:ship-plan'
gitShip: 'git:ship'
gitShipStatus: 'git:ship-status' // event
gitShipStatusGet: 'git:ship-status-get'
gitShipCancel: 'git:ship-cancel'

// git.ensureWorktree(cardId, primary, existing): IpcResult<SessionWorktree>
// git.removeWorktree(cardId, primary, worktree): IpcResult<null>
// git.shipPlan(primary, recorded): IpcResult<ShipChooserPlan>  // reads Head + ref exists
// git.ship(opts): IpcResult<null>
//   opts: { cardId, title, primary, worktree: SessionWorktree, destinationBranch: string, sessionId: string | null, approvalMode, model }
// git.shipStatusGet(cardId): ShipQueueSnapshot | null
// git.shipCancel(cardId): IpcResult<null>
```

A dirty worktree is committed deterministically by `commitAllInWorktree` (`git add -A`, `git commit --no-verify`) with the subject from `shipCommitMessage(title, cardId)` in `src/shared/worktree.ts`. No prompt, no agent turn.

`SHIP_CONFLICT_PROMPT` (export from `src/shared/worktree.ts`):

```
You are finishing a git merge in this worktree that the app started for Ship. Resolve every conflict, complete the merge with a commit, and do not push. Do not change files outside this working directory. Do not abort the merge.
```

`ship()` algorithm:
1. `repoKey = fs.realpathSync(gitTopLevel(primary))`
2. `enqueue(repoKey, { cardId, title }, async (signal) => { ... })`
3. Job body:
   - If `gitMergeInProgress(worktree.path)`, `abortMergeIfNeeded` (spec: abort then restart).
   - If `gitIsDirty(worktree.path)`, `commitAllInWorktree(worktree.path, shipCommitMessage(title, cardId))`; if still dirty afterwards throw `Could not commit the worktree for Ship. Uncommitted changes remain.`
   - `countCommitsAhead(primary, destinationBranch, worktree.branch)`; if `0` throw `Nothing to ship: this card made no commits in its worktree.` before anything destructive runs.
   - `mergeDestinationIntoWorktree`. On `failed`, throw.
   - On `conflict`: loop `attempt = 1..2`: run one agent turn with `SHIP_CONFLICT_PROMPT`, observing `signal`. Then if still merge-in-progress, continue loop. After 2 still conflicted: `abortMergeIfNeeded`, throw `Could not resolve merge conflicts automatically.`
   - On clean (or after a conflict turn that cleared MERGE_HEAD): `fastForwardDestination`. Then `removeWorktree`. Return.
4. Renderer on success clears `sessionWorktree` (orchestrator can return `{ cleared: true }` so the renderer writes the doc). **Main does not write kanban.json.**

`ensureWorktree` IPC: `app.getPath('userData')` + Task 3.

If `useWorktrees` is false, renderer will not call ensure (Task 8). Main still implements it unconditionally.

Ship status: whenever queue `onChange`, `mainWindow.webContents.send(CHANNELS.gitShipStatus, snap)`. `gitShipStatusGet(cardId)` returns `queue.snapshotForCard(cardId)` so a dialog opened after a queue event still sees its current state.

Waiting `git.ship` promises: the enqueue promise. Renderer disables via events, not by blocking the click handler beyond awaiting ship.

Cancel: `ship.ts` tracks the active card → worktree path internally. `gitShipCancel(cardId)` calls `queue.cancel(cardId)`, aborts a merge only at that main-owned path (if active), and sends session Stop; the shared abort signal must reject any active agent-turn wait so the queue advances. Never accept an abort path from renderer.

- [ ] **Step 1: Tests** for orchestrator with a real temp repo + mocked daemon: clean FF; dirty worktree committed by Ship itself (including untracked files) with no agent turn; a commit that leaves the tree dirty fails without removing the worktree; leftover MERGE aborted first; two conflict replies then abort; dirty checked-out dest throws without touching primary files; active cancel aborts an agent-turn wait and advances the queue.

- [ ] **Step 2: Implement** IPC + `ship.ts`. Conflict “wait for turn” : if mocking is too heavy, expose `waitForSessionIdle(cardId)` that tests inject. Prefer: `ship.ts` accepts `runConflictTurn: () => Promise<void>` and `isMergeInProgress` so unit tests don’t need the daemon. Production wiring in `main.ts` passes a function that `sendDaemonRequest`s reply then waits on snapshots.

Production wait: subscribe to daemon events until snapshot.status is `done` or `failed` (or 10 minute timeout → throw). Also listen to the queue-provided `AbortSignal`; abort removes the subscription, clears the timeout, and rejects with `Ship cancelled.`

- [ ] **Step 3: Run**

`npx jest src/__tests__/shipOrchestrator.test.ts src/__tests__/shipMerge.test.ts src/__tests__/shipQueue.test.ts`

Expected: PASS.

- [ ] **Step 4: Skip commit**

---

### Task 8: Renderer — settings, composer, Run cwd, Ship UI

**Files:**
- Modify: `src/renderer/components/shell/SettingsDialog.tsx`
- Modify: `src/renderer/components/card/CardComposerDialog.tsx`
- Create: `src/renderer/components/card/ShipTargetDialog.tsx`
- Modify: `src/renderer/components/card/CardViewDialog.tsx`
- Modify: `src/renderer/store/docStore.ts` (`bootstrap` / `setUseWorktrees`)
- Modify: `src/renderer/components/card/CardComposerDialog.tsx` delete path
- Test: `src/__tests__/settingsDialogWorktree.test.tsx` (or extend settings dialog tests)
- Test: `src/__tests__/cardComposerDialog.test.tsx`
- Test: `src/__tests__/cardViewDialogSession.test.tsx`

**Interfaces:**
- Consumes: `resolveUseWorktree`, `truncateBranch`, `planShipChooser` results from IPC, `api.git.*`

**Settings:** checkbox labelled `Run cards in git worktrees`. Help: `Each Run gets its own git worktree. Ship merges it back.` Bound to `useWorktrees`.

**Composer:** in Overrides, a three-button or select group: `Default (${global ? 'on' : 'off'})`, `Always`, `Never`. Store `null | true | false`. Include in save/`addCard`. Count toward `overrideCount` when non-null.

**Run:** `const primary = card.sessionRepo ?? board.defaultRepo`. `const useWt = resolveUseWorktree(card.useWorktree, useWorktrees)`. If `useWt`: `const ensured = await api.git.ensureWorktree(cardId, primary, card.sessionWorktree)`; if `!ensured.ok` reportFailure; else `updateCard(..., { sessionWorktree: ensured.value })` and `cwd = ensured.value.path`. Else `cwd = primary` as today. Then `session.run(..., cwd, ...)`. Reply uses the same resolved cwd (worktree path if `sessionWorktree` set).

**Ship visibility:** `useWt && card.sessionWorktree && snapshot && snapshot.status !== 'working' && snapshot.status !== 'waiting'`. Label `Ship`. Helper: if last `shipPlan` is `direct`, show `Merges into ${truncateBranch(destination)}` with `title={destination}`. If plan needs a choice, `You'll pick which branch to merge into.` If queue snapshot has `active` other card, disable and `Waiting to ship (behind “${active.title}”)`.

**Click Ship:** `const plan = await api.git.shipPlan(primary, recorded)`. `direct` → `go(plan.destination)`. `choose` / `recorded-missing` / `detached-with-recorded` → open `ShipTargetDialog`. `blocked` → toast `plan.message`.

`ShipTargetDialog`: title `Merge into which branch?`. Body explains recorded vs current when both exist. Buttons: `Ship into <full recorded>` (if offered), `Ship into <full current>` (if offered), Cancel. Full names, wrapping allowed.

`go(destination)`: `api.git.ship({...})`. On ok, `updateCard(..., { sessionWorktree: null })`. On error, toast.

**Delete card:** before `deleteCard`, if `sessionWorktree` `void api.git.removeWorktree(cardId, primary, sessionWorktree)` (best-effort toast). Then stop session as today.

**Stop:** call `api.git.shipCancel(cardId)` before/alongside the existing session Stop. Main cancels queued/active Ship, aborts an in-progress merge at its internally recorded worktree path, and releases the queue.

- [ ] **Step 1: Failing tests**
  - Composer: Always → saved card `useWorktree === true`; Default → `null`.
  - Settings checkbox writes `{ useWorktrees: true }`.
  - View: with `sessionWorktree` and status `done`, `getByRole('button', { name: 'Ship' })`; name is not a branch. No Ship when `sessionWorktree` null.
  - Run with global true calls `ensureWorktree` and `session.run` cwd is the returned path.
  - Run with global false does not call `ensureWorktree`.
  - Ship click with mocked `shipPlan` `choose` shows both full branch names; Cancel does not call `git.ship`. Confirm recorded calls `git.ship` with that destination.
  - Queue event disables Ship with waiting text.
  - Opening the dialog calls `shipStatusGet(cardId)` so a queue state emitted before mount is not lost.

- [ ] **Step 2: Implement UI**

- [ ] **Step 3: Run**

`npx jest src/__tests__/cardViewDialogSession.test.tsx src/__tests__/cardComposerDialog.test.tsx src/__tests__/worktreeResolve.test.ts src/__tests__/shipChooser.test.ts`

Expected: PASS. Plus any new settings test file.

- [ ] **Step 4: Skip commit**

---

## Self-review (spec coverage)

| Spec section | Task |
|---|---|
| Global setting default false, Settings checkbox | 1, 8 |
| Card override inherit/always/never | 1, 8 |
| Primary cwd, git required, detached Run fails | 3, 8 |
| userData worktree path, `kanban/<cardId>`, reuse keeps recorded | 3 |
| `sessionWorktree` persist / clear on ship | 1, 7, 8 |
| Ship button + helper, no branch on button | 8 |
| Chooser table §7 | 4, 8 |
| Merge in worktree, conflict turns cap 2, FF cases, no checkout | 5, 7 |
| Dirty worktree committed deterministically; never delete uncommitted agent edits | 5, 7 |
| Queue by realpath, waiting copy | 6, 7, 8 |
| Stop keeps worktree; delete removes; Run again reuse vs new | 3, 8 |
| Error strings | 3, 5, 7 |
| Abort leftover merge on next Ship | 5, 7 |

No rebase, stash, PR, or auto-ship.

---

## Manual check (not automated)

- Two cards Ship the same repo: second shows waiting, then runs.
- Long branch names wrap in the chooser, button stays `Ship`.
- Dirty primary while shipping into that branch refuses; shipping into another branch while dirty still FFs the other ref.
