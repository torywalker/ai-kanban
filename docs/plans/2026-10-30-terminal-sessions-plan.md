# Terminal Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Terminal (Claude CLI)" session engine, selectable globally and per card, that runs the user's own `claude` interactively in a daemon-owned pty shown inside the card view dialog.

**Architecture:** The session daemon gains a terminal host that owns one node-pty per card. It reports status by tailing a hook file that the CLI's `--settings` hooks append to, and estimates cost from Claude's transcript JSONL. The host speaks new ops and events on the existing socket protocol. Main forwards them over new IPC channels, and the renderer draws the pty with xterm.js in place of the transcript.

**Tech Stack:** Electron 35, React 19, TypeScript, Zustand, Jest + Testing Library, node-pty 1.1.0, @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0, pnpm 11.9.0.

**Spec:** [docs/plans/2026-10-30-terminal-sessions-spec.md](./2026-10-30-terminal-sessions-spec.md)

## Global Constraints

- Work in the worktree `/Users/torwalker/projects/ai-kanban-worktrees/terminal-sessions` on branch `feature/terminal-sessions`. Use `pnpm`, never `npm`.
- Versions are exact: `node-pty@1.1.0` in `release/app/package.json` (it's native, and root native deps fail `check-native-dep.js`), and `@xterm/xterm@6.0.0` and `@xterm/addon-fit@0.11.0` in the root `package.json`. Install with `pnpm add` / `pnpm --ignore-workspace --dir release/app add`, then run `pnpm install` so postinstall rebuilds.
- Document `version` stays `1`. New card field `sessionEngine` uses `.catch(null)`.
- Terminal is unavailable when `platform === 'win32'`. Every engine decision goes through `resolveSessionEngine`.
- UI copy is exactly as written in spec §3 and §4.4.
- Ring buffer is 1,000,000 characters, the idle timeout is 24 hours, and the hook poll interval is 250 ms.
- `src/shared/usage.ts` contains a NUL byte, which makes the Read tool refuse it. Edit it with a script or the StrReplace tool, and keep that byte intact.
- Tests stub `window.electron` after imports. Components must guard `window.electron?.terminal` the way AppShell guards `quickAdd`, because existing test mocks lack it.
- Commit after each task with a `feat:` message. This is a worktree, so committing is expected.

## Review Focus

1. A prompt containing `'`, `"`, `$`, backticks, or newlines must reach Claude verbatim. Add a `buildTerminalLaunch` test with `it's "$HOME" \`x\`\nline2` (Task 2).
2. A prompt starting with `-` must not be read as a flag. The `--` separator before the prompt is tested (Task 2). Run one manual check with the real CLI after Task 4.
3. When the hook file holds a half-written record at poll time, the host must hold it until the record separator arrives instead of dropping it. Tested in Task 2.
4. When a hook fires twice for the same Stop, or a transcript line restates a message id, the cost must not be recorded twice. Tested in Task 3 (`last line wins per id`, skip ids already recorded).
5. When a terminal card's dialog closes and reopens while the pty keeps printing, no output may be lost or duplicated. The replay test covers this (Task 2), and so does the panel's drop-until-replay test (Task 4).

---

### Task 1: Engine setting and per-card override

**Files:**
- Create: `src/shared/sessionEngine.ts`
- Modify: `src/shared/ipc.ts` (`Settings`), `src/main/services/settings.ts` (`DEFAULTS`), `src/shared/schema.ts` (`CardSchema`), `src/main/preload.ts` (add `platform: process.platform` at the top level of `api`), `src/renderer/store/docStore.ts` (state, bootstrap, setters, `NewCardFields`, `addCard`), `src/shared/quickAdd.ts` (`insertNewCard` writes `sessionEngine: null`; `QuickAddCardFields` gains `sessionEngine?`), `src/renderer/components/shell/SettingsDialog.tsx`, `src/renderer/components/card/CardComposerDialog.tsx`
- Test: `src/__tests__/sessionEngine.test.ts`, `src/__tests__/settingsDialogEngine.test.tsx`, and add a case to `src/__tests__/cardComposerDialog.test.tsx`

**Interfaces:**
- Produces:
  - `type SessionEngine = 'sdk' | 'terminal'`
  - `terminalSupported(platform: string): boolean`
  - `resolveSessionEngine(card: SessionEngine | null, global: SessionEngine, platform: string): SessionEngine`
  - `Settings.sessionEngine: SessionEngine`, `Settings.claudeCliPath: string | null`
  - `Card.sessionEngine: SessionEngine | null`
  - doc store `sessionEngine`, `claudeCliPath`, `setSessionEngine(engine)`, `setClaudeCliPath(path: string | null)`. Both setters write settings the way `setUseWorktrees` does.
  - `window.electron.platform: string`

- [ ] **Step 1: Write failing tests**

`sessionEngine.test.ts`:
- `resolveSessionEngine(null, 'terminal', 'darwin')` → `'terminal'`
- `resolveSessionEngine('sdk', 'terminal', 'linux')` → `'sdk'`
- `resolveSessionEngine('terminal', 'terminal', 'win32')` → `'sdk'`
- `terminalSupported('win32')` → `false`, `terminalSupported('darwin')` → `true`
- `parseDoc` on a card with no `sessionEngine` yields `null`, and on `sessionEngine: 'bogus'` yields `null`

`settingsDialogEngine.test.tsx`, with a mock `platform: 'darwin'`:
- Clicking the button named `Terminal (Claude CLI)` sets `aria-pressed="true"` on it and calls `settings.write` with `{ sessionEngine: 'terminal' }`.
- Typing `/opt/claude` into the textbox labelled `Claude CLI path` and blurring calls `settings.write` with `{ claudeCliPath: '/opt/claude' }`. Clearing it and blurring writes `{ claudeCliPath: null }`.
- With `platform: 'win32'`, the `Terminal (Claude CLI)` button is disabled and the text `Terminal sessions aren't available on Windows yet.` is shown.

`cardComposerDialog.test.tsx` new case: with global `sessionEngine: 'sdk'`, open Overrides, see a button named `Default (Built-in)`, click `Terminal`, then Save. The card's `sessionEngine` is `'terminal'`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec jest src/__tests__/sessionEngine.test.ts src/__tests__/settingsDialogEngine.test.tsx src/__tests__/cardComposerDialog.test.tsx --no-coverage`
Expected: FAIL. The module is not found and the buttons don't exist.

- [ ] **Step 3: Implement**

Add the fields and defaults (`sessionEngine: 'sdk'`, `claudeCliPath: null`) and the schema field `z.enum(['sdk','terminal']).nullable().catch(null)`. Card fixtures built by hand in tests that fail `tsc` get `sessionEngine: null`.

Settings UI goes in the Agent behavior section after Tool approval. Reuse the Tool approval option-button markup by extracting it into a local `OptionButtons` component used by both. The Claude CLI path is an `Input` with `id="claude-cli-path"` and a `Label`.

The composer's Engine control reuses the existing worktree three-way control's component. Extract that component if it's inline, and count the engine override in `overrideCount`.

- [ ] **Step 4: Run tests, the full suite, and tsc**

Run: `pnpm exec jest --no-coverage --silent` and `pnpm exec tsc --noEmit`
Expected: all pass, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: session engine setting and per-card override"
```

---

### Task 2: Daemon terminal host and IPC

**Files:**
- Create: `src/main/daemon/terminalLaunch.ts` (pure), `src/main/daemon/terminalHooks.ts` (pure), `src/main/daemon/terminalHost.ts`
- Modify: `release/app/package.json` (add `node-pty@1.1.0`), `package.json` (`build.asarUnpack` adds `**/node_modules/node-pty/**`), `src/shared/daemonProtocol.ts`, `src/main/daemon/index.ts`, `src/main/daemon/turnLifecycle.ts` (`normalizeHydratedSnapshot`), `src/shared/ipc.ts` (`CHANNELS`), `src/main/main.ts`, `src/main/preload.ts`
- Test: `src/__tests__/terminalLaunch.test.ts`, `src/__tests__/terminalHooks.test.ts`, `src/__tests__/terminalHost.test.ts`

**Interfaces:**
- Consumes: `SessionEngine` (Task 1), `ApprovalMode`, `SessionSnapshot`.
- Produces (protocol, in `daemonProtocol.ts`):
  - `interface TerminalState { shellAlive: boolean; claudeRunning: boolean }`
  - `SessionSnapshot` gains optional `engine?: 'terminal'` and `terminal?: TerminalState`
  - `DaemonRequest` gains:
    - `{ op: 'terminalStart'; cardId; cwd; prompt; model: string | null; approvalMode; sessionId: string | null; claudeCliPath: string | null; cols: number; rows: number }`
    - `{ op: 'terminalInput'; cardId; data: string }`
    - `{ op: 'terminalResize'; cardId; cols; rows }`
    - `{ op: 'terminalInterrupt'; cardId }`
    - `{ op: 'terminalClose'; cardId }`
    - `{ op: 'terminalAttach'; cardId }`
    - `{ op: 'terminalCloseIdle' }`
  - `DaemonEvent` gains `{ event: 'terminalData'; cardId; data: string }` and `{ event: 'terminalReplay'; cardId; data: string }`
- Produces (launch, in `terminalLaunch.ts`):
  - `shellQuote(value: string): string`
  - `buildHookSettings(): string`, which returns a JSON string
  - `buildTerminalLaunch(input: TerminalLaunchInput): { file: string; args: string[]; env: Record<string, string> }`, where `TerminalLaunchInput = { shell: string; claudeCliPath: string | null; prompt: string; model: string | null; approvalMode: ApprovalMode; sessionId: string; resume: boolean; hookFile: string; baseEnv: Record<string, string | undefined> }`
  - `defaultShell(platform: string, envShell: string | undefined): string`
- Produces (hooks, in `terminalHooks.ts`):
  - `interface HookEvent { name: string; sessionId: string | null; transcriptPath: string | null }`
  - `splitHookRecords(pending: string): { events: HookEvent[]; rest: string }`
  - `applyHookEvent(snapshot: SessionSnapshot, event: HookEvent): SessionSnapshot`
  - `applyPtyExit(snapshot: SessionSnapshot): SessionSnapshot`
  - `appendCapped(buffer: string, chunk: string, max?: number): string`, with `max` defaulting to `1_000_000`
  - `isIdleTerminal(snapshot: SessionSnapshot): boolean`
- Produces (host, in `terminalHost.ts`):
  - `createTerminalHost(deps: TerminalHostDeps): TerminalHost`
  - `TerminalHostDeps = { spawnPty: (file: string, args: string[], opts: { cwd: string; cols: number; rows: number; env: Record<string, string> }) => PtyLike; hookDir: string; platform: string; envShell: string | undefined; baseEnv: Record<string, string | undefined>; publishSnapshot: (s: SessionSnapshot) => void; publishEvent: (e: DaemonEvent) => void; onUsageBatch: (cardId: string, transcriptPath: string, first: boolean) => void; now: () => number }`
  - `PtyLike = { onData(cb: (d: string) => void): void; onExit(cb: () => void): void; write(d: string): void; resize(c: number, r: number): void; kill(): void }`
  - `TerminalHost = { start(req), input(cardId, data), resize(cardId, cols, rows), interrupt(cardId), close(cardId), attach(cardId), closeIdle(), openCount(): number, dispose() }`. `onUsageBatch` is a stub until Task 3.
  - IPC `CHANNELS`: `terminalStart: 'terminal:start'`, `terminalInput: 'terminal:input'`, `terminalResize: 'terminal:resize'`, `terminalInterrupt: 'terminal:interrupt'`, `terminalClose: 'terminal:close'`, `terminalAttach: 'terminal:attach'`, `terminalCloseIdle: 'terminal:close-idle'`, `terminalData: 'terminal:data'`, `terminalReplay: 'terminal:replay'`
  - preload `terminal: { start(req: Omit<TerminalStartRequest,'op'>): Promise<void>; input(cardId, data): void; resize(cardId, cols, rows): void; interrupt(cardId): Promise<void>; close(cardId): Promise<void>; attach(cardId): Promise<void>; closeIdle(): Promise<void>; onData(cb: (cardId: string, data: string) => void): () => void; onReplay(cb: (cardId: string, data: string) => void): () => void }`

- [ ] **Step 1: Write failing tests**

`terminalLaunch.test.ts`:
- `shellQuote("it's")` → `'it'\''s'`
- `defaultShell('darwin', undefined)` → `/bin/zsh`, `defaultShell('linux', undefined)` → `/bin/bash`, and `defaultShell('darwin', '/opt/fish')` → `/opt/fish`
- New conversation: for `{ shell: '/bin/zsh', claudeCliPath: null, prompt: 'it\'s "$HOME" `x`\nline2', model: 'claude-opus-5-5', approvalMode: 'ask', sessionId: 'u-1', resume: false, hookFile: '/h/c.log' }`:
  - `file === '/bin/zsh'` and `args.slice(0,3)` equals `['-l','-i','-c']`
  - the script contains `command -v claude`
  - the script contains `claude --session-id 'u-1' --permission-mode 'manual' --model 'claude-opus-5-5' --settings '` and `-- ` followed by `shellQuote(prompt)`
  - the script ends with `exec '/bin/zsh' -l -i`
  - `env.AI_KANBAN_HOOK_FILE === '/h/c.log'` and `env.TERM === 'xterm-256color'`
- `resume: true, approvalMode: 'auto', model: null`: the script contains `--resume 'u-1' --permission-mode 'auto'`, and contains neither `--model` nor `-- `
- `claudeCliPath: '/opt/c'`: the script contains `[ -x '/opt/c' ]` and runs `'/opt/c' --session-id`
- The missing-CLI branch prints exactly `Claude CLI not found. Set its path in Settings → Agent sessions → Claude CLI path.`
- `JSON.parse(buildHookSettings()).hooks` has keys `SessionStart, UserPromptSubmit, Notification, Stop, SessionEnd`. Each key's command equals `cat >> "$AI_KANBAN_HOOK_FILE"; printf '\n\036\n' >> "$AI_KANBAN_HOOK_FILE"`.

`terminalHooks.test.ts`:
- `splitHookRecords('{"hook_event_name":"Stop","session_id":"s"}\n\x1e\n{"hook_event_name":"Notif')` returns one event `{ name: 'Stop', sessionId: 's', transcriptPath: null }` with `rest` equal to the partial text.
- A malformed record is skipped and the next one is still parsed.
- `applyHookEvent` produces the spec §4.3 table row by row, one `it` per event. `SessionEnd` on `working` gives `done` with `claudeRunning: false`.
- `applyPtyExit` on `waiting` gives `done` with `shellAlive: false, claudeRunning: false`.
- `appendCapped('a'.repeat(10), 'bcd', 8)` → `'aaaaabcd'`.
- `isIdleTerminal` is true for `{ shellAlive: true, claudeRunning: false }`, for `status: 'waiting'`, and for `status: 'done'`, and false for `status: 'working'` with `claudeRunning: true`.

`terminalHost.test.ts` uses a fake `PtyLike`, `jest.useFakeTimers()`, and a temp `hookDir`:
- `start` spawns once and publishes a snapshot with `engine: 'terminal'`, `status: 'working'`, `sessionId` equal to the request's `sessionId` (or a uuid when that's null), and `terminal: { shellAlive: true, claudeRunning: false }`. The hook file exists and is empty.
- A second `start` for the same card while it's alive does not spawn again.
- pty data `'hello'` publishes `terminalData`. After that, `attach` publishes `terminalReplay` with `'hello'`.
- Writing a Notification record to the hook file and advancing 250 ms publishes `status: 'waiting'`. Writing half a record publishes nothing until the rest arrives.
- A Stop record calls `onUsageBatch(cardId, transcriptPath, true)`, the next Stop calls it with `false`, and a SessionEnd record also calls it.
- `interrupt` writes `'\x1b'`. `close` calls `kill`. After the pty exits, `openCount()` is 0 and the snapshot has `shellAlive: false`.
- Advancing 24 h with no data or input kills the pty. Input resets that timer.
- `closeIdle` kills only idle terminals.

Also add to the existing `normalizeHydratedSnapshot` tests: a snapshot with `terminal: { shellAlive: true, claudeRunning: true }` hydrates to `{ shellAlive: false, claudeRunning: false }`.

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec jest src/__tests__/terminalLaunch.test.ts src/__tests__/terminalHooks.test.ts src/__tests__/terminalHost.test.ts --no-coverage`
Expected: FAIL (modules not found).

- [ ] **Step 3: Install node-pty and implement**

`pnpm --ignore-workspace --dir release/app add node-pty@1.1.0 && pnpm install`.

The script is built by joining these with `; `:
- `if <check>; then <claude cmd>; else printf '%s\n' <quoted message>; fi`
- `exec <quoted shell> -l -i`

The host keeps `Map<cardId, { pty, buffer, hookOffset, pendingHook, snapshot, firstBatch, idleTimer }>`. It polls with `setInterval(250)` using `fs.openSync`/`readSync` from `hookOffset`.

In `index.ts`:
- Build the host with `spawnPty` from `require('node-pty').spawn`, `hookDir = path.join(path.dirname(cacheDir), 'terminal-hooks')`, and `publishSnapshot` through the existing persist/broadcast path.
- Route the seven ops.
- Count `host.openCount()` in `pong.activeTurns`.
- Call `host.dispose()` on SIGTERM.

`main.ts` adds an `ipcMain.handle` or `on` per channel that forwards to `sendDaemonRequest`, and extends `subscribeDaemonEvents` to forward `terminalData` and `terminalReplay` to all windows.

- [ ] **Step 4: Run tests, the full suite, and tsc**

Run: `pnpm exec jest --no-coverage --silent` and `pnpm exec tsc --noEmit`
Expected: all pass, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: daemon-owned terminal sessions"
```

---

### Task 3: Cost estimate from Claude's transcript

**Files:**
- Create: `src/shared/modelPricing.ts`, `src/main/daemon/transcriptUsage.ts`
- Modify: `src/shared/usage.ts` (`UsageEntrySchema` gains `estimated: z.boolean().optional()`), `src/main/daemon/index.ts` (wire `onUsageBatch`)
- Test: `src/__tests__/modelPricing.test.ts`, `src/__tests__/transcriptUsage.test.ts`

**Interfaces:**
- Consumes: `TerminalHostDeps.onUsageBatch` (Task 2), `appendUsageEntries(ledgerPath, entries)`, `UsageEntry`.
- Produces:
  - `interface RequestUsage { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number }`
  - `estimateCostUSD(model: string, usage: RequestUsage): number`
  - `priceFor(model: string, promptTokens: number): ModelPrice | null`, with prices per MTok `{ input, write5m, write1h, cacheRead, output }`
  - `createTranscriptUsageReader(): { read(cardId: string, transcriptPath: string, first: boolean, at: string): UsageEntry[] }`, which keeps a per-transcript byte offset and the set of recorded message ids

- [ ] **Step 1: Write failing tests**

`modelPricing.test.ts`:
- `estimateCostUSD('claude-sonnet-5', { input: 6, output: 1490, cacheRead: 115493, cacheWrite5m: 0, cacheWrite1h: 27434 })` is `toBeCloseTo(0.14774, 5)`
- `priceFor('claude-opus-4-5-20251101', 0)` has `input: 5` (longest prefix), and `priceFor('claude-opus-4-1', 0)` has `input: 15`
- `priceFor('claude-haiku-5-5', 100_000)` has `input: 0.1`, and `priceFor('claude-haiku-5-5', 100_001)` has `input: 0.5`
- `priceFor('gpt-x', 0)` is `null`, and `estimateCostUSD('gpt-x', …)` is `0`
- One assertion per spec §5 table row on its `output` price, written as a `test.each`

`transcriptUsage.test.ts`, with a temp JSONL:
- Two lines with the same `message.id` (output 10, then 20) and one other id produce one row per model with `outputTokens` equal to the sum of 20 and the other id, `estimated: true`, `canonicalModel: null`, `turnKind: 'run'`, and `turnId: 'terminal:' + lastId`.
- `cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 4 }` is priced as split writes. With no `cache_creation`, `cache_creation_input_tokens: 7` is priced as 5-minute writes, and `cacheCreationInputTokens` is `7` in both cases.
- Calling `read` again with no new lines returns `[]`. Appending a line with an already-recorded id returns `[]`. A new id returns a row with `turnKind: 'reply'` when `first` is false.
- A `<synthetic>` model and a missing file both return `[]` without throwing.
- `UsageEntrySchema.parse` accepts a row without `estimated` (old ledger rows).

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec jest src/__tests__/modelPricing.test.ts src/__tests__/transcriptUsage.test.ts --no-coverage`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`modelPricing.ts` holds the spec §5 table as `const PRICES: { prefix: string; price: ModelPrice; longPrompt?: ModelPrice }[]`, with `longPrompt` set for Haiku 5.5. Wire the host's `onUsageBatch` in `index.ts` to `appendUsageEntries(ledgerPath, reader.read(cardId, path, first, new Date().toISOString()))`.

- [ ] **Step 4: Run tests, the full suite, and tsc**

Run: `pnpm exec jest --no-coverage --silent` and `pnpm exec tsc --noEmit`
Expected: all pass, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: estimate terminal session cost from transcripts"
```

---

### Task 4: Terminal panel and card controls

**Files:**
- Create: `src/renderer/components/card/TerminalPanel.tsx`
- Modify: `package.json` (add `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`), `src/renderer/components/card/CardViewDialog.tsx`, `src/renderer/components/shell/SettingsDialog.tsx` (Daemon section), `src/renderer/store/docStore.ts` (`deleteCard` and `archiveCard` call `window.electron?.terminal?.close(cardId)` when that card's snapshot has `terminal.shellAlive`), `.erb/mocks` or `jest` `moduleNameMapper` (map `@xterm/xterm` to a test mock exposing `Terminal` with `open`, `write`, `reset`, `onData`, `loadAddon`, `dispose`, `cols`, `rows`, and map `@xterm/addon-fit` to `FitAddon` with `fit`), and the stylesheet import `@xterm/xterm/css/xterm.css` in `TerminalPanel.tsx`
- Test: `src/__tests__/terminalPanel.test.tsx`, `src/__tests__/cardViewDialogTerminal.test.tsx`, add to `src/__tests__/settingsDialogRestartDaemon.test.tsx`

**Interfaces:**
- Consumes: `window.electron.terminal` (Task 2), `resolveSessionEngine`, doc store `sessionEngine` and `claudeCliPath` (Task 1), `SessionSnapshot.terminal`.
- Produces: `TerminalPanel({ cardId }: { cardId: string })`

- [ ] **Step 1: Write failing tests**

`terminalPanel.test.tsx`:
- On mount, the panel calls `terminal.attach('crd_1')`.
- A `terminalData` for `crd_1` that arrives before the replay is not written. A `terminalReplay('crd_1', 'abc')` calls `reset` and then `write('abc')`. A later data event `'d'` writes `'d'`. Data for `crd_2` is ignored.
- A keypress (the mock `onData` callback with `'x'`) calls `terminal.input('crd_1', 'x')`.
- After fit, the panel calls `terminal.resize('crd_1', cols, rows)`.

`cardViewDialogTerminal.test.tsx`, with global `sessionEngine: 'terminal'`, a card with a repo and prompt `hi {{name}}` where variables give `name: 'Bo'`, and no snapshot:
- Clicking `Run` calls `terminal.start` with `{ cardId, cwd: <repo>, prompt: 'hi Bo', sessionId: null, claudeCliPath: null, approvalMode: 'ask' }`, and `session.run` is not called.
- With a snapshot of `{ engine: 'terminal', status: 'working', terminal: { shellAlive: true, claudeRunning: true } }`:
  - there is no `Run` button and no reply textbox
  - `Stop` calls `terminal.interrupt(cardId)`
  - `Close terminal` opens the confirm text `Claude is still running in this terminal. Close it anyway?`, and confirming calls `terminal.close(cardId)`
  - the text `Cost is estimated from token counts for terminal sessions.` is shown
- With `claudeRunning: false`, `Close terminal` calls `terminal.close` without confirming.
- With a worktree and `claudeRunning: true`, clicking Ship shows the toast `Exit Claude in the terminal before shipping.`, and `git.shipPlan` is not called.
- A card with `sessionEngine: 'sdk'` and no terminal snapshot still renders the transcript and the reply box (regression).
- With `terminal.shellAlive: true`, `useDocStore.getState().archiveCard(...)` and `deleteCard(...)` each call `terminal.close(cardId)`. With no terminal snapshot, neither calls it.

`settingsDialogRestartDaemon.test.tsx` additions: with two snapshots where `terminal.shellAlive` is true, the Agent sessions tab shows `2 terminals open`, and `Close idle terminals` calls `terminal.closeIdle()`. The Restart Daemon confirm includes `Open terminals will be closed.`

- [ ] **Step 2: Run them and confirm they fail**

Run: `pnpm exec jest src/__tests__/terminalPanel.test.tsx src/__tests__/cardViewDialogTerminal.test.tsx src/__tests__/settingsDialogRestartDaemon.test.tsx --no-coverage`
Expected: FAIL.

- [ ] **Step 3: Implement**

Install: `pnpm add @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0`.

`TerminalPanel`:
- Creates the `Terminal` with `fontSize: 13`, a monospace `fontFamily`, and a theme from the document's `dark` class.
- Runs fit in a `ResizeObserver`.
- Drops data until it sees the replay, and disposes on unmount.

`CardViewDialog`:
- Computes `terminalMode = snapshot?.engine === 'terminal' ? true : resolveSessionEngine(card.sessionEngine, sessionEngine, window.electron.platform) === 'terminal'`.
- In terminal mode, it forces the expanded layout and renders `<TerminalPanel>` instead of `SessionTranscript` and the reply box.
- Branches `run` after the worktree step to `api.terminal.start({ …, cols: 120, rows: 32 })`, and `stop` to `interrupt`.
- Adds the `Close terminal` button, with `ConfirmDialog` for the running case.
- Guards `requestShip` with the toast.

The confirm dialog uses the existing `ConfirmDialog` component.

- [ ] **Step 4: Run tests, the full suite, tsc, and lint the touched files**

Run:
- `pnpm exec jest --no-coverage --silent`
- `pnpm exec tsc --noEmit`
- `pnpm exec eslint src/renderer/components/card/TerminalPanel.tsx src/main/daemon/terminalHost.ts src/main/daemon/terminalLaunch.ts src/main/daemon/terminalHooks.ts src/main/daemon/transcriptUsage.ts src/shared/modelPricing.ts src/shared/sessionEngine.ts`

Expected: tests pass, tsc exit 0, and no new lint errors in the new files.

- [ ] **Step 5: Manual smoke test (macOS)**

1. Run `pnpm start`, set Session engine to Terminal, and Run a card whose prompt is `-v say hi`.
2. Check that Claude receives the literal prompt, the badge goes Working → Done, and closing and reopening the dialog replays output.
3. Check that `/exit` leaves a shell prompt, and that the card's cost increases.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: terminal panel in the card view dialog"
```
