# General Terminals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-board "general" terminals (plain login shells for `git`, `terraform`, anything) in a tabbed modal opened from a top-bar button next to Scratchpad or with CMD+T.

**Architecture:** The session daemon gets a small `shellHost` that owns one node-pty per terminal id, separate from the Claude-specific `terminalHost`. Shells outlive the modal, so closing it only hides it, and reopening replays scrollback. The renderer reuses `TerminalPanel` and the existing `terminal:data` / `terminal:replay` / input / resize / attach / close plumbing, keyed by the shell's id. Tab metadata (id + name) is persisted on each board in the document.

**Tech Stack:** Electron, React 19, TypeScript, Zustand + immer, zod, node-pty, @xterm/xterm, Jest + Testing Library, pnpm.

**Spec:** the "Decisions" section below (agreed with the user in the design Q&A, 2026-11-03).

## Decisions (the spec)

- **Lifetime:** shells live in the daemon. Hiding the modal never kills a shell. Reopening replays the ring buffer. A shell that dies with the daemon is respawned fresh on next open. Typing `exit` respawns a fresh shell in the same tab.
- **Scope and cwd:** terminals are per board. A shell starts in the board's `defaultRepo`, falling back to the home directory when it is null or missing. Every new tab starts there, not in another tab's last directory.
- **Tabs:** the modal always has at least one tab. A board's first open creates "Terminal 1". New tabs are "Terminal N". Double-click a tab title to rename inline (Enter saves, Esc cancels, blank is rejected). Each tab has an `×`. Closing a tab whose shell has a foreground process asks for confirmation; an idle shell closes immediately. Closing the last tab replaces it with a fresh "Terminal 1".
- **Shortcuts:** ⌘T opens the modal when closed, and adds a tab when already open. While open: ⌘W closes the active tab, ⌘⇧W hides the modal, ⌘1–⌘9 jump to a tab. Esc is sent to the shell (vim, less, fzf). Clicking outside does not close the modal.
- **Shell:** the user's `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` elsewhere) as a login shell (`-l`), `TERM=xterm-256color`, `COLORTERM=truecolor`.
- **Exempt from idle auto-kill.** Live shells count toward the daemon's `activeTurns` so a dev rebuild does not evict a daemon that holds running commands.
- **Button:** "Terminals" with a `SquareTerminal` icon, right after "Scratchpad" in the board header.

## Global Constraints

- Work on branch `kanban/crd_5jhdju` in this worktree. Use `pnpm`, never `npm`. Committing is expected here.
- Document `version` stays `1`. The new `Board.terminals` field uses `.catch([])` so older files still open.
- Reuse `TerminalPanel` and the existing terminal IPC channels. Do not fork the xterm setup.
- Per project memory: verify with `pnpm exec tsc --noEmit` and `pnpm exec jest`, never by launching the app.
- Tests stub `window.electron` after imports, and components guard `window.electron?.terminal` because existing mocks lack it.
- The shared `Dialog` component must be reused. Extract the tab bar as its own component rather than inline markup.
- `AppShell`'s global shortcuts skip while any `[role="dialog"]` is open, so the dialog's own shortcuts live in the dialog.

## Review Focus

1. A user types `exit` in a shell. Expected: the tab gets a fresh shell, not a dead pane (Task 3 test).
2. The board has no `defaultRepo`, or it was deleted. Expected: shell opens in the home directory, not an error (Task 1 test).
3. Live shells exist while the daemon is rebuilt in dev. Expected: they count in `activeTurns` so the daemon is not evicted (Task 1 test).
4. ⌘T pressed twice quickly. Expected: two tabs with distinct ids and names (Task 2 test).
5. Rename to blank or whitespace, or a very long name. Expected: blank keeps the old name; a long name truncates in the tab (Task 2 and 3 tests).
6. Active board changes while the modal is open. Expected: the tab bar shows the new board's tabs and starts their shells (Task 3 test).

---

### Task 1: Daemon shell host and bridge

**Files:**
- Create: `src/main/daemon/shellHost.ts`
- Modify: `src/shared/daemonProtocol.ts`, `src/shared/ipc.ts`, `src/main/daemon/index.ts`, `src/main/main.ts`, `src/main/preload.ts`, `src/renderer/preload.d.ts` (only if it declares the bridge by hand)
- Test: `src/__tests__/shellHost.test.ts`

**Interfaces:**
- Consumes: `PtyLike`, `defaultShell`, `appendCapped` (from `terminalHost.ts` / `terminalLaunch.ts` / `terminalHooks.ts`).
- Produces:
  - `ShellStartRequest = { op: 'shellStart'; id: string; cwd: string; cols: number; rows: number }`, added to `DaemonRequest`.
  - `DaemonEvent` gains `{ event: 'shellState'; id: string; alive: boolean; busy: boolean }`.
  - `CHANNELS.shellStart = 'shell:start'` and `CHANNELS.shellState = 'shell:state'`.
  - Preload: `terminal.startShell(req: Omit<ShellStartRequest, 'op'>): Promise<void>` and `terminal.onShellState(cb: (id: string, alive: boolean, busy: boolean) => void): () => void`.
  - `createShellHost(deps: ShellHostDeps): ShellHost` with `start(req)`, `has(id): boolean`, `input(id, data)`, `resize(id, cols, rows)`, `close(id)`, `attach(id)`, `openCount(): number`, `dispose()`.
  - `ShellHostDeps = { spawnPty: (file, args, opts) => ShellPtyLike; platform: string; envShell: string | undefined; baseEnv: Record<string, string | undefined>; homedir: string; publishEvent: (e: DaemonEvent) => void }`, where `ShellPtyLike = PtyLike & { readonly process: string }`.

- [ ] **Step 1: Write the failing tests** in `shellHost.test.ts` with a fake pty (settable `process`, capturable `onData`/`onExit`), using jest fake timers:
  - `start spawns the login shell in the cwd`: file is the `envShell`, args equal `['-l']`, opts `cwd` equals the request's cwd, env has `TERM: 'xterm-256color'` and `COLORTERM: 'truecolor'`.
  - `falls back to the home directory when the cwd is empty or missing`: `cwd: ''` and a nonexistent path both spawn with `cwd === homedir`.
  - `start is idempotent`: a second `start` with the same id does not spawn again.
  - `publishes shellState busy when the foreground process is not the shell`: set `pty.process = 'terraform'`, advance 500 ms, expect `{event:'shellState', id, alive:true, busy:true}` exactly once; set it back to `zsh` (also `-zsh`), expect `busy:false`.
  - `exit publishes alive false and forgets the shell`: `has(id)` is false and `openCount()` is 0 afterwards.
  - `attach replays buffered output`: after two `onData` chunks, `attach(id)` publishes `terminalReplay` with their concatenation. Output for a live shell is published as `terminalData`.
  - `input and resize reach the pty, and are ignored for unknown ids`.
  - `openCount counts live shells`.
- [ ] **Step 2: Run to verify failure.** `pnpm exec jest src/__tests__/shellHost.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `shellHost.ts`.** One `Map<string, Shell>` of `{ pty, buffer, busy, timer }`. Poll `pty.process` every 500 ms. `busy` is true when its basename, with any leading `-` stripped, differs from the shell's basename. Cap the buffer with `appendCapped`. Never touch the Claude hook or usage machinery.
- [ ] **Step 4: Add the protocol types and channels** (`daemonProtocol.ts`, `ipc.ts`) exactly as in Interfaces.
- [ ] **Step 5: Wire the daemon** in `daemon/index.ts`. Create `shellHost` beside `terminalHost`, using the same lazy `node-pty` require and `os.homedir()`. Add `case 'shellStart'`. In `terminalInput` / `terminalResize` / `terminalClose` / `terminalAttach`, route to `shellHost` when `shellHost.has(request.cardId)`, otherwise `terminalHost`. Add `shellHost.openCount()` to `activeTurns`, and call `shellHost.dispose()` in the SIGTERM handler. Broadcast shell events with the same `broadcast` the terminal host uses.
- [ ] **Step 6: Wire main and preload.** `ipcMain.handle(CHANNELS.shellStart, …)` forwards `{...req, op:'shellStart'}` through `sendDaemonRequest`. The daemon-event switch in `main.ts` forwards `shellState` to `CHANNELS.shellState`. Add `startShell` and `onShellState` to the preload `terminal` object, following `onData`.
- [ ] **Step 7: Verify.** `pnpm exec jest src/__tests__/shellHost.test.ts src/__tests__/terminalHost.test.ts` passes, and `pnpm exec tsc --noEmit` is clean.
- [ ] **Step 8: Commit.** `git add -A && git commit -m "feat: daemon shell host for general terminals"`

---

### Task 2: Board persistence and store actions

**Files:**
- Modify: `src/shared/schema.ts`, `src/renderer/store/docStore.ts`, `src/renderer/store/uiStore.ts`, `src/renderer/domain/seed.ts`, plus every `Board` literal that `tsc` flags (board creation in `docStore.ts`, test fixtures)
- Test: `src/__tests__/boardTerminals.test.ts`, extend `src/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: the existing `setBoardScratchpad` pattern in `docStore.ts` (immer `produce`, early return when unchanged).
- Produces:
  - `Board.terminals: { id: string; name: string }[]` (zod `BoardTerminalSchema`, field `.catch([])`).
  - `docStore.addBoardTerminal(boardId: string): string` returns the new tab's id. The name is `Terminal N`, with N the lowest positive integer not already used as `Terminal N` on that board. The id is unique even for two calls in the same tick.
  - `docStore.renameBoardTerminal(boardId: string, id: string, name: string): void` trims the name and ignores a blank result.
  - `docStore.removeBoardTerminal(boardId: string, id: string): void`. Removing the only tab leaves one fresh `Terminal 1` with a new id.
  - `uiStore.terminalsOpen: boolean` and `uiStore.setTerminalsOpen(open: boolean): void`.

- [ ] **Step 1: Write the failing tests.**
  - `schema.test.ts`: a board object without `terminals` parses to `terminals: []`.
  - `boardTerminals.test.ts`:
    - `addBoardTerminal names tabs Terminal 1, Terminal 2`.
    - `two rapid adds get distinct ids and names`.
    - `reuses the lowest free number after a removal` (remove "Terminal 1" of two, the next add is "Terminal 1").
    - `rename trims and persists`, `rename to blank or whitespace keeps the old name`.
    - `remove keeps the order of the remaining tabs`.
    - `removing the only tab leaves a fresh Terminal 1 with a different id`.
    - `actions on an unknown board are no-ops`.
- [ ] **Step 2: Run to verify failure.** `pnpm exec jest src/__tests__/boardTerminals.test.ts src/__tests__/schema.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the schema field and the three docStore actions** per Interfaces. Use the id generator `docStore` already uses for cards and boards.
- [ ] **Step 4: Add `terminalsOpen` / `setTerminalsOpen` to `uiStore`**, next to `scratchpadOpen`.
- [ ] **Step 5: Fix compile errors.** `pnpm exec tsc --noEmit`, then add `terminals: []` to every flagged `Board` literal (`seed.ts`, board creation, fixtures).
- [ ] **Step 6: Verify.** `pnpm exec jest` is fully green, and `tsc` is clean.
- [ ] **Step 7: Commit.** `git add -A && git commit -m "feat: persist general terminal tabs per board"`

---

### Task 3: Terminals dialog, button, and shortcuts

**Files:**
- Create: `src/renderer/components/terminals/TerminalsDialog.tsx`, `src/renderer/components/terminals/TerminalTabs.tsx`
- Modify: `src/renderer/components/card/TerminalPanel.tsx`, `src/renderer/components/board/BoardView.tsx`, `src/renderer/components/shell/AppShell.tsx`, `src/renderer/lib/shortcuts.ts`, `src/main/menu.ts`
- Test: `src/__tests__/terminalsDialog.test.tsx`, `src/__tests__/terminalsShortcut.test.tsx`, extend `src/__tests__/terminalPanel.test.tsx` and `src/__tests__/shortcutsHelp.test.tsx`

**Interfaces:**
- Consumes: `Board.terminals` and the three `docStore` actions and `uiStore.terminalsOpen` (Task 2), `window.electron.terminal.startShell` / `onShellState` / `close` (Task 1), the shared `useConfirm` hook, `Dialog` from `components/ui/dialog`.
- Produces:
  - `TerminalPanel` gains optional props `captureEscape?: boolean` (default `true`; when `false` the custom key handler lets Escape through to the pty) and `autoFocus?: boolean` (default `false`; calls `term.focus()` after mount).
  - `TerminalTabs({ tabs, activeId, busyIds, onSelect, onAdd, onRename, onClose })`, a presentational tab bar. Double-click a title for an inline editor (Enter commits, Esc cancels, blur commits). Long titles truncate. Check `components/common/InlineEditableText.tsx` first and reuse it if its API fits.
  - `TerminalsDialog({ open, onOpenChange })`.
  - Shortcut entries in `shortcuts.ts` under a new `'Terminals'` section: `⌘T` open (new tab when open), `⌘W` close tab, `⌘⇧W` hide, `⌘1–9` jump to tab.

- [ ] **Step 1: Write the failing tests.**
  - `terminalPanel.test.tsx`: `with captureEscape false, Escape is not swallowed` (the handler returns `true` for Escape), and `autoFocus focuses the terminal`.
  - `terminalsDialog.test.tsx` (board seeded with `defaultRepo: '/repo'` and two tabs):
    - `starts a shell for every tab with the board's repo as cwd` (`startShell` called with `{id, cwd: '/repo', cols: 80, rows: 24}`) and shows the first tab's panel.
    - `an empty board gets Terminal 1 created on open`.
    - `⌘T while open adds and activates a new tab`.
    - `⌘1 and ⌘2 switch tabs`.
    - `double-click rename commits on Enter, cancels on Esc, rejects blank`.
    - `closing an idle tab closes immediately and calls terminal.close`.
    - `closing a busy tab asks first` (a `shellState` event with `busy:true` precedes it), and declining leaves it.
    - `⌘W closes the active tab`.
    - `⌘⇧W calls onOpenChange(false)`.
    - `Escape does not close the dialog` and `clicking the overlay does not close it`.
    - `shellState alive:false for an existing tab calls startShell again`, but not for a tab that was just closed.
    - `switching the active board swaps the tabs and starts the new board's shells`.
  - `terminalsShortcut.test.tsx`: `⌘T opens the dialog when no dialog is open`; it does nothing while another `[role="dialog"]` is open, while typing in an input, or with no active board.
  - `shortcutsHelp.test.tsx`: the help dialog lists the Terminals section.
- [ ] **Step 2: Run to verify failure.** `pnpm exec jest src/__tests__/terminalsDialog.test.tsx src/__tests__/terminalsShortcut.test.tsx src/__tests__/terminalPanel.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Extend `TerminalPanel`** with `captureEscape` and `autoFocus`. The existing card-dialog behavior must be unchanged by default.
- [ ] **Step 4: Implement `TerminalTabs`** and **`TerminalsDialog`**.
  - A near-full-size `DialogContent` (about 90vw × 90vh, overriding the default max width), with a visually hidden `DialogTitle`.
  - Block Radix's dismissal: `onEscapeKeyDown`, `onInteractOutside`, and `onOpenAutoFocus` all call `preventDefault()`. The panel's `autoFocus` takes focus.
  - On open, and when the active board or its tab list changes, ensure at least one tab and call `startShell` for each tab (`cwd: board.defaultRepo ?? ''`, 80×24; the panel fits it afterwards). Daemon `start` is idempotent.
  - Mount only the active tab's `<TerminalPanel cardId={tab.id} captureEscape={false} autoFocus />` keyed by id. Other shells keep running in the daemon, and `attach` replays on switch.
  - Subscribe to `onShellState` while open: track `busy` per id, and respawn a tab whose shell died while the tab still exists.
  - While open, a capture-phase `keydown` listener on `window` handles ⌘T, ⌘W, ⌘⇧W, and ⌘1–9, calling `preventDefault` and `stopPropagation`.
  - Closing a tab: confirm via `useConfirm` when busy, then `removeBoardTerminal`, then `terminal.close(id)`, and activate a neighbor.
- [ ] **Step 5: Add the button and the open shortcut.** In `BoardView.tsx`, add a "Terminals" `Button` with the `SquareTerminal` icon after the Scratchpad button, plus `<TerminalsDialog open={terminalsOpen} onOpenChange={setTerminalsOpen} />`. In `AppShell.tsx`, add a ⌘T effect copying the Scratchpad shortcut's guards (no Shift/Alt, skip in inputs, skip when a dialog is open, require a non-archived active board).
- [ ] **Step 6: Resolve the ⌘W conflict.** `src/main/menu.ts` binds `Command+W` to the window's "Close" item (line ~148), which fires before the page sees the key. Remove that accelerator, keeping the menu item, so the renderer receives ⌘W. Note this in the commit message.
- [ ] **Step 7: Register the shortcuts** in `shortcuts.ts` per Interfaces.
- [ ] **Step 8: Verify.** `pnpm exec jest` is fully green, `pnpm exec tsc --noEmit` is clean, and `pnpm lint` has no new errors.
- [ ] **Step 9: Commit.** `git add -A && git commit -m "feat: general terminals modal with tabs and Cmd+T"`
