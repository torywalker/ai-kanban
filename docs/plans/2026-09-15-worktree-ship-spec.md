# AI Kanban — Worktrees and Ship Design Spec

**Date:** 2026-09-15
**Status:** Agreed (resolved via design interview)
**Base specs:** [2026-09-04-ai-kanban-spec.md](./2026-09-04-ai-kanban-spec.md), [2026-09-09-ai-kanban-agent-sessions-spec.md](./2026-09-09-ai-kanban-agent-sessions-spec.md)

## 1. Purpose

Let several cards on one board (one git repo) run at the same time without sharing a dirty working tree. When the user is ready, **Ship** lands that card’s commits on a chosen branch in the real checkout. Merge conflicts are resolved by the same card’s agent **inside its worktree**, never by writing conflict markers into the folder the user has open.

## 2. Non-goals

- Rebase. Integration is always `git merge`.
- Stashing, forcing, or otherwise mutating a dirty primary checkout to make Ship succeed.
- Opening a GitHub PR, pushing, or talking to a remote beyond whatever local refs already exist.
- Coordinating ports, Docker, or local databases across worktrees.
- Per-file leases or agent-to-agent messaging.
- Auto-Ship when a session goes idle.
- Putting a branch name on the Ship **button** (names are often long). Branch names appear in copy around the button, tooltips, and the chooser dialog.

## 3. Settings

### 3.1 Global (app `settings.json`)

`useWorktrees: boolean`, default **`false`**. Opt-in so existing boards keep today’s “run in the repo folder” behavior until the user turns this on.

Settings UI: a checkbox, e.g. **Run cards in git worktrees**. Short help: each Run gets its own branch and folder; Ship merges it back.

### 3.2 Card override (document)

`Card.useWorktree: boolean | null` with Zod `.catch(null)`.

| Value | Meaning |
|---|---|
| `null` | Inherit the global setting |
| `true` | Always use a worktree for this card |
| `false` | Never use a worktree for this card |

Composer: three-way control (Default / Always / Never). Default shows the current global value in secondary text (`Default (on)` / `Default (off)`). Document `version` stays **1**.

**Resolved worktree mode** for a Run: card override if non-null, else global `useWorktrees`.

## 4. Where the agent runs

Working directory for a session is still `card.sessionRepo ?? board.defaultRepo`. Call that the **primary repo**. Run stays disabled if neither is set, or if that path is missing.

If resolved worktree mode is **off**: `cwd` is the primary repo, unchanged from today. No worktree, no Ship.

If resolved worktree mode is **on**:

- Primary must be a git working tree (`git rev-parse --show-toplevel` succeeds). Otherwise Run fails with a clear error; do not fall back to running in the primary folder.
- On Run, if this card has no live worktree from an unshipped run: `git worktree add -b kanban/<cardId> <path> HEAD` (branch from current `HEAD` of the primary).
- If this card already has an unshipped worktree (Stop, app restart, or Run again before Ship): **reuse** it. Do not create a second worktree.
- Session `cwd` is the worktree path, not the primary.
- Record at Run (see §5): worktree path, feature branch name, and the primary’s current branch name (**recorded target**).

Worktree directories live **outside** the project, under Electron `userData`, e.g. `worktrees/<stable-hash-of-primary-root>/<cardId>/`, so other agents and the user’s tree do not see them as source files.

## 5. Data that must persist

Live session transcript stays out of `kanban.json` (sessions spec §4).

Worktree identity **does** persist so Ship still works after a restart:

```
sessionWorktree: {
  path: string;                 // absolute worktree directory
  branch: string;               // e.g. kanban/crd_xxxxxx
  recordedTargetBranch: string; // primary’s branch name at last Run that created/reused this worktree
} | null
```

Zod `.catch(null)`. Cleared when the worktree is removed (successful Ship, delete card, or explicit cleanup).

`recordedTargetBranch` is **not** updated when the user later checks out a different branch in the primary. That mismatch is what triggers the chooser in §7.

If at Run the primary is detached `HEAD`, do not create a worktree; fail Run with an explanation (there is no branch name to record).

## 6. Ship control (UI)

Show **Ship** in the card view footer (session controls) when all of:

- Resolved worktree mode is on **and** `sessionWorktree` is set.
- At least one session turn on this card has finished (status is not `working` / `waiting`). `failed` still allows Ship if the worktree exists — the user decides whether the commits are worth landing.
- The card is not currently in a Ship/conflict-resolution turn (disable and show status instead).

The button label is exactly **Ship**. Do not put a branch name in the label.

Nearby helper text (not the button) names the destination when it is unambiguous, and may truncate with an ellipsis plus `title`/tooltip for the full name. When the chooser will be required, helper text says the destination needs a choice (no long branch name required on that line).

Queue: if this card is waiting behind another Ship on the same primary repo, disable Ship and show **Waiting to ship** plus the blocking card’s title.

## 7. Choosing the destination branch

**Primary** = the same folder as §4 (`sessionRepo ?? defaultRepo`).

At Ship click, read the primary’s current branch (`git rev-parse --abbrev-ref HEAD`).

| Situation | Behavior |
|---|---|
| Current branch equals `recordedTargetBranch` | No dialog. Destination is that branch. (New commits on the same branch, e.g. a pull, do **not** open the chooser.) |
| Current is a different branch, and `recordedTargetBranch` still exists as a local ref | Modal: Ship into **\<recorded\>**, Ship into **\<current\>**, Cancel. Full names in the modal. Cancel does nothing. |
| `recordedTargetBranch` is gone; current is a normal branch | Modal explains the original branch is missing; only **current** and Cancel. |
| Current is detached `HEAD` | Do not offer “current.” If recorded still exists, only that option + Cancel; else disable with an explanation. |
| Cancel | Worktree unchanged; queue slot not held beyond the dialog. |

After a choice (or the no-dialog path), destination branch is fixed for **this** Ship attempt.

## 8. Merge recipe (once destination is known)

Git runs in the **main process**. The renderer never shells out.

Take the **per-repo lock** first (§9). Hold it until this attempt succeeds, fails, or is aborted.

1. If the worktree has uncommitted changes, commit them **deterministically**: `git add -A` then `git commit --no-verify` with a message built from the card title. No agent turn — Ship takes everything in the worktree, tracked and untracked alike, so a successful Ship can never delete edits the model chose not to commit. Hooks are skipped because a hook that reformats or rejects the snapshot would strand the work. If the tree is somehow still dirty afterwards, fail Ship without removing the worktree.
2. Refuse early if the card branch adds nothing: `git rev-list --count <destination>..<feature-branch>` must be greater than zero. `git merge --ff-only` reports a branch that is merely behind as the success “Already up to date.”, so without this check a card whose agent never committed anything would report a successful Ship, delete its worktree, and land nothing. Checked **after** the commit in step 1, so a card whose only work is uncommitted still ships.
3. In the **worktree only**: `git merge <destination-branch>` (local ref). Do not touch the primary yet.
4. If that merge conflicts: leave it in progress **in the worktree**. Start a **conflict-resolution turn** on this card’s session with `cwd` = worktree (resume the existing SDK session when possible). Fixed prompt: resolve the in-progress git merge, commit, do not push, do not touch files outside this worktree. Cap **two** such turns per Ship attempt. After each turn, if the merge is still in progress or the tree is still conflicted, retry until the cap; then `git merge --abort` in the worktree, surface the error, drop the lock, leave Ship available.
5. If the worktree merge is clean, **fast-forward the destination ref** to the feature branch. Two cases:
   - Destination **is** the primary’s checked-out branch: refuse if the primary working tree is dirty (do not stash). Then `git merge --ff-only <feature-branch>` in the primary so the open folder updates.
   - Destination **is not** checked out: do **not** `git checkout` in the primary. Fast-forward that branch’s ref only (`merge-base` ancestor check, then update the ref). The user’s open folder stays on whatever branch they had.
6. On success: `git worktree remove`, delete the fully merged feature branch, clear `sessionWorktree`, drop the lock. Keep `sessionId` and the transcript.
7. Conflict markers must never appear in the primary. The only primary working-tree change is the `--ff-only` when destination is the checked-out branch.

If the FF fails (destination moved, dirty checkout when landing on the current branch): error; the worktree may already contain the merge from destination. Leave it; the user can Ship again.

## 9. Queue

Key: **realpath of the primary repo**, not board id (two boards can share a folder).

One active Ship (including conflict-resolution turns) per key. Further Ship clicks enqueue FIFO. Waiting cards show **Waiting to ship** as in §6.

Each queued or active Ship owns a cancellation signal. Stop on a card that is mid-Ship aborts that signal, aborts a merge in its worktree if one is in progress, cancels its queue entry, and releases the lock so the next waiter can proceed. Waiting for an agent turn must observe the same signal, so Stop cannot leave the queue blocked.

App quit: in-memory queue is lost; a worktree with a merge in progress stays on disk. Next Ship on that card detects it and either continues or `merge --abort` then starts clean — prefer **abort then restart** the recipe so we do not resume a half-applied merge from a previous app lifetime without the user clicking Ship again.

## 10. Stop, delete, Run again

- **Stop**: ends the daemon session as today. Does **not** remove the worktree (uncommitted/unshipped work stays).
- **Delete card**: stop live session, then `git worktree remove` (force if needed) and delete the feature branch if it exists and is unused elsewhere. Best-effort; failures toast, card still deletes.
- **Run again** with an unshipped worktree: new session, same worktree/`cwd`.
- **Run again** after a successful Ship (`sessionWorktree` null): create a new worktree from current primary `HEAD`, new recorded target.

## 11. Errors (user-facing)

| Case | Handling |
|---|---|
| Primary not a git repo | Run fails; do not start a session |
| Detached `HEAD` at Run | Run fails |
| Dirty primary at Ship into the **checked-out** branch | Ship fails; lock released. Dirty tree is allowed when destination is a different branch (ref-only FF). |
| The worktree commit fails or leaves the tree dirty | Ship fails with git’s stderr; worktree and branch remain for another attempt |
| Card branch adds no commits to the destination | Ship fails with “Nothing to ship…”; worktree and branch remain untouched |
| Worktree path missing | Clear `sessionWorktree`; toast; no Ship |
| `git worktree add` / `remove` fails | Toast with git’s stderr (no need to redact — these are local paths the user already chose as the repo) |
| Conflict turns exhausted | Abort merge in worktree; toast; Ship remains |
| Queue wait | UI only; no error |

## 12. Testing

Pure git helpers (recorded vs current branch, chooser cases, lock FIFO, FF-only vs dirty tree) are unit-tested against temp repos. Daemon conflict turns use the existing mocked SDK. No test requires a live model.

Manual: two cards Ship on the same repo; dirty primary; long branch names in the chooser; inherit vs Always vs Never.

## 13. Out of scope leftovers

Shared local services (ports, Docker) can still clash. That is accepted.
