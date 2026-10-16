# Queued and interrupt messages implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a card’s agent is working, let the user either queue a follow-up or interrupt the current turn and send that message now, the way the Claude Code CLI does.

**Architecture:** A card with a live daemon session keeps one streaming `query()` open. Its prompt is an async queue of user messages owned by the daemon, not a string that closes stdin. Enter while the agent is working enqueues. “Interrupt and send” calls `Query.interrupt()` and then enqueues. A daemon that no longer holds that query falls back to today’s `resume` plus a new `query()`.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` `query()` streaming input and `Query.interrupt()`, the existing Unix-socket daemon protocol, Zustand `sessionStore`, `CardViewDialog` reply box.

**Spec:** This document is the spec. There is no separate design doc.

## Global Constraints

- Do not `git add` or `git commit`. The user stages and commits.
- Document `version` stays **1**. Do not store the live queue or the streaming query in `kanban.json`.
- Renderer never imports the Agent SDK. Only `src/main/daemon` calls `query()` and `interrupt()`.
- Ask-every-time approvals stay as they are. A pending Approve/Deny or Ask Question is not a free-text reply.
- Ship conflict turns stay idle replies. Do not interrupt a user turn to ship.
- “Run again” still starts a fresh Claude conversation. It does not resume the previous one.
- No live Claude API calls in tests. Fake the `Query` object.

## Review Focus

- A string `prompt` closes the CLI stdin after the first result (`src/main/daemon/queryPrompt.ts`). Every message on a live session, including the first, must go through the async queue or interrupt cannot be called later.
- Two `query()` calls for one card must not overlap. Queue and interrupt push into the open query. Only Run, Run again, and a cold resume start one.
- `interrupt()` is a no-op when nothing is running. The message still has to be enqueued afterward.
- An approval that is `waiting` must not be answered by the new composer buttons.
- A queued message must survive the Electron window closing, because the daemon is detached. It does not survive a daemon restart.
- Images on a queued or interrupting reply use the same `SDKUserMessage` shape as today’s image turns.

## File map

| File | Responsibility |
|---|---|
| `src/main/daemon/sessionInputQueue.ts` | Async iterable the SDK reads. `push` and `close` are the only writers. |
| `src/main/daemon/index.ts` | Hold one `Query` per card. Route queue vs interrupt. Cold-resume when no query is held. |
| `src/main/daemon/turnLifecycle.ts` | Stop rejecting a `reply` that is allowed to queue or interrupt. |
| `src/main/daemon/queryPrompt.ts` | Build one `SDKUserMessage` for text or images. Do not wrap a live session in a one-message iterable. |
| `src/shared/daemonProtocol.ts` | `reply.delivery` and `snapshot.queuedMessages`. |
| `src/renderer/components/card/CardViewDialog.tsx` | Composer behavior and the interrupt button. |
| `src/renderer/components/card/SessionTranscript.tsx` | Show messages that are queued but not yet started. |

---

### Task 1: Session input queue

**Files:**
- Create: `src/main/daemon/sessionInputQueue.ts`
- Test: `src/__tests__/sessionInputQueue.test.ts`

The queue is an async iterable of `SDKUserMessage`. `push` wakes a waiting reader. `close` ends iteration after messages already pushed are yielded. Push after close throws.

- [ ] Write a failing test: push two messages before iteration starts, and both come out in order.
- [ ] Write a failing test: a reader blocked on an empty queue receives the next `push`.
- [ ] Write a failing test: `close` finishes iteration, and a later `push` throws.
- [ ] Run `npx jest src/__tests__/sessionInputQueue.test.ts --no-coverage` and confirm the failures.
- [ ] Implement the queue.
- [ ] Re-run that test and confirm it passes.

### Task 2: Protocol

**Files:**
- Modify: `src/shared/daemonProtocol.ts`
- Modify: the `reply` IPC signature in `src/main/preload.ts`, `src/main/main.ts`, and `src/renderer/lib/api.ts` if the renderer wrapper repeats the argument list

Add `delivery: 'queue' | 'interrupt'` to the `reply` request. Existing callers that mean “send this now because the agent is idle” pass `'queue'`.

Add `queuedMessages: { id: string; text: string }[]` to `SessionSnapshot`, defaulting to `[]` when a cached snapshot omits it. This is display state only.

- [ ] Extend the daemon request and snapshot types.
- [ ] Thread `delivery` through preload and the main-process handler. Default an omitted value to `'queue'` so an older caller cannot accidentally interrupt.
- [ ] Confirm `npx tsc --noEmit` is clean for the signature change. Tests that construct snapshots get `queuedMessages: []` only where TypeScript requires it.

### Task 3: One live query per card

**Files:**
- Modify: `src/main/daemon/index.ts`
- Modify: `src/main/daemon/queryPrompt.ts`
- Modify: `src/main/daemon/turnLifecycle.ts`
- Test: `src/__tests__/daemonLiveSession.test.ts`

`runTurn` today starts a new `query()` and `canStartTurn` refuses a second one. Replace that with:

- **Run**, and **Run again**: close any open input queue, drop the old `Query`, and start a new `query()` with no `resume`. The prompt option is the session input queue with the first message already pushed. Options that stay unchanged: `cwd`, `model`, `systemPrompt` preset `claude_code`, `abortController`, and `buildSessionPermissionOptions`.
- **Reply `queue` while a query is open**: push the message. Do not call `interrupt`. Do not start another `query()`. Append it to `snapshot.queuedMessages` until the SDK echoes it as a user transcript message, then remove that entry.
- **Reply `interrupt` while a query is open and the turn is `working`**: call `query.interrupt()`, then push. Same queued-message bookkeeping.
- **Reply while no query is open** (daemon restarted, or the previous stream ended): keep today’s path. Start one new `query()` with `resume` from `resolveResumeSessionId` and the message as the first queue item. `delivery: 'interrupt'` has nothing to interrupt, so it behaves as `queue`.
- **Reply while `waiting`**: keep the current refusal. Do not enqueue and do not interrupt. The pending approval is the only response.
- **Stop**: `interrupt()` if a query exists, resolve a pending approval with `computeStopResolution()`, abort, and `close()` the input queue.

The test uses a fake `query()` that returns an object with `interrupt` and an async iterator. It must not import a live SDK session.

- [ ] Write a failing test that a second `reply` with `delivery: 'queue'` during `working` calls `query` once and `interrupt` zero times.
- [ ] Write a failing test that `delivery: 'interrupt'` during `working` calls `interrupt` once and then pushes the message.
- [ ] Write a failing test that a reply with no live query calls `query` with `resume` set to the persisted session id.
- [ ] Write a failing test that a reply during `waiting` calls neither `query` nor `interrupt`.
- [ ] Run `npx jest src/__tests__/daemonLiveSession.test.ts --no-coverage` and confirm the failures.
- [ ] Implement the live-query routing.
- [ ] Re-run that test and `src/__tests__/daemonTurnLifecycle.test.ts`.

### Task 4: Composer

**Files:**
- Modify: `src/renderer/components/card/CardViewDialog.tsx`
- Modify: `src/renderer/components/card/SessionTranscript.tsx`
- Test: `src/__tests__/cardViewDialogSession.test.tsx`

While the snapshot status is `working` and Ship is not busy:

- The reply box stays enabled.
- Enter sends `session.reply` with `delivery: 'queue'`.
- A button labeled **Interrupt and send** sends the same text with `delivery: 'interrupt'`. It is disabled when the box is empty.
- The typed text clears on a successful send, same as an idle send.

While the status is `waiting`, the box and both actions stay disabled. The existing approval copy stays.

While idle, Enter keeps today’s immediate send and passes `delivery: 'queue'`. The interrupt button is hidden.

`SessionTranscript` renders `queuedMessages` after the live feed, each prefixed so it is visibly not yet started. Use the text `Queued` as the label.

- [ ] Write a failing UI test: during `working`, Enter calls `reply` with `'queue'` and does not use the interrupt delivery.
- [ ] Write a failing UI test: **Interrupt and send** calls `reply` with `'interrupt'`.
- [ ] Write a failing UI test: during `waiting`, both actions are disabled and `reply` is not called.
- [ ] Write a failing UI test: a snapshot `queuedMessages` entry renders as `Queued`.
- [ ] Run `npx jest src/__tests__/cardViewDialogSession.test.tsx src/__tests__/sessionTranscript.test.tsx --no-coverage` and confirm those new cases fail.
- [ ] Implement the composer and the queued-message rows.
- [ ] Re-run those two test files.

### Task 5: Ship and Run again

**Files:**
- Modify: `src/main/services/ship.ts` only if its `reply` call site must pass `delivery`
- Test: the existing ship orchestrator test and `src/__tests__/cardViewDialogSession.test.tsx`

Ship already waits until the user turn is finished. Its conflict reply passes `delivery: 'queue'`. Run again closes the live input queue before starting the fresh query from Task 3.

- [ ] Update the ship reply call to pass `'queue'`.
- [ ] Add a failing daemon test that Run again calls `close` on the previous input queue and calls `query` without `resume`.
- [ ] Run `npx jest src/__tests__/daemonLiveSession.test.ts src/__tests__/shipOrchestrator.test.ts --no-coverage`.
- [ ] Implement the close-and-restart behavior.
- [ ] Re-run those tests.

## Done when

- [ ] `npx tsc --noEmit` is clean.
- [ ] `npx jest src/__tests__/sessionInputQueue.test.ts src/__tests__/daemonLiveSession.test.ts src/__tests__/daemonTurnLifecycle.test.ts src/__tests__/cardViewDialogSession.test.tsx src/__tests__/sessionTranscript.test.tsx src/__tests__/shipOrchestrator.test.ts --no-coverage` passes.
- [ ] A working card can queue a message without a second `query()`, and can interrupt the current turn and send immediately.
- [ ] Restarting the daemon still resumes the Claude session from `card.sessionId`. Messages that were only queued in the dead process are gone.
