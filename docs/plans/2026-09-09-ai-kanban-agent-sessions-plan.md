# AI Kanban Agent Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **No commit steps appear in this plan.** The repository owner stages and
> commits manually. Do not run `git add` or `git commit`. End each task with
> its verification step and stop.

**Goal:** Let a card's prompt kick off a real Claude Agent SDK session that does the work in a chosen working directory, tracks Working/Waiting-on-Input/Done status and a checklist of what it did, and lets the user watch and respond to it from the card — surviving the app being closed and reopened.

**Architecture:** A single detached Node "session daemon" process (spawned by, but independent of, Electron's main process) owns every live Agent SDK session and speaks a small newline-delimited-JSON protocol over a local Unix socket. Electron's main process is a thin client of that daemon (same role it already plays toward the data file and clipboard); the renderer never talks to the daemon directly, only through IPC to main, same pattern as every existing service in this app.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk`, Node's built-in `net` module (Unix domain socket), the existing Electron/React/zustand/Zod stack.

**Spec:** [2026-09-09-ai-kanban-agent-sessions-spec.md](./2026-09-09-ai-kanban-agent-sessions-spec.md)

## Global Constraints

- Never run `git add` or `git commit`. Read-only git commands only.
- Never run `git stash` — the stash stack is shared with other worktrees/sessions on this machine.
- Install every dependency with `@latest` or a version verified via `npm view <pkg> version`. Never write a version from memory.
- This project has no GUI-automation driver available. Manual/interactive verification steps are paired with an automated-check alternative in every task below — do the automated check; note explicitly in your report if a step is genuinely un-automatable and what you substituted.
- Do not stop/start the Electron app (`npm start`) to smoke-test routine changes — rely on `npx tsc --noEmit`, `npx jest`, and reading compiled output. Reserve an actual app launch for the one task that specifically calls for it.
- Session status, checklist, and any per-event data are never written into `kanban.json` and never flow through `mutate`/`commit`. They are runtime-only state, reconstructed from the daemon on demand. Polling for status must never trigger a document write or consume an undo step.
- One live session per card. Running again after a session finished starts a fresh one; there is no run-history list.
- This is a Claude-only integration. `Card.sessionTool` exists for forward compatibility but is always `'claude'` or `null` — no UI offers a choice.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `src/shared/daemonProtocol.ts` | Types shared by the daemon, main, and renderer: the request/event shapes for the daemon socket protocol, `SessionStatus`, `ChecklistItem`, `SessionSnapshot`. Not part of the Zod document schema — this is runtime-only state. |
| `src/main/daemon/index.ts` | The session daemon's own entry point (a separate webpack bundle, run as a detached Node process). Owns the Agent SDK, the per-card session map, and the socket server. |
| `src/main/daemon/framing.ts` | Newline-delimited-JSON framing helpers, shared by both ends of the socket (the daemon imports it directly; `sessionDaemonClient.ts` imports it too). |
| `src/main/services/sessionDaemonClient.ts` | Main-process client: spawns the daemon if needed, connects/reconnects to its socket, sends requests, re-broadcasts its events to the renderer via `webContents.send`. |
| `src/renderer/store/sessionStore.ts` | Renderer zustand store holding live `Record<cardId, SessionSnapshot>`. Transient — never persisted, never part of `docStore`'s undo history. |
| `src/renderer/components/card/SessionStatusBadge.tsx` | Small status icon for the collapsed card. |
| `src/renderer/components/card/SessionChecklist.tsx` | The inline-expansion checklist. |
| `src/renderer/components/card/CardViewDialog.tsx` | The new title-click destination: read-only details + Run/Stop/reply/approve controls + transcript. Has its own Edit button that opens the existing `CardComposerDialog`. |
| `src/renderer/components/card/SessionTranscript.tsx` | Renders a `SessionSnapshot`'s checklist/messages inside `CardViewDialog`. |

### Modified

| Path | Change |
|---|---|
| `.erb/configs/webpack.config.main.dev.ts` | Add a `daemon` entry alongside `main`/`preload`. |
| `.erb/configs/webpack.config.main.prod.ts` | Same, for the production build. |
| `package.json` | Add `@anthropic-ai/claude-agent-sdk` to `dependencies`. |
| `release/app/package.json` | Add `@anthropic-ai/claude-agent-sdk` to `dependencies` too — this is what makes webpack treat it as an `external` (see `webpack.config.base.ts`'s `externals` list) instead of trying to statically bundle an SDK we don't need to inline, and what makes `electron-builder`/`link-modules` install it into the packaged app later. |
| `src/shared/schema.ts` | Add `sessionTool`, `sessionRepo`, `sessionId` to `CardSchema`; add `defaultRepo` to `BoardSchema`. |
| `src/shared/ipc.ts` | Add `session:*` channels. |
| `src/main/preload.ts` | Expose `api.session.*`. |
| `src/main/main.ts` | Wire `sessionDaemonClient` lifecycle (start on first use, stop-watching on window close — but never kill the daemon itself). |
| `src/renderer/preload.d.ts` | No change needed (already re-exports `ElectronApi` from `preload.ts`). |
| `src/renderer/lib/api.ts` | No change needed (already a thin re-export). |
| `src/renderer/store/docStore.ts` | Add `setCardSessionOverrides`, `setCardSessionId`, `setBoardDefaultRepo` actions. |
| `src/renderer/components/card/PromptCard.tsx` | Render `SessionStatusBadge`; render `SessionChecklist` inside the expanded accordion; title click opens `CardViewDialog` instead of `CardComposerDialog` directly. |
| `src/renderer/components/card/CardComposerDialog.tsx` | Add a repo-override field and a "Run" affordance is *not* added here — Run lives in `CardViewDialog` per the spec. Add the session-repo field only. |
| `src/renderer/components/board/BoardView.tsx` | Add a "Default repo" control in the board header, next to the board name. |

---

## Milestone A — Daemon foundation

### Task 1: Daemon process scaffolding, build wiring, and the socket protocol

This task proves the daemon can be built, spawned detached, and survive the Electron app closing — with no Agent SDK involved yet, just an echo server. Getting the process lifecycle right first, before adding the SDK, isolates the one part of this feature with no precedent anywhere else in this codebase.

**Files:**
- Create: `src/shared/daemonProtocol.ts`
- Create: `src/main/daemon/framing.ts`
- Create: `src/main/daemon/index.ts`
- Create: `src/main/services/sessionDaemonClient.ts`
- Modify: `.erb/configs/webpack.config.main.dev.ts`
- Modify: `.erb/configs/webpack.config.main.prod.ts`
- Modify: `src/main/main.ts`
- Test: `src/__tests__/daemonFraming.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task of this plan).
- Produces:
  - `encodeFrame(obj: unknown): string` and `createFrameDecoder(onMessage: (obj: unknown) => void): (chunk: Buffer | string) => void` from `@/main/daemon/framing` (also usable from `src/main/daemon/index.ts` via a relative import, since the daemon is outside the `@/*` renderer alias — see Step 3).
  - `type DaemonRequest`, `type DaemonEvent`, `type SessionStatus`, `interface ChecklistItem`, `interface SessionSnapshot` from `@shared/daemonProtocol`.
  - `getSessionDaemonSocketPath(): string`, `ensureDaemonRunning(): Promise<void>`, `sendDaemonRequest(request: DaemonRequest): Promise<void>`, `subscribeDaemonEvents(onEvent: (event: DaemonEvent) => void): () => void` from `src/main/services/sessionDaemonClient.ts`. Later tasks (2, and the renderer-facing IPC registration) call these.

- [ ] **Step 1: Verify and install the Agent SDK**

```bash
npm view @anthropic-ai/claude-agent-sdk version
npm i @anthropic-ai/claude-agent-sdk
```

In `release/app/package.json`, add the exact same version to `dependencies` (currently `{}`):

```json
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "<the version npm view just printed, with a leading ^>"
  }
```

This isn't used until Task 2, but doing it now means Task 1's build-wiring steps are tested against the real `externals` list this dependency will produce, not a smaller one.

- [ ] **Step 2: Write the shared protocol types**

Create `src/shared/daemonProtocol.ts`. Note this file is imported by three different runtimes (daemon, main, renderer) and must never import anything Electron- or Node-specific itself.

```ts
export type SessionStatus = 'working' | 'waiting' | 'done' | 'failed';

export interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export interface PendingApproval {
  requestId: string;
  toolName: string;
  input: unknown;
}

export interface SessionSnapshot {
  cardId: string;
  sessionId: string | null;
  status: SessionStatus;
  checklist: ChecklistItem[];
  pendingApproval: PendingApproval | null;
  lastError: string | null;
}

export type DaemonRequest =
  | { op: 'run'; cardId: string; prompt: string; cwd: string }
  | { op: 'reply'; cardId: string; text: string }
  | {
      op: 'approve';
      cardId: string;
      requestId: string;
      decision: 'allow' | 'deny';
      message?: string;
    }
  | { op: 'stop'; cardId: string }
  | { op: 'getState'; cardId: string }
  | { op: 'ping' };

/**
 * The daemon always emits the FULL current snapshot on any change, never an
 * incremental delta — the same "whole document, not a diff" philosophy this
 * app's own data file already uses. Simpler consumer logic (replace, don't
 * merge) at the cost of resending the checklist on every change; the payload
 * is small enough that this is free.
 */
export type DaemonEvent =
  | { event: 'snapshot'; snapshot: SessionSnapshot }
  | { event: 'pong' };
```

- [ ] **Step 3: Write the NDJSON framing helpers**

Create `src/main/daemon/framing.ts`. Both the daemon and the client send whole JSON objects over a byte stream (a Unix socket), which has no message boundaries of its own — newline-delimited JSON is the simplest correct framing, and is the same convention `stream-json` output already uses elsewhere in this ecosystem.

```ts
export function encodeFrame(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}

/**
 * Returns a function you feed raw chunks into as they arrive; it buffers
 * partial lines across chunks and calls `onMessage` once per complete,
 * parsed JSON line. A line that fails to parse is dropped rather than
 * throwing — a partial write from a crashed peer should not take down the
 * reader.
 */
export function createFrameDecoder(
  onMessage: (obj: unknown) => void,
): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) {
        try {
          onMessage(JSON.parse(line));
        } catch {
          // Drop malformed lines; see doc comment above.
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  };
}
```

- [ ] **Step 4: Write the failing framing test**

Create `src/__tests__/daemonFraming.test.ts`.

```ts
import {
  encodeFrame,
  createFrameDecoder,
} from '../main/daemon/framing';

describe('daemon framing', () => {
  it('round-trips a single object', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    decode(encodeFrame({ hello: 'world' }));
    expect(received).toEqual([{ hello: 'world' }]);
  });

  it('handles a message split across two chunks', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    const frame = encodeFrame({ a: 1, b: 2 });
    const splitAt = Math.floor(frame.length / 2);
    decode(frame.slice(0, splitAt));
    decode(frame.slice(splitAt));
    expect(received).toEqual([{ a: 1, b: 2 }]);
  });

  it('handles two messages arriving in one chunk', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    decode(encodeFrame({ n: 1 }) + encodeFrame({ n: 2 }));
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('drops a malformed line without throwing', () => {
    const received: unknown[] = [];
    const decode = createFrameDecoder((obj) => received.push(obj));
    expect(() => decode(`not json\n${encodeFrame({ ok: true })}`)).not.toThrow();
    expect(received).toEqual([{ ok: true }]);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails, then verify it passes**

Run: `npx jest src/__tests__/daemonFraming.test.ts`
Expected first: FAIL — `Cannot find module '../main/daemon/framing'`.

Create the file from Step 3, then run again.
Expected: PASS, 4 tests.

- [ ] **Step 6: Write the daemon's own entry point**

Create `src/main/daemon/index.ts`. This step only wires the socket server and an echo/ping handler — Task 2 adds the Agent SDK. Note the daemon is a standalone Node script, not a renderer or main-process module, so it uses relative imports for `framing.ts` and imports `@shared/daemonProtocol` the same way `src/main/*` files already do (the `@shared/*` tsconfig path alias resolves for any file under `src/`, not just the renderer).

```ts
import net from 'net';
import fs from 'fs';
import { createFrameDecoder, encodeFrame } from './framing';
import type { DaemonRequest, DaemonEvent } from '@shared/daemonProtocol';

const socketPath = process.argv[2];
if (!socketPath) {
  // eslint-disable-next-line no-console
  console.error('daemon: no socket path given (expected argv[2])');
  process.exit(1);
}

// A stale socket file from a previous run that did not exit cleanly would
// otherwise make `net.createServer().listen()` fail with EADDRINUSE.
if (fs.existsSync(socketPath)) {
  fs.unlinkSync(socketPath);
}

function send(socket: net.Socket, event: DaemonEvent): void {
  socket.write(encodeFrame(event));
}

const server = net.createServer((socket) => {
  const decode = createFrameDecoder((raw) => {
    const request = raw as DaemonRequest;
    if (request.op === 'ping') {
      send(socket, { event: 'pong' });
    }
    // Task 2 adds handling for 'run' | 'reply' | 'approve' | 'stop' | 'getState'.
  });
  socket.on('data', decode);
});

server.listen(socketPath, () => {
  // eslint-disable-next-line no-console
  console.log(`daemon: listening on ${socketPath}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
```

- [ ] **Step 7: Add the daemon build entry to both main webpack configs**

In `.erb/configs/webpack.config.main.dev.ts`, change the `entry` block to:

```ts
  entry: {
    main: path.join(webpackPaths.srcMainPath, 'main.ts'),
    preload: path.join(webpackPaths.srcMainPath, 'preload.ts'),
    daemon: path.join(webpackPaths.srcMainPath, 'daemon/index.ts'),
  },
```

In `.erb/configs/webpack.config.main.prod.ts`, the exact same change to its `entry` block.

- [ ] **Step 8: Write the main-process daemon client**

Create `src/main/services/sessionDaemonClient.ts`. This is the only file in the main process that touches the socket — everything else, including the IPC handlers Task 4 registers, goes through the functions here.

```ts
import net from 'net';
import path from 'path';
import { app } from 'electron';
import { spawn } from 'child_process';
import { createFrameDecoder, encodeFrame } from '../daemon/framing';
import type { DaemonRequest, DaemonEvent } from '@shared/daemonProtocol';

export function getSessionDaemonSocketPath(): string {
  return path.join(app.getPath('userData'), 'session-daemon.sock');
}

function getDaemonBundlePath(): string {
  return app.isPackaged
    ? path.join(__dirname, 'daemon.js')
    : path.join(__dirname, '../../.erb/dll/daemon.bundle.dev.js');
}

let client: net.Socket | null = null;
const eventListeners = new Set<(event: DaemonEvent) => void>();

function connect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * Spawns the daemon if it is not already listening, then connects. Safe to
 * call every time a session operation is needed — a daemon that is already
 * running (because it was left running by a previous app launch, per the
 * spec's cross-restart persistence requirement) is detected by a successful
 * connect and reused rather than re-spawned.
 */
export async function ensureDaemonRunning(): Promise<void> {
  if (client && !client.destroyed) return;

  const socketPath = getSessionDaemonSocketPath();

  try {
    client = await connect(socketPath);
  } catch {
    // No daemon listening yet (or a stale socket file) — spawn one.
    const child = spawn(
      process.execPath,
      [getDaemonBundlePath(), socketPath],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: true,
        stdio: 'ignore',
      },
    );
    child.unref();

    // Give the daemon a moment to create the socket before connecting.
    await new Promise((resolve) => setTimeout(resolve, 500));
    client = await connect(socketPath);
  }

  const decode = createFrameDecoder((raw) => {
    const event = raw as DaemonEvent;
    eventListeners.forEach((listener) => listener(event));
  });
  client.on('data', decode);
  client.on('close', () => {
    client = null;
  });
}

export async function sendDaemonRequest(request: DaemonRequest): Promise<void> {
  await ensureDaemonRunning();
  client?.write(encodeFrame(request));
}

export function subscribeDaemonEvents(
  onEvent: (event: DaemonEvent) => void,
): () => void {
  eventListeners.add(onEvent);
  return () => eventListeners.delete(onEvent);
}
```

- [ ] **Step 9: Wire a startup ping into `main.ts` (proves the whole path end to end)**

In `src/main/main.ts`, add the import `import { ensureDaemonRunning, sendDaemonRequest, subscribeDaemonEvents } from './services/sessionDaemonClient';` near the other service imports. Task 4 wires the real IPC handlers that call these; for this task, add nothing else to `main.ts` yet — the verification step below exercises the client directly.

- [ ] **Step 10: Verify the daemon builds, spawns, and survives**

Run: `npx tsc --noEmit` — expect clean (this also validates the `@shared/daemonProtocol` import resolves from within `src/main/daemon/`).

Run: `npx jest` — expect the new framing suite plus every existing suite to pass, no regressions.

Run `npm run prestart` (this builds `webpack.config.main.dev.ts`, the config Step 7 just added the `daemon` entry to — note this is a *different* build step from `npm run build:dll`, which only ever builds the renderer's separate dev DLL and has no bearing on `main`/`preload`/`daemon`):

```bash
npm run prestart
```

Expected: exits 0, and `ls .erb/dll/daemon.bundle.dev.js` shows the new bundle exists.

Then verify the spawn/reconnect/survive behavior directly, without launching the full Electron app (per the no-boot-check constraint) — write a throwaway Node script in the scratchpad, not committed to the repo:

```bash
node -e "
const { ensureDaemonRunning, sendDaemonRequest, subscribeDaemonEvents } = require('./.erb/dll/main.bundle.dev.js');
" 2>&1 | head -5
```

This particular invocation will fail (the main bundle isn't a standalone-requirable module — it runs Electron's `app` singleton), so instead verify end-to-end via the actual daemon bundle directly, which IS a plain Node script:

```bash
SOCK=/tmp/ai-kanban-daemon-test.sock
rm -f "$SOCK"
node .erb/dll/daemon.bundle.dev.js "$SOCK" &
DAEMON_PID=$!
sleep 1
node -e "
const net = require('net');
const s = net.createConnection({ path: process.argv[1] }, () => {
  s.write(JSON.stringify({ op: 'ping' }) + '\n');
});
s.on('data', (d) => { console.log('received:', d.toString().trim()); process.exit(0); });
" "$SOCK"
kill $DAEMON_PID
```

Expected: prints `received: {"event":"pong"}`. This proves the daemon starts, listens, frames correctly, and responds — the exact mechanics `sessionDaemonClient.ts` relies on.

Report the daemon build/spawn verification output, the jest/tsc results, and confirm no leftover `daemon` or `node` processes remain (`ps aux | grep ai-kanban` should show nothing related after the `kill`).

---

### Task 2: Agent SDK integration in the daemon

**Files:**
- Modify: `src/main/daemon/index.ts`
- Test: `src/__tests__/daemonChecklist.test.ts` (pure-logic test of the checklist/status derivation, with the SDK mocked)

**Interfaces:**
- Consumes: `DaemonRequest`, `DaemonEvent`, `SessionSnapshot`, `ChecklistItem`, `SessionStatus` from `@shared/daemonProtocol` (Task 1). `encodeFrame`/`createFrameDecoder` from `./framing` (Task 1).
- Produces: the daemon now actually runs Agent SDK sessions. No new exported functions (the daemon is a standalone process, not a library another task imports) — but the `deriveChecklistUpdate` pure function below is written in its own file specifically so Task 2's own test can import it without spinning up a socket server.

- [ ] **Step 1: Extract the pure checklist/status derivation logic first, and write its failing test**

Rather than burying this logic inline in the socket handler (where it would be untestable without a live SDK call), pull it into its own pure function in a new file, `src/main/daemon/deriveSessionUpdate.ts`, so it can be unit tested with fixture SDK messages.

Create `src/__tests__/daemonChecklist.test.ts`:

```ts
import {
  deriveSessionUpdate,
  createInitialSnapshot,
} from '../main/daemon/deriveSessionUpdate';

describe('deriveSessionUpdate', () => {
  const base = () => createInitialSnapshot('crd_1');

  it('starts in the working state with an empty checklist', () => {
    const snapshot = base();
    expect(snapshot.status).toBe('working');
    expect(snapshot.checklist).toEqual([]);
  });

  it('adds a checklist item for a tool_use message and marks it done immediately', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'auth.py' } }],
      },
    });
    expect(snapshot.checklist).toEqual([
      { id: 'tu_1', label: 'Read: auth.py', done: true },
    ]);
    expect(snapshot.status).toBe('working');
  });

  it('falls back to the tool name alone when no recognizable input field exists', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_2', name: 'WebSearch', input: { query: 'foo' } }],
      },
    });
    expect(snapshot.checklist[0].label).toBe('WebSearch');
  });

  it('captures the session id from a system init message', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'system',
      subtype: 'init',
      session_id: 'sess_abc',
    });
    expect(snapshot.sessionId).toBe('sess_abc');
  });

  it('marks the session done on a successful result message', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'result',
      subtype: 'success',
      session_id: 'sess_abc',
    });
    expect(snapshot.status).toBe('done');
  });

  it('marks the session failed on an error result message, keeping lastError', () => {
    const snapshot = deriveSessionUpdate(base(), {
      type: 'result',
      subtype: 'error_max_turns',
      session_id: 'sess_abc',
    });
    expect(snapshot.status).toBe('failed');
    expect(snapshot.lastError).toBe('error_max_turns');
  });

  it('does not duplicate a checklist item for the same tool_use id seen twice', () => {
    let snapshot = base();
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: 'a.py' } }],
      },
    };
    snapshot = deriveSessionUpdate(snapshot, msg);
    snapshot = deriveSessionUpdate(snapshot, msg);
    expect(snapshot.checklist).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/__tests__/daemonChecklist.test.ts`
Expected: FAIL — `Cannot find module '../main/daemon/deriveSessionUpdate'`.

- [ ] **Step 3: Write `deriveSessionUpdate.ts`**

Create `src/main/daemon/deriveSessionUpdate.ts`.

The exact runtime shape of `SDKMessage` from `@anthropic-ai/claude-agent-sdk` should be checked against the version actually installed (`node -e "console.log(Object.keys(require('@anthropic-ai/claude-agent-sdk')))"` and the package's own `.d.ts` files under `node_modules/@anthropic-ai/claude-agent-sdk` are the source of truth) before trusting the field names below — the shape here matches the SDK's documented `SDKMessage` union (`system`/`assistant`/`result`, with tool-use content blocks nested under `message.message.content`) as of this plan's writing, but the SDK is young enough that this is the one place in this task worth double-checking against the installed version rather than assuming.

```ts
import type { SessionSnapshot, ChecklistItem } from '@shared/daemonProtocol';

export function createInitialSnapshot(cardId: string): SessionSnapshot {
  return {
    cardId,
    sessionId: null,
    status: 'working',
    checklist: [],
    pendingApproval: null,
    lastError: null,
  };
}

// Each tool has a different "primary" input field worth surfacing in a
// one-line label; anything not listed here just shows the tool's name.
const LABEL_FIELD: Record<string, string> = {
  Read: 'file_path',
  Edit: 'file_path',
  Write: 'file_path',
  Bash: 'command',
};

function toolUseLabel(name: string, input: unknown): string {
  const field = LABEL_FIELD[name];
  const value =
    field && typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)[field]
      : undefined;
  return typeof value === 'string' ? `${name}: ${value}` : name;
}

/**
 * Folds one incoming SDK message into the current snapshot, returning a new
 * snapshot (never mutates its input — callers hold the previous snapshot in
 * a map and replace it, same immutable-update shape as the rest of this
 * app's stores).
 */
export function deriveSessionUpdate(
  current: SessionSnapshot,
  // Deliberately `unknown`-shaped rather than importing the SDK's own
  // message type here: this function's contract is "whatever the SDK
  // yields," and pinning an exact imported type would make this file (and
  // its test) depend on the SDK being installed to type-check at all.
  message: {
    type: string;
    subtype?: string;
    session_id?: string;
    message?: { content?: Array<Record<string, unknown>> };
  },
): SessionSnapshot {
  if (message.type === 'system' && message.subtype === 'init') {
    return { ...current, sessionId: message.session_id ?? current.sessionId };
  }

  if (message.type === 'assistant') {
    const toolUseBlocks = (message.message?.content ?? []).filter(
      (block) => block.type === 'tool_use',
    );
    if (toolUseBlocks.length === 0) return current;

    const existingIds = new Set(current.checklist.map((item) => item.id));
    const newItems: ChecklistItem[] = toolUseBlocks
      .filter((block) => !existingIds.has(block.id as string))
      .map((block) => ({
        id: block.id as string,
        label: toolUseLabel(block.name as string, block.input),
        done: true,
      }));

    if (newItems.length === 0) return current;
    return { ...current, checklist: [...current.checklist, ...newItems] };
  }

  if (message.type === 'result') {
    const sessionId = message.session_id ?? current.sessionId;
    if (message.subtype === 'success') {
      return { ...current, status: 'done', sessionId, lastError: null };
    }
    return {
      ...current,
      status: 'failed',
      sessionId,
      lastError: message.subtype ?? 'unknown error',
    };
  }

  return current;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/__tests__/daemonChecklist.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire the real Agent SDK into `index.ts`**

Replace the request-handling body of `src/main/daemon/index.ts` (from Task 1) with the full session-management logic:

```ts
import net from 'net';
import fs from 'fs';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createFrameDecoder, encodeFrame } from './framing';
import {
  createInitialSnapshot,
  deriveSessionUpdate,
} from './deriveSessionUpdate';
import type {
  DaemonRequest,
  DaemonEvent,
  SessionSnapshot,
} from '@shared/daemonProtocol';

const socketPath = process.argv[2];
if (!socketPath) {
  // eslint-disable-next-line no-console
  console.error('daemon: no socket path given (expected argv[2])');
  process.exit(1);
}
if (fs.existsSync(socketPath)) {
  fs.unlinkSync(socketPath);
}

interface Session {
  snapshot: SessionSnapshot;
  abortController: AbortController;
  pendingApprovalResolve:
    | ((decision: { behavior: 'allow' | 'deny'; updatedInput?: unknown; message?: string }) => void)
    | null;
}

const sessions = new Map<string, Session>();
const sockets = new Set<net.Socket>();

function broadcast(event: DaemonEvent): void {
  const frame = encodeFrame(event);
  sockets.forEach((socket) => socket.write(frame));
}

function updateSnapshot(
  cardId: string,
  updater: (snapshot: SessionSnapshot) => SessionSnapshot,
): void {
  const session = sessions.get(cardId);
  if (!session) return;
  session.snapshot = updater(session.snapshot);
  broadcast({ event: 'snapshot', snapshot: session.snapshot });
}

/**
 * Runs one turn (a fresh conversation, or a reply into an existing one via
 * `resume`) to completion, folding every yielded message into the card's
 * snapshot as it arrives. This is a fire-and-forget async function — the
 * socket handler below calls it and returns immediately; progress is
 * reported entirely through `broadcast`.
 */
async function runTurn(
  cardId: string,
  prompt: string,
  options: { cwd?: string; resume?: string },
): Promise<void> {
  const abortController = new AbortController();
  const existing = sessions.get(cardId);
  const snapshot = existing?.snapshot ?? createInitialSnapshot(cardId);
  sessions.set(cardId, {
    snapshot: { ...snapshot, status: 'working', lastError: null },
    abortController,
    pendingApprovalResolve: null,
  });
  broadcast({ event: 'snapshot', snapshot: sessions.get(cardId)!.snapshot });

  // Checked here, not just left to the SDK's own failure, per the spec's
  // error-handling section: a missing working directory should surface a
  // specific, immediate message rather than whatever generic error the SDK
  // happens to throw for it.
  if (options.cwd && !fs.existsSync(options.cwd)) {
    updateSnapshot(cardId, (s) => ({
      ...s,
      status: 'failed',
      lastError: `Working directory does not exist: ${options.cwd}`,
    }));
    return;
  }

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd: options.cwd,
        resume: options.resume,
        abortController,
        allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch'],
        permissionMode: 'default',
        canUseTool: async (toolName, input, { signal }) => {
          if (signal.aborted) return { behavior: 'deny', message: 'Session stopped' };
          const requestId = `${cardId}-${Date.now()}`;
          updateSnapshot(cardId, (s) => ({
            ...s,
            status: 'waiting',
            pendingApproval: { requestId, toolName, input },
          }));
          return new Promise((resolve) => {
            const session = sessions.get(cardId);
            if (session) session.pendingApprovalResolve = resolve;
          });
        },
      },
    })) {
      updateSnapshot(cardId, (s) => deriveSessionUpdate(s, message as never));
    }
  } catch (error) {
    updateSnapshot(cardId, (s) => ({
      ...s,
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
    }));
  }
}

const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));

  const decode = createFrameDecoder((raw) => {
    const request = raw as DaemonRequest;

    if (request.op === 'ping') {
      socket.write(encodeFrame({ event: 'pong' }));
      return;
    }

    if (request.op === 'run') {
      void runTurn(request.cardId, request.prompt, { cwd: request.cwd });
      return;
    }

    if (request.op === 'reply') {
      const session = sessions.get(request.cardId);
      void runTurn(request.cardId, request.text, {
        resume: session?.snapshot.sessionId ?? undefined,
      });
      return;
    }

    if (request.op === 'approve') {
      const session = sessions.get(request.cardId);
      if (session?.pendingApprovalResolve) {
        session.pendingApprovalResolve(
          request.decision === 'allow'
            ? { behavior: 'allow' }
            : { behavior: 'deny', message: request.message ?? 'Denied by user' },
        );
        session.pendingApprovalResolve = null;
        updateSnapshot(request.cardId, (s) => ({
          ...s,
          status: 'working',
          pendingApproval: null,
        }));
      }
      return;
    }

    if (request.op === 'stop') {
      sessions.get(request.cardId)?.abortController.abort();
      return;
    }

    if (request.op === 'getState') {
      const session = sessions.get(request.cardId);
      if (session) {
        socket.write(encodeFrame({ event: 'snapshot', snapshot: session.snapshot }));
      }
    }
  });

  socket.on('data', decode);
});

server.listen(socketPath, () => {
  // eslint-disable-next-line no-console
  console.log(`daemon: listening on ${socketPath}`);
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit` — expect clean. If the Agent SDK's actual exported types disagree with the `query`/`canUseTool` shapes above, fix the code to match what's actually exported (check `node_modules/@anthropic-ai/claude-agent-sdk/**/*.d.ts`), not the other way around — the shapes in this task were written from documentation, not the installed package.

Run: `npx jest` — expect all suites, including both new ones from Tasks 1 and 2, to pass with no regressions.

- [ ] **Step 7: Verify a real session end to end (the one place this plan asks for a live API call)**

This is the one genuinely un-automatable-any-other-way check in this whole plan: everything else can be verified with mocks and pure-function tests, but "does the real SDK actually do what the docs say" needs one real call. Do this once, manually, from the scratchpad (not as a committed test, and not requiring the full Electron app):

```bash
mkdir -p /tmp/ai-kanban-session-test
cd /tmp/ai-kanban-session-test && git init -q && echo "# test" > README.md
```

Then, from the repo root, rebuild and rerun the daemon smoke test from Task 1 Step 10, but send a real `run` request instead of `ping`:

```bash
npm run prestart
SOCK=/tmp/ai-kanban-daemon-test2.sock
rm -f "$SOCK"
node .erb/dll/daemon.bundle.dev.js "$SOCK" &
DAEMON_PID=$!
sleep 1
node -e "
const net = require('net');
const s = net.createConnection({ path: process.argv[1] }, () => {
  s.write(JSON.stringify({ op: 'run', cardId: 'test', prompt: 'Create a file named hello.txt containing the word hello, then stop.', cwd: '/tmp/ai-kanban-session-test' }) + '\n');
});
let buf = '';
s.on('data', (d) => {
  buf += d.toString();
  const lines = buf.split('\n').filter(Boolean);
  lines.forEach((l) => console.log(l));
  if (buf.includes('\"status\":\"done\"')) process.exit(0);
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 60000);
" "$SOCK"
kill $DAEMON_PID
cat /tmp/ai-kanban-session-test/hello.txt
rm -rf /tmp/ai-kanban-session-test "$SOCK"
```

Expected: a sequence of `snapshot` events ending in `"status":"done"`, a checklist containing a `Write` (or `Bash`) entry, and `hello.txt` actually created with the expected content. This requires Claude Code to be authenticated in this environment already (the same credentials the `claude` CLI itself uses) — if it fails with an auth error, report that plainly rather than treating it as a code bug.

Report the full event sequence observed, confirm `hello.txt`'s contents, and confirm both temp paths were cleaned up.

---

## Milestone B — Data model

### Task 3: Schema and store additions

**Files:**
- Modify: `src/shared/schema.ts`
- Modify: `src/renderer/store/docStore.ts`
- Test: `src/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: nothing new from Tasks 1–2.
- Produces:
  - `Card.sessionTool: 'claude' | null`, `Card.sessionRepo: string | null`, `Card.sessionId: string | null` on the `Card` type from `@shared/schema`.
  - `Board.defaultRepo: string | null` on the `Board` type from `@shared/schema`.
  - `NewCardFields.sessionRepo?: string | null` and `addCard`'s handling of it, on `useDocStore`.
  - Store actions: `setCardSessionRepo(boardId, listId, cardId, repo: string | null): void`, `setCardSessionId(boardId, listId, cardId, sessionId: string | null): void`, `setBoardDefaultRepo(boardId, repo: string | null): void` on `useDocStore`.

- [ ] **Step 1: Extend the schema**

In `src/shared/schema.ts`, add to `CardSchema` (after the existing `priority` field):

```ts
  // All three are session-related, all optional/nullable — a card that has
  // never had a session looks exactly as it did before this feature.
  // sessionTool exists for forward compatibility with a future second
  // driver; today it is only ever 'claude' or null, and no UI offers any
  // other choice.
  sessionTool: z.enum(['claude']).nullable().catch(null),
  sessionRepo: z.string().nullable().catch(null),
  sessionId: z.string().nullable().catch(null),
```

Add to `BoardSchema` (after `lists`):

```ts
  defaultRepo: z.string().nullable().catch(null),
```

- [ ] **Step 2: Update the schema fixture test to cover the new fields' tolerance**

In `src/__tests__/schema.test.ts`, add a new test alongside the existing `parseDoc` tests (the existing fixture file `src/__tests__/fixtures/kanban-v1.json` already omits these fields entirely, which is exactly what proves `.catch(null)` tolerance — no fixture edit needed):

```ts
  it('defaults the new session fields on both cards and boards', () => {
    const result = parseDoc(fixture);
    if (!result.ok) throw new Error(result.error);
    const card = result.doc.boards[0].lists[0].cards[0];
    expect(card.sessionTool).toBeNull();
    expect(card.sessionRepo).toBeNull();
    expect(card.sessionId).toBeNull();
    expect(result.doc.boards[0].defaultRepo).toBeNull();
  });
```

- [ ] **Step 3: Run the test to verify it fails, then passes**

Run: `npx jest src/__tests__/schema.test.ts`
Expected first: FAIL (new fields don't exist on the parsed type/schema yet — TypeScript or the assertion will fail depending on where you are in Step 1; if you did Step 1 first, this runs green immediately, which is fine here since the fixture-tolerance behavior is what's under test, not new production code needing a red phase).
Expected after Step 1: PASS, along with every other existing test in the file.

- [ ] **Step 4: Extend `NewCardFields` and `addCard` so a repo override can be set at creation time**

In `src/renderer/store/docStore.ts`, add `sessionRepo?: string | null;` to the `NewCardFields` interface (alongside the existing `priority?: Priority | null;`). Then, in `addCard`'s implementation, add `sessionRepo: fields.sessionRepo ?? null,` and `sessionTool: null,` and `sessionId: null,` to the object pushed onto `list.cards` (alongside the existing `priority: fields.priority ?? null,` line) — a brand-new card always starts with no session, but Task 8's composer field needs `sessionRepo` to actually land if set before the first save.

- [ ] **Step 5: Add the store actions**

In `src/renderer/store/docStore.ts`, add to the `DocStore` interface:

```ts
  setCardSessionRepo: (
    boardId: string,
    listId: string,
    cardId: string,
    repo: string | null,
  ) => void;
  setCardSessionId: (
    boardId: string,
    listId: string,
    cardId: string,
    sessionId: string | null,
  ) => void;
  setBoardDefaultRepo: (boardId: string, repo: string | null) => void;
```

Add the implementations (near `deleteCard`/`recordCopy`):

```ts
  setCardSessionRepo: (boardId, listId, cardId, repo) => {
    get().mutate((draft) => {
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (card) card.sessionRepo = repo;
    });
  },

  // Deliberately does not go through the normal `mutate`/`commit` path's
  // usual intent: this is written by the app itself when a session starts,
  // not a user edit, but it still needs to be a real document field so it
  // survives a relaunch (the daemon-reattach flow in Task 9 looks it up per
  // card). It still participates in undo like any other field — undoing
  // back past "Run" is expected to forget which session a card was on, the
  // same way undoing past a rename forgets the rename.
  setCardSessionId: (boardId, listId, cardId, sessionId) => {
    get().mutate((draft) => {
      const card = draft.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId);
      if (card) card.sessionId = sessionId;
    });
  },

  setBoardDefaultRepo: (boardId, repo) => {
    get().mutate((draft) => {
      const board = draft.boards.find((b) => b.id === boardId);
      if (board) board.defaultRepo = repo;
    });
  },
```

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx jest` — expect all suites to pass, including the updated schema test.

---

## Milestone C — Renderer plumbing and UI

### Task 4: IPC surface and the renderer session store

**Files:**
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`
- Create: `src/renderer/store/sessionStore.ts`
- Test: `src/__tests__/sessionStore.test.ts`

**Interfaces:**
- Consumes: `sendDaemonRequest`, `subscribeDaemonEvents`, `ensureDaemonRunning` from `src/main/services/sessionDaemonClient` (Task 1). `DaemonEvent`, `SessionSnapshot` from `@shared/daemonProtocol` (Task 1).
- Produces:
  - `api.session.run(cardId, prompt, cwd)`, `api.session.reply(cardId, text)`, `api.session.approve(cardId, requestId, decision, message?)`, `api.session.stop(cardId)`, `api.session.getState(cardId)`, `api.session.onSnapshot(cb: (snapshot: SessionSnapshot) => void): () => void` from `@/lib/api`.
  - `useSessionStore` (zustand) with state `{ sessions: Record<string, SessionSnapshot> }` and no persistence — a fresh app launch starts with an empty map until the reattach flow (Task 9) or a subscription populates it.

- [ ] **Step 1: Add the IPC channels**

In `src/shared/ipc.ts`, add to `CHANNELS`:

```ts
  sessionRun: 'session:run',
  sessionReply: 'session:reply',
  sessionApprove: 'session:approve',
  sessionStop: 'session:stop',
  sessionGetState: 'session:get-state',
  sessionSnapshot: 'session:snapshot',
```

- [ ] **Step 2: Register the handlers in `main.ts`**

In `src/main/main.ts`, alongside the existing `registerIpc(...)` call, add:

```ts
import { ipcMain } from 'electron';
import {
  sendDaemonRequest,
  subscribeDaemonEvents,
} from './services/sessionDaemonClient';
import { CHANNELS } from '../shared/ipc';

ipcMain.handle(CHANNELS.sessionRun, (_e, cardId: string, prompt: string, cwd: string) =>
  sendDaemonRequest({ op: 'run', cardId, prompt, cwd }),
);
ipcMain.handle(CHANNELS.sessionReply, (_e, cardId: string, text: string) =>
  sendDaemonRequest({ op: 'reply', cardId, text }),
);
ipcMain.handle(
  CHANNELS.sessionApprove,
  (_e, cardId: string, requestId: string, decision: 'allow' | 'deny', message?: string) =>
    sendDaemonRequest({ op: 'approve', cardId, requestId, decision, message }),
);
ipcMain.handle(CHANNELS.sessionStop, (_e, cardId: string) =>
  sendDaemonRequest({ op: 'stop', cardId }),
);
ipcMain.handle(CHANNELS.sessionGetState, (_e, cardId: string) =>
  sendDaemonRequest({ op: 'getState', cardId }),
);

subscribeDaemonEvents((event) => {
  if (event.event !== 'snapshot') return;
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send(CHANNELS.sessionSnapshot, event.snapshot),
  );
});
```

(`BrowserWindow` and `ipcMain` are likely already imported in `main.ts` for other purposes — add to the existing `electron` import line rather than duplicating it if so.)

- [ ] **Step 3: Expose the API in `preload.ts`**

In `src/main/preload.ts`, add to the exposed `api` object:

```ts
  session: {
    run: (cardId: string, prompt: string, cwd: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionRun, cardId, prompt, cwd),
    reply: (cardId: string, text: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionReply, cardId, text),
    approve: (
      cardId: string,
      requestId: string,
      decision: 'allow' | 'deny',
      message?: string,
    ): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionApprove, cardId, requestId, decision, message),
    stop: (cardId: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionStop, cardId),
    getState: (cardId: string): Promise<void> =>
      ipcRenderer.invoke(CHANNELS.sessionGetState, cardId),
    onSnapshot: (callback: (snapshot: SessionSnapshot) => void): (() => void) => {
      const listener = (_e: unknown, snapshot: SessionSnapshot) => callback(snapshot);
      ipcRenderer.on(CHANNELS.sessionSnapshot, listener);
      return () => ipcRenderer.removeListener(CHANNELS.sessionSnapshot, listener);
    },
  },
```

Add `import type { SessionSnapshot } from '../shared/daemonProtocol';` to the top of the file.

- [ ] **Step 4: Write the failing session store test**

Create `src/__tests__/sessionStore.test.ts`.

```ts
import { useSessionStore } from '../renderer/store/sessionStore';
import type { SessionSnapshot } from '../shared/daemonProtocol';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    cardId: 'crd_1',
    sessionId: null,
    status: 'working',
    checklist: [],
    pendingApproval: null,
    lastError: null,
    ...overrides,
  };
}

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: {} });
  });

  it('starts with no sessions', () => {
    expect(useSessionStore.getState().sessions).toEqual({});
  });

  it('applySnapshot stores the snapshot keyed by cardId', () => {
    useSessionStore.getState().applySnapshot(snapshot());
    expect(useSessionStore.getState().sessions.crd_1).toEqual(snapshot());
  });

  it('applySnapshot replaces the whole entry, not a merge', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'working' }));
    useSessionStore
      .getState()
      .applySnapshot(snapshot({ status: 'done', checklist: [{ id: 'a', label: 'x', done: true }] }));
    expect(useSessionStore.getState().sessions.crd_1.status).toBe('done');
    expect(useSessionStore.getState().sessions.crd_1.checklist).toHaveLength(1);
  });

  it('clearSession removes a card entirely', () => {
    useSessionStore.getState().applySnapshot(snapshot());
    useSessionStore.getState().clearSession('crd_1');
    expect(useSessionStore.getState().sessions.crd_1).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx jest src/__tests__/sessionStore.test.ts`
Expected: FAIL — `Cannot find module '../renderer/store/sessionStore'`.

- [ ] **Step 6: Write the session store**

Create `src/renderer/store/sessionStore.ts`.

```ts
import { create } from 'zustand';
import type { SessionSnapshot } from '@shared/daemonProtocol';
import { api } from '@/lib/api';

interface SessionStore {
  sessions: Record<string, SessionSnapshot>;
  applySnapshot: (snapshot: SessionSnapshot) => void;
  clearSession: (cardId: string) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: {},

  applySnapshot: (snapshot) =>
    set((state) => ({
      sessions: { ...state.sessions, [snapshot.cardId]: snapshot },
    })),

  clearSession: (cardId) =>
    set((state) => {
      const next = { ...state.sessions };
      delete next[cardId];
      return { sessions: next };
    }),
}));

/**
 * Wires the main-process snapshot broadcast into this store. Call once,
 * from AppShell, the same lifecycle as `startPersistence()`.
 */
export function startSessionSubscription(): () => void {
  return api.session.onSnapshot((snapshot) => {
    useSessionStore.getState().applySnapshot(snapshot);
  });
}
```

- [ ] **Step 7: Run the test to verify it passes, then the full suite**

Run: `npx jest src/__tests__/sessionStore.test.ts` — expect PASS, 4 tests.
Run: `npx tsc --noEmit` and `npx jest` (full suite) — expect both clean.

---

### Task 5: Collapsed-card status badge

**Files:**
- Create: `src/renderer/components/card/SessionStatusBadge.tsx`
- Modify: `src/renderer/components/card/PromptCard.tsx`

**Interfaces:**
- Consumes: `useSessionStore` (Task 4), `SessionStatus` from `@shared/daemonProtocol` (Task 1).
- Produces: `SessionStatusBadge` with props `{ cardId: string }` — renders nothing if the card has no live session entry.

- [ ] **Step 1: Write `SessionStatusBadge`**

Create `src/renderer/components/card/SessionStatusBadge.tsx`. Visual language deliberately mirrors `PriorityIcon` (same size, same "icon + color + title-tooltip" shape) so the two indicators read as one consistent system rather than two competing ones.

```tsx
import { Loader2, CircleAlert, CircleCheck } from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';
import type { SessionStatus } from '@shared/daemonProtocol';

const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'Working',
  waiting: 'Waiting on input',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_COLOR: Record<SessionStatus, string> = {
  working: 'text-sky-500',
  waiting: 'text-amber-500',
  done: 'text-emerald-500',
  failed: 'text-destructive',
};

interface Props {
  cardId: string;
}

export function SessionStatusBadge({ cardId }: Props) {
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  if (!snapshot) return null;

  const label = STATUS_LABEL[snapshot.status];
  const Icon = snapshot.status === 'working' ? Loader2 : snapshot.status === 'done' ? CircleCheck : CircleAlert;

  return (
    <span title={label} className="inline-flex shrink-0">
      <Icon
        role="img"
        aria-label={label}
        className={`size-3.5 ${STATUS_COLOR[snapshot.status]} ${snapshot.status === 'working' ? 'animate-spin' : ''}`}
      />
    </span>
  );
}
```

- [ ] **Step 2: Render it on the card**

In `src/renderer/components/card/PromptCard.tsx`, add the import `import { SessionStatusBadge } from './SessionStatusBadge';` and render `<SessionStatusBadge cardId={cardId} />` in the header row, immediately after the existing `{card.priority ? <PriorityIcon .../> : null}` block and before the title `div` — status and priority sit side by side, in that order, both to the left of the title.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx jest` — expect no regressions (no new test file for this task; it's a thin render of already-tested store state, and there is no automated way to verify visual icon rendering in this project — consistent with how `PriorityIcon` itself was verified: by type-correctness and code review, not a screenshot).

---

### Task 6: Inline-expansion checklist

**Files:**
- Create: `src/renderer/components/card/SessionChecklist.tsx`
- Modify: `src/renderer/components/card/PromptCard.tsx`
- Test: `src/__tests__/sessionChecklist.test.tsx`

**Interfaces:**
- Consumes: `useSessionStore` (Task 4).
- Produces: `SessionChecklist` with props `{ cardId: string }` — renders nothing if there's no session for the card, otherwise a `✓`/`⧗` list.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/sessionChecklist.test.tsx`.

```tsx
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { SessionChecklist } from '../renderer/components/card/SessionChecklist';
import { useSessionStore } from '../renderer/store/sessionStore';

describe('SessionChecklist', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: {} });
  });

  it('renders nothing when the card has no session', () => {
    const { container } = render(<SessionChecklist cardId="crd_1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each checklist item with a check or hourglass', () => {
    useSessionStore.getState().applySnapshot({
      cardId: 'crd_1',
      sessionId: 's1',
      status: 'working',
      checklist: [
        { id: 'a', label: 'Read auth.py', done: true },
        { id: 'b', label: 'Ran npm test', done: false },
      ],
      pendingApproval: null,
      lastError: null,
    });
    render(<SessionChecklist cardId="crd_1" />);
    expect(screen.getByText('Read auth.py')).toBeInTheDocument();
    expect(screen.getByText('Ran npm test')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest src/__tests__/sessionChecklist.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `SessionChecklist`**

Create `src/renderer/components/card/SessionChecklist.tsx`.

```tsx
import { Check, Hourglass } from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';

interface Props {
  cardId: string;
}

export function SessionChecklist({ cardId }: Props) {
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  if (!snapshot || snapshot.checklist.length === 0) return null;

  return (
    <ul className="mt-2 flex flex-col gap-1 border-t border-dashed border-border pt-2 text-xs text-muted-foreground">
      {snapshot.checklist.map((item) => (
        <li key={item.id} className="flex items-center gap-1.5">
          {item.done ? (
            <Check className="size-3 shrink-0 text-emerald-500" />
          ) : (
            <Hourglass className="size-3 shrink-0" />
          )}
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest src/__tests__/sessionChecklist.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Render it in the expanded accordion**

In `src/renderer/components/card/PromptCard.tsx`, add the import `import { SessionChecklist } from './SessionChecklist';` and render `<SessionChecklist cardId={cardId} />` inside the `expanded ? (...) : null` block, after the existing `{card.notes ? (...) : null}` block and before the `Copy`/`Fill & copy` button.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` and `npx jest` — expect both clean, no regressions.

---

### Task 7: The View/Edit split — `CardViewDialog`

This is the largest UI task: it repurposes what title-click opens, without touching `CardComposerDialog` itself (Edit stays exactly as it is today).

**Files:**
- Create: `src/renderer/components/card/SessionTranscript.tsx`
- Create: `src/renderer/components/card/CardViewDialog.tsx`
- Modify: `src/renderer/components/card/PromptCard.tsx`

**Interfaces:**
- Consumes: `useSessionStore`, `useDocStore` (specifically `setCardSessionId`), `api.session.*` (Task 4). `CardComposerDialog` (existing, unmodified).
- Produces: `SessionTranscript` with props `{ cardId: string }`. `CardViewDialog` with props `{ open: boolean; onOpenChange: (open: boolean) => void; boardId: string; listId: string; cardId: string }`.

- [ ] **Step 1: Write `SessionTranscript`**

Create `src/renderer/components/card/SessionTranscript.tsx`. This is the fuller view used inside the modal — same underlying data as `SessionChecklist`, but also surfaces the pending-approval controls and any terminal error.

```tsx
import { Check, Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSessionStore } from '@/store/sessionStore';
import { api } from '@/lib/api';

interface Props {
  cardId: string;
}

export function SessionTranscript({ cardId }: Props) {
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  if (!snapshot) return null;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5 text-sm">
        {snapshot.checklist.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            {item.done ? (
              <Check className="size-3.5 shrink-0 text-emerald-500" />
            ) : (
              <Hourglass className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      {snapshot.pendingApproval ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm">
            Claude wants to run <span className="font-mono">{snapshot.pendingApproval.toolName}</span>:
          </p>
          <pre className="max-h-32 overflow-y-auto rounded bg-muted p-2 font-mono text-xs">
            {JSON.stringify(snapshot.pendingApproval.input, null, 2)}
          </pre>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                api.session.approve(cardId, snapshot.pendingApproval!.requestId, 'allow')
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() =>
                api.session.approve(cardId, snapshot.pendingApproval!.requestId, 'deny')
              }
            >
              Deny
            </Button>
          </div>
        </div>
      ) : null}

      {snapshot.status === 'failed' && snapshot.lastError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {snapshot.lastError}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Write `CardViewDialog`**

Create `src/renderer/components/card/CardViewDialog.tsx`.

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
import { useDocStore } from '@/store/docStore';
import { useSessionStore } from '@/store/sessionStore';
import { api } from '@/lib/api';
import { TagBadge } from '@/components/tags/TagBadge';
import { PriorityIcon } from './PriorityIcon';
import { SessionTranscript } from './SessionTranscript';
import { CardComposerDialog } from './CardComposerDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  listId: string;
  cardId: string;
}

export function CardViewDialog({ open, onOpenChange, boardId, listId, cardId }: Props) {
  const card = useDocStore(
    (s) =>
      s.doc?.boards
        .find((b) => b.id === boardId)
        ?.lists.find((l) => l.id === listId)
        ?.cards.find((c) => c.id === cardId) ?? null,
  );
  const board = useDocStore((s) => s.doc?.boards.find((b) => b.id === boardId) ?? null);
  const setCardSessionId = useDocStore((s) => s.setCardSessionId);
  const snapshot = useSessionStore((s) => s.sessions[cardId]);
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState('');

  // `api.session.run`/`reply` are fire-and-forget over IPC — the daemon
  // discovers the real session id asynchronously (from the SDK's own
  // `system`/`init` message) and reports it through the snapshot broadcast,
  // not through run()'s return value. This effect is what actually persists
  // it onto the card, so Task 9's reattach-on-relaunch has something to
  // look up later. Guarded so it only writes when the id genuinely changes,
  // not on every snapshot (checklist updates would otherwise cause a
  // document write, and an undo step, on every tool call).
  useEffect(() => {
    if (snapshot?.sessionId && snapshot.sessionId !== card?.sessionId) {
      setCardSessionId(boardId, listId, cardId, snapshot.sessionId);
    }
  }, [snapshot?.sessionId, card?.sessionId, boardId, listId, cardId, setCardSessionId]);

  if (!card) return null;

  const cwd = card.sessionRepo ?? board?.defaultRepo ?? null;
  const canRun = !snapshot || snapshot.status === 'done' || snapshot.status === 'failed';

  const run = async () => {
    if (!cwd) return;
    await api.session.run(cardId, card.prompt, cwd);
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    await api.session.reply(cardId, reply.trim());
    setReply('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{card.title}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex items-center gap-2">
            {card.priority ? <PriorityIcon priority={card.priority} /> : null}
            {card.tags.map((name) => (
              <TagBadge key={name} name={name} />
            ))}
          </div>

          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs">
            {card.prompt}
          </pre>

          {!cwd ? (
            <p className="text-xs text-muted-foreground">
              No working directory set — set a default repo on this board, or override it on
              this card, before running.
            </p>
          ) : null}

          <SessionTranscript cardId={cardId} />

          {snapshot && snapshot.status !== 'done' && snapshot.status !== 'failed' ? (
            <div className="flex gap-2">
              <Input
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                placeholder="Reply to the agent…"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void sendReply();
                }}
              />
              <Button onClick={sendReply}>Send</Button>
              <Button variant="destructive" onClick={() => api.session.stop(cardId)}>
                Stop
              </Button>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
          {canRun ? (
            <Button onClick={run} disabled={!cwd}>
              {snapshot ? 'Run again' : 'Run'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>

      <CardComposerDialog
        open={editing}
        onOpenChange={setEditing}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />
    </Dialog>
  );
}
```

- [ ] **Step 3: Point title-click at the new dialog**

In `src/renderer/components/card/PromptCard.tsx`:

1. Replace the import `import { CardComposerDialog } from './CardComposerDialog';` with `import { CardViewDialog } from './CardViewDialog';`.
2. Rename the `editing` state variable's usages to open `CardViewDialog` instead — change `onClick={() => setEditing(true)}` (on the title `div`) to keep calling the same setter (no rename needed, just what it opens), and replace the `<CardComposerDialog ... />` render near the bottom of the component with:

```tsx
      <CardViewDialog
        open={editing}
        onOpenChange={setEditing}
        boardId={boardId}
        listId={listId}
        cardId={cardId}
      />
```

`CardComposerDialog` is no longer rendered directly from `PromptCard` — it's only reachable through `CardViewDialog`'s own Edit button now (Step 2 already renders it there). Delete button behavior is unaffected — it still lives inside `CardComposerDialog`, unchanged.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — expect clean.
Run: `npx jest` — expect no regressions. `boardRenders.test.tsx` in particular still needs to pass unchanged (it renders a loaded board with a card, and now indirectly exercises `CardViewDialog`'s import graph even though the dialog itself isn't opened in that test) — if it fails, the failure is almost certainly a bad import path in `CardViewDialog.tsx`/`SessionTranscript.tsx`, not a logic bug.

---

### Task 8: Board default repo and card repo override

**Files:**
- Modify: `src/renderer/components/board/BoardView.tsx`
- Modify: `src/renderer/components/card/CardComposerDialog.tsx`
- Modify: `src/main/preload.ts`
- Modify: `src/shared/ipc.ts`
- Modify: `src/main/services/registerIpc.ts` (or wherever the existing folder/file pickers are registered — check current content before editing, per the base plan's own established pattern for this file)

**Interfaces:**
- Consumes: `setBoardDefaultRepo`, `setCardSessionRepo` from `docStore` (Task 3). `api.session.stop` from `@/lib/api` (Task 4).
- Produces: `api.data.pickFolder(): Promise<string | null>` — a new native folder-picker IPC method, reusing the existing file-picker pattern.

- [ ] **Step 1: Add the folder-picker channel and handler**

In `src/shared/ipc.ts`, add `dataPickFolder: 'data:pick-folder'` to `CHANNELS`.

In `src/main/services/registerIpc.ts`, read the existing `dataPickOpen`/`dataPickSave` handlers first (they already exist from the base build) and add a sibling handler in the same style:

```ts
  ipcMain.handle(CHANNELS.dataPickFolder, async () => {
    const window = getWindow();
    if (!window) return null;
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a working directory',
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
```

- [ ] **Step 2: Expose it in preload**

In `src/main/preload.ts`, add to `api.data`:

```ts
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(CHANNELS.dataPickFolder),
```

- [ ] **Step 3: Add the board default-repo control**

In `src/renderer/components/board/BoardView.tsx`, read the current header JSX first (it renders the board name via `InlineEditableText`), then add, immediately after it:

```tsx
          <button
            type="button"
            onClick={async () => {
              const folder = await api.data.pickFolder();
              if (folder) setBoardDefaultRepo(board.id, folder);
            }}
            className="ml-2 truncate rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            title={board.defaultRepo ?? undefined}
          >
            {board.defaultRepo ? board.defaultRepo.split('/').pop() : 'Set default repo…'}
          </button>
```

Add `const setBoardDefaultRepo = useDocStore((s) => s.setBoardDefaultRepo);` alongside the component's other store hooks, and `import { api } from '@/lib/api';` if not already imported.

- [ ] **Step 4: Add the card-level repo override field**

In `src/renderer/components/card/CardComposerDialog.tsx`, read the current field list first (Title, Priority, Prompt, Tags, Notes, Link), then add a new field, after Link:

```tsx
          <div className="flex flex-col gap-1.5">
            <Label>Working directory override</Label>
            <div className="flex gap-2">
              <Input value={sessionRepo ?? ''} readOnly placeholder="Uses board default" />
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  const folder = await api.data.pickFolder();
                  if (folder) setSessionRepo(folder);
                }}
              >
                Choose…
              </Button>
              {sessionRepo ? (
                <Button type="button" variant="ghost" onClick={() => setSessionRepo(null)}>
                  Clear
                </Button>
              ) : null}
            </div>
          </div>
```

Add `const [sessionRepo, setSessionRepo] = useState<string | null>(null);`, reset it in the existing open-effect (`setSessionRepo(existing?.sessionRepo ?? null);`), include `sessionRepo` in both `updateCard`'s patch and `addCard`'s fields in `save()`, and add `import { api } from '@/lib/api';` if not already imported.

- [ ] **Step 5: Stop a card's live session before deleting it**

Read `CardComposerDialog.tsx`'s existing `remove()` function (added when card deletion was first built — it currently just calls `deleteCard(boardId, listId, cardId)` then closes the dialog). A card with a live session should not leave an orphaned Claude session running after it's gone. Change it to:

```tsx
  const remove = () => {
    if (!cardId) return;
    if (card?.sessionId) void api.session.stop(cardId);
    deleteCard(boardId, listId, cardId);
    onOpenChange(false);
  };
```

(`card` here is the same `existing`-derived value the component already reads — check the exact local variable name in the live file; it may be named `existing` rather than `card`, since that's what Task 8's own earlier code in this file calls it. Use whichever name the file already uses, not a new one.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` and `npx jest` — expect both clean, no regressions.

---

## Milestone D — Resilience

### Task 9: Reattach on relaunch and error handling

**Files:**
- Modify: `src/renderer/components/shell/AppShell.tsx`

**Interfaces:**
- Consumes: `startSessionSubscription`, `useSessionStore` (for its `applySnapshot` action), `api.session.getState` — all from Task 4.

- [ ] **Step 1: Start the session subscription and reattach every card with a stored session id**

In `src/renderer/components/shell/AppShell.tsx`, add the import `import { startSessionSubscription } from '@/store/sessionStore';` and a new effect, alongside the existing `startPersistence()` effect:

```tsx
  useEffect(() => {
    const stop = startSessionSubscription();
    const doc = useDocStore.getState().doc;
    doc?.boards.forEach((board) =>
      board.lists.forEach((list) =>
        list.cards.forEach((card) => {
          if (!card.sessionId) return;
          // Optimistic placeholder, applied BEFORE asking the daemon: if the
          // daemon (or a freshly-spawned one with no memory of past
          // sessions) never answers this getState call, this is what stays
          // on screen — an explicit "reconnecting/interrupted" indicator,
          // per the spec's error-handling section, rather than silently
          // looking like the card never had a session at all. A real
          // `snapshot` event arriving afterwards fully replaces this
          // (`applySnapshot` is always a whole-entry replace, never a
          // merge), so a daemon that DID survive corrects it immediately.
          useSessionStore.getState().applySnapshot({
            cardId: card.id,
            sessionId: card.sessionId,
            status: 'failed',
            checklist: [],
            pendingApproval: null,
            lastError: 'Reconnecting to session…',
          });
          void api.session.getState(card.id);
        }),
      ),
    );
    return stop;
  }, []);
```

Add the import `import { useSessionStore } from '@/store/sessionStore';` if `startSessionSubscription`'s existing import in this file doesn't already pull in the module (it's a named export from the same file, so one `import` line can bring in both).

This asks the daemon for the current state of every card that has a recorded session id, having already shown a "reconnecting" placeholder for each. If the daemon is already running (it survived the app closing, per the spec's persistence requirement) and still tracking that session, a real `snapshot` event arrives and overwrites the placeholder with the card's actual status/checklist. If the daemon isn't running at all (e.g. the machine restarted, not just the app), a freshly-spawned one has no memory of past sessions, never responds to `getState` for that `cardId`, and the placeholder simply stays — correctly showing an interrupted state rather than reverting to "no session."

- [ ] **Step 2: Verify the reattach path with the full previous test suite, plus a targeted manual check**

Run: `npx tsc --noEmit` and `npx jest` — expect both clean, no regressions across the whole suite built by this plan (Tasks 1–8) and the base app.

Then do the one interactive check this task specifically calls for — reusing the same throwaway daemon-smoke-test pattern from Task 1/2, not the full Electron app:

1. Start a daemon and a `run` request exactly as in Task 2 Step 7, but don't wait for completion — kill the *client* script (not the daemon) after seeing the first `snapshot` event, leaving the daemon and the in-flight session running.
2. Confirm the daemon process (`$DAEMON_PID`) is still alive: `ps -p $DAEMON_PID`.
3. Connect a fresh client and send `{ op: 'getState', cardId: 'test' }`.

Expected: the fresh client receives a `snapshot` event reflecting the session's current state (not "no session found") — proving state survives a client disconnecting and a new one reattaching, which is the exact mechanic `AppShell`'s reattach effect depends on.

4. Clean up: `kill $DAEMON_PID` and remove the temp socket/test directory.

Report the full sequence observed and confirm cleanup.
