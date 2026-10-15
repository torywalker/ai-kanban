# AI Kanban — Agent Sessions Design Spec

**Date:** 2026-09-09
**Status:** Agreed (resolved via design interview)
**Base spec:** [2026-09-04-ai-kanban-spec.md](./2026-09-04-ai-kanban-spec.md)

## 1. Purpose

Let a card's prompt kick off a real Claude coding-agent session that does the work, tracks its own progress, and lets the user watch and respond from the card. This is the first feature to cross the v1 base spec's own stated non-goal ("v1 never calls a model API") — that boundary is deliberately and knowingly being crossed here, not accidentally.

Scope, decided during design: **Claude only.** The original ask considered supporting Codex CLI too via a literal embedded terminal (tmux + `node-pty` + `xterm.js`), which would have worked uniformly across both tools but required a new external dependency (`tmux`), a native module, and heuristic/regex-based status detection with no reliable signal for "waiting on input." Once it was clear the actual goal is "a card can get AI to do the work," not "a card has a literal shell," driving Claude through its **Agent SDK** instead is simpler on every axis that matters (no tmux, no native module, exact status instead of heuristics, exact checklist instead of parsed text, native Approve/Deny UI instead of typing into a terminal) at the cost of not being a literal general-purpose shell. Codex support is not in this spec; the design doesn't preclude adding it later as a second driver behind the same abstractions, but nothing here should be built to accommodate it prematurely.

## 2. Non-goals

- Codex CLI support (see above — deferred, not designed against).
- A literal embedded terminal / arbitrary shell access.
- Run history — a card has at most one *current* session; running again starts a new one. No list of past runs.
- Multi-window, cost/usage tracking and display, or any change to the base spec's storage/undo philosophy beyond what's described below.

## 3. Architecture

### 3.1 Session daemon

A single, shared **session daemon** — a small Node process that imports the Claude Agent SDK — is spawned lazily by the Electron main process the first time a session is started, `detached: true` + `unref()`'d so it outlives the Electron app. It listens on a Unix domain socket (Windows: a named pipe) at a fixed path under `app.getPath('userData')`, e.g. `session-daemon.sock`.

The daemon owns a map of `cardId → live Agent SDK session`. It never touches `kanban.json` and knows nothing about boards/lists — its whole interface is: start a session for a card (given a prompt and a working directory), send a reply into a running session, answer a pending permission request, stop a session, and emit a stream of events for a session (tool-use started/finished, message text, permission-requested, turn-completed, session-ended).

The Electron main process is a **client** of this daemon, never the reverse. On app boot, main checks whether the daemon's socket is alive; if so, it reconnects and asks for the current state of every card's session (which may have kept running, or finished, while the app was closed); if not, no daemon is running, meaning nothing is currently in flight for any card.

### 3.2 Renderer

The renderer never talks to the daemon directly — same pattern as every other main-process service in this app (settings, data file, clipboard). A new IPC surface (`api.session.*`) exposes: `run(cardId)`, `stop(cardId)`, `reply(cardId, text)`, `approve(cardId, requestId, decision)`, `subscribe(cardId, onEvent)`, and `getStatus(cardId)`.

## 4. Data model

- **Card** gains three fields, all optional/nullable (a card that's never had a session looks exactly as it does today):
  - `sessionTool: 'claude' | null` — present for forward compatibility with a future second driver; always `'claude'` or `null` today, no UI exposes a choice.
  - `sessionRepo: string | null` — per-card override of the board's default working directory.
  - `sessionId: string | null` — the daemon/SDK's session identifier for this card's current (or most recent) run. `null` = never run.
- **Board** gains `defaultRepo: string | null` — a folder path, set via a native folder-picker dialog (same IPC pattern as the existing file pickers).
- **Global settings** (`settings.json`, main-process, not the document) — no new fields needed now that tool choice isn't user-facing. (If Codex is added later, this is where a default-tool preference would go.)
- **Deliberately NOT stored in the document, ever**: live status, the checklist, message/tool-use history, or any per-event data. All of that is either held in the daemon's in-memory session state, or reconstructed by asking the daemon (which in turn can use the Agent SDK's own on-disk session persistence to answer "what happened in this session" after a restart). Polling or displaying session state must never trigger a document write or consume an undo step — it never touches the document at all.

## 5. Session lifecycle

- **Run** (no session yet, or the previous one finished): resolves the working directory (card override → else board default; Run is disabled if neither is set — see §7), asks the daemon to start a new Agent SDK session with the card's prompt as the initial instruction, records the returned session id on the card, begins subscribing to its event stream.
- **Run while a session is already live** (Working or Waiting on Input): the Run button is disabled. Use the View to check on it.
- **Stop**: available from the View; asks the daemon to end the session early.
- **Delete card**: if it has a live session, stop it first — no orphaned sessions survive their card.
- **Editing while a session is running**: fully allowed; has no effect on the in-progress session (it already has its initial prompt). Only affects the next Run.

## 6. UI surfaces

- **Collapsed card**: a small status indicator next to the title, shown only when `sessionId` is set — Working, Waiting on Input, or Done, each with a distinct icon/color in the same visual language as the existing priority flag. No session ever run → no indicator, card is unchanged from today.
- **Inline expansion** (existing chevron accordion, below the prompt/notes): a checklist of the session's tool-use items so far, in order, each labeled with what it did (e.g. "Read auth.py", "Ran npm test") — built directly from the daemon's structured events, not parsed from text.
- **Title click → View modal**: read-only prompt/tags/notes/link/priority, plus:
  - No session yet: a Run button.
  - Session finished: the full checklist/transcript, and a "Run again" button.
  - Session live: the transcript/checklist so far, a text box to send a reply (the next turn), and — when the daemon reports a pending permission request — explicit Approve/Deny controls with enough detail to decide (what the agent wants to do).
  - An Edit button switches to the existing editable form (where Delete already lives).

## 7. Error handling

- **No working directory resolvable** (neither card nor board has one set): Run is disabled with an inline explanation, rather than failing after the fact.
- **Working directory no longer exists on disk**: checked before starting; clear error if missing.
- **Claude Code / the Agent SDK not authenticated**: the daemon's start call fails with a specific error, surfaced verbatim in the View rather than a silent hang.
- **Daemon crashes**: main process detects the closed socket, attempts one respawn; if a card's session was live at the time, its status becomes unknown/interrupted rather than silently reverting to "no session."

## 8. Testing

The event-to-checklist mapping, status derivation, and the daemon's IPC message handling are all pure/mockable logic — testable the same way `dragEnd.ts` and `variables.ts` already are, with the Agent SDK mocked so tests never make a real API call. What remains untestable in this environment, consistent with the rest of this project: actually watching a real end-to-end Claude session run, since that requires a live API call and there is no GUI automation available here.
