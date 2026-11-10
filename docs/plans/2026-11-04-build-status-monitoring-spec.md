# Build status monitoring — spec

Goal: each card shows the CI status of its work, and the user is notified when a step fails or the build finishes, without watching GitHub.

## Sources of status (per card)

Precedence: **PR checks > ship-target push runs > none**.

1. **PR checks.** Auto-detect from the card's worktree branch (`gh pr list --head <branch>`), with a manual PR URL override persisted on the card. Status from `gh pr view --json number,url,state,statusCheckRollup`. Covers `CheckRun` and legacy `StatusContext` entries.
2. **Ship-target push runs.** When ship merges locally into `sessionWorktree.recordedTargetBranch`, record the merge SHA on the card. Each poll:
   - `git fetch origin <target>`; `git merge-base --is-ancestor <sha> origin/<target>`.
   - Not ancestor: state `shipped-unpushed` (amber, no notification).
   - Ancestor: `gh run list --branch <target> --json databaseId,headSha,status,conclusion,name,url`; track the **earliest** run whose `headSha` contains the merge SHA (ancestry checked locally), so later pushes by others never turn this card red.
   - No matching run within 2 min of the push being detected: state `no-builds`, stop polling that card, no notification. An open PR appearing later takes over via precedence.

The target branch is always the card's recorded target, never hardcoded.

## Polling (main process, `gh` only)

- ~30s while any check is queued/in progress; 5 min once settled; stop on PR merged/closed.
- Cards with a pushed branch and no PR: re-check for a PR every ~2 min; skip archived/done cards and unpushed branches.
- Transient failures: keep last status, mark stale, exponential backoff capped at 5 min.
- Auth/install failure (`gh auth status`): pause all polling, show one global banner (pattern of `ExternalChangeBanner`) with retry; resume on retry or window focus. Errors never render as red build failures.

## State

In memory in the main process: `cardId -> { source, prUrl?, runs[], rollup, lastSha, notifiedKeys }`, pushed to the renderer over IPC. Persisted on the card only: manual PR URL override and the ship merge SHA. After restart, re-poll; a still-failing PR may re-notify once (accepted).

## Notifications (existing `notifications.ts`)

macOS notification on the **first failed check** and on the **final all-passed** result. Dedupe key = `cardId + checkName + sha`; a new push or re-run resets it. Intermediate transitions only update the badge.

## UI

Compact badge on the card face (reuse `SessionStatusBadge` conventions): running (n/total), passed, failed (n failing), shipped-unpushed, no-builds, unknown/stale. Click opens the PR (or run URL) in the browser. Hover tooltip lists failing step names. No dialog section, no board-wide filter in v1.

## Out of scope

Per-step timeline/durations, board-wide failing-build filter, detecting manual terminal merges not made via ship, webhooks.

## Open risks

- Ancestry check needs the run's `headSha` commits fetched locally; fetch the target branch each poll.
- `gh` calls per active card per 30s; watch rate limits with many open PRs.
- Ship flow change (record merge SHA) touches `ship.ts` / `shipMerge.ts`; needs tests there.
