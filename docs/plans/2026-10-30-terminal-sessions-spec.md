# AI Kanban — Terminal Sessions Design Spec

**Date:** 2026-10-30
**Status:** Agreed (resolved via design interview)
**Base specs:** [2026-09-09-ai-kanban-agent-sessions-spec.md](./2026-09-09-ai-kanban-agent-sessions-spec.md), [2026-09-15-worktree-ship-spec.md](./2026-09-15-worktree-ship-spec.md)

## 1. Purpose

Add a second session engine. Today a card's Run goes through the Agent SDK (`query()` in the session daemon) and renders a structured transcript. The new **Terminal** engine opens a real interactive terminal in the card's view dialog: the user's login shell, running the user's own `claude` CLI with the card's prompt already submitted. The user types into the terminal directly, the way they would in their own terminal app.

## 2. Non-goals

- Rebuilding the tool checklist or the transcript from terminal output. Terminal cards show no checklist on the board.
- Windows support. On Windows the Terminal choice is disabled.
- A cap on open terminals.
- Using the Agent SDK's bundled `claude` binary for terminal sessions.
- Showing an earlier engine's transcript or terminal output after the engine changes. Only the conversation carries over.

## 3. Settings

### 3.1 Global (app `settings.json`)

| Field | Type | Default |
|---|---|---|
| `sessionEngine` | `'sdk' \| 'terminal'` | `'sdk'` |
| `claudeCliPath` | `string \| null` | `null` |

Settings → Agent sessions → **Agent behavior** gains:

- **Session engine**: two option buttons in the same style as Tool approval.
  - `Built-in (Agent SDK)`: "Runs Claude through the Agent SDK and shows a structured transcript."
  - `Terminal (Claude CLI)`: "Opens a terminal in the card running your own `claude` CLI."
  - On Windows the Terminal button is disabled and the section shows: "Terminal sessions aren't available on Windows yet."
- **Claude CLI path**: a text input with placeholder `claude (found through your login shell)`. Empty means `null`. Help text: "Leave empty to use the `claude` on your login shell's PATH." Saved on blur.

Settings → Agent sessions → **Daemon** gains a line `N terminals open` (hidden when 0) and a **Close idle terminals** button. A terminal is idle when its shell is alive and Claude is not running, or when Claude's status is `waiting` or `done`.

Restart Daemon's confirm dialog adds: "Open terminals will be closed." when any are open.

### 3.2 Card override (document)

`Card.sessionEngine: 'sdk' | 'terminal' | null`, Zod `.catch(null)`. `null` inherits the global setting. Document `version` stays **1**.

Composer → Overrides gains an **Engine** three-way control: `Default (Built-in)` / `Default (Terminal)` (whichever is global), `Built-in`, `Terminal`. It counts toward the Overrides summary the same way the worktree override does. On Windows, `Terminal` is disabled, and the effective engine is always `sdk`.

`resolveSessionEngine(card, global, platform)` returns `'sdk'` on `win32`, otherwise `card ?? global`.

## 4. Running a terminal session

### 4.1 Where it lives

The pty is owned by the **session daemon**, so it survives closing the dialog and restarting the app. Its output is kept in a per-card ring buffer of the last **1,000,000** characters. Reopening the card's dialog attaches: the buffer is replayed, then live output streams.

A terminal closes itself after **24 hours** with no output and no input.

The daemon's `pong.activeTurns` counts open terminals as well as SDK turns, so a rebuilt daemon never evicts live terminals.

### 4.2 What starts

Run in terminal mode resolves the working directory the same way the built-in Run does (worktree via `ensureWorktree` when worktrees are on, else `sessionRepo ?? board.defaultRepo`). Variables are substituted into the prompt first.

The daemon spawns `$SHELL` (fallback `/bin/zsh` on macOS, `/bin/bash` on Linux) with args `['-l', '-i', '-c', <script>]` in that `cwd`, env = daemon env plus `AI_KANBAN_HOOK_FILE=<hook file>` and `TERM=xterm-256color`. The script:

1. Checks that the CLI exists: `command -v claude` when `claudeCliPath` is null, `[ -x <path> ]` otherwise. If it's missing, the script prints `Claude CLI not found. Set its path in Settings → Agent sessions → Claude CLI path.` and skips step 2.
2. Runs Claude:
   - New conversation (card has no `sessionId`): `<claude> --session-id <uuid> --permission-mode <mode> [--model <model>] --settings <hooks json> -- <prompt>`. The daemon generates the uuid with `crypto.randomUUID()`.
   - Existing conversation (card has a `sessionId`, from either engine): `<claude> --resume <sessionId> --permission-mode <mode> [--model <model>] --settings <hooks json>`, with no prompt.
3. `exec <shell> -l -i`, so the user lands at a normal prompt in the same folder when Claude exits.

Permission mode: app `'ask'` maps to `manual` and `'auto'` maps to `auto`. Model: the card's `sessionModel ?? defaultModel`, omitted when null.

Every argument is POSIX single-quoted.

### 4.3 Status from hooks

`--settings` carries inline JSON registering one command hook on each of `SessionStart`, `UserPromptSubmit`, `Notification`, `Stop`, and `SessionEnd`:

```
cat >> "$AI_KANBAN_HOOK_FILE"; printf '\n\036\n' >> "$AI_KANBAN_HOOK_FILE"
```

The hook file is `<dirname(cacheDir)>/terminal-hooks/<cardId>.log`, truncated at spawn. The daemon polls it every 250 ms from its last offset, splits records on a line holding only `\x1e`, and parses each record as JSON (`hook_event_name`, `session_id`, `transcript_path`).

The terminal card's `SessionSnapshot` carries `engine: 'terminal'` and `terminal: { shellAlive, claudeRunning }`. Events map as follows:

| Event | Effect |
|---|---|
| `SessionStart` | `claudeRunning = true`, `status = 'working'`, `sessionId = session_id` |
| `UserPromptSubmit` | `status = 'working'` |
| `Notification` | `status = 'waiting'` |
| `Stop` | `status = 'done'`, then usage is recorded (§5) |
| `SessionEnd` | `claudeRunning = false`; `working`/`waiting` → `done`; usage is recorded (§5) |
| pty exit | `shellAlive = false`, `claudeRunning = false`; `working`/`waiting` → `done` |

The snapshot's `sessionId` is set at spawn (the generated uuid or the resumed id), so the card persists it through the existing `setCardSessionId` effect. The existing badge and chimes work unchanged. A hydrated terminal snapshot (daemon restarted) always comes back with `shellAlive: false, claudeRunning: false`.

### 4.4 Controls in the card view dialog

When the card's effective engine is `terminal`, or its live snapshot has `engine: 'terminal'`:

- The dialog switches to its expanded layout. The transcript area is replaced by the terminal panel (xterm.js, fit to the area, theme following light/dark, 13px monospace).
- The reply box is hidden.
- **Run** shows while no terminal is open (`shellAlive` false or no snapshot) and starts one. While one is open, Run is hidden.
- **Stop** sends `\x1b` (Escape) to the pty. It is enabled while `claudeRunning`.
- **Close terminal** kills the pty. When `claudeRunning`, it first confirms: "Claude is still running in this terminal. Close it anyway?"
- Under the terminal: "Cost is estimated from token counts for terminal sessions."

Deleting or archiving a card closes its terminal.

Changing a card's engine does not touch a terminal that is already open. The dialog keeps showing the open terminal until it is closed.

### 4.5 Ship

Ship conflict turns always use the built-in engine with the card's `sessionId`, unchanged. Ship is refused while the card's terminal has `claudeRunning`, with the toast: "Exit Claude in the terminal before shipping."

## 5. Cost estimate

On `Stop` and `SessionEnd`, the daemon reads `transcript_path` from its last offset for that card. Each JSONL line with `type: 'assistant'` contributes `message.usage` keyed by `message.id`. The last line wins per id, and ids already recorded are skipped. Model `<synthetic>` is ignored.

Per model, the daemon appends one `UsageEntry` with:

- `turnId: 'terminal:' + <last message id in the batch>`
- `turnKind`: `'run'` for the first batch of a spawn, `'reply'` afterwards
- `canonicalModel: null`
- `estimated: true`
- the token sums and `costUSD = estimateCostUSD(model, usage)`

Cache creation tokens use `usage.cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens` when present, else all of `cache_creation_input_tokens` is priced as 5-minute writes. Unknown models record their tokens with `costUSD: 0`.

Price table (USD per million tokens, from Anthropic's pricing page, 2026-10-30). Model ids are matched by longest prefix, e.g. `claude-opus-4-5-20251101` matches `claude-opus-4-5`:

| Prefix | Input | 5m write | 1h write | Cache read | Output |
|---|---|---|---|---|---|
| `claude-fable-5-1` | 10 | 12.5 | 20 | 0.25 | 50 |
| `claude-mythos-5-1` | 10 | 12.5 | 20 | 0.25 | 50 |
| `claude-fable-5` | 10 | 12.5 | 20 | 1 | 50 |
| `claude-mythos-5` | 10 | 12.5 | 20 | 1 | 50 |
| `claude-opus-5-5` | 4 | 5 | 8 | 0.2 | 20 |
| `claude-opus-5` | 5 | 6.25 | 10 | 0.5 | 25 |
| `claude-opus-4-8`, `-4-7`, `-4-6`, `-4-5` | 5 | 6.25 | 10 | 0.5 | 25 |
| `claude-opus-4-1`, `claude-opus-4` | 15 | 18.75 | 30 | 1.5 | 75 |
| `claude-sonnet-5-5` | 2 | 2.5 | 4 | 0.1 | 10 |
| `claude-sonnet-5` | 2 | 2.5 | 4 | 0.2 | 10 |
| `claude-sonnet-4-6`, `-4-5`, `claude-sonnet-4` | 3 | 3.75 | 6 | 0.3 | 15 |
| `claude-haiku-5-5` (prompt ≤ 100,000) | 0.1 | 0.125 | 0.2 | 0.01 | 0.5 |
| `claude-haiku-5-5` (prompt > 100,000) | 0.5 | 0.625 | 1 | 0.05 | 2.5 |
| `claude-haiku-4-5` | 1 | 1.25 | 2 | 0.1 | 5 |
| `claude-haiku-3-5` | 0.8 | 1 | 1.6 | 0.08 | 4 |

The Haiku 5.5 tier is chosen per API request (one `message.id`). The prompt size is `input + cache read + cache creation` tokens.

The table was checked against the existing ledger: the SDK priced a Sonnet 5 turn (6 input, 1,490 output, 115,493 cache read, 27,434 cache creation) at $0.1477466. With 1-hour writes, the table gives $0.14774.

## 6. Packaging

`node-pty@1.1.0` goes in `release/app/package.json` dependencies (native, electron-rebuilt, webpack external). `@xterm/xterm@6.0.0` and `@xterm/addon-fit@0.11.0` go in the root dependencies. electron-builder `asarUnpack` adds `**/node_modules/node-pty/**`, so `spawn-helper` and the `.node` binary stay executable.
