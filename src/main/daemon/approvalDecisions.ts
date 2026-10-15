// See index.ts for why this type-only import needs a `resolution-mode`
// attribute: `@anthropic-ai/claude-agent-sdk` is ESM-only, and this file
// compiles as CommonJS under this repo's `module: node16` tsconfig.
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import type { PendingApproval } from '@shared/daemonProtocol';

/**
 * Decides how (or whether) an incoming `approve` request should resolve a
 * session's pending `canUseTool` call.
 *
 * Returns `null` when the request is stale and must be silently ignored:
 * either there is no pending approval at all, or the request's `requestId`
 * doesn't match the session's CURRENT pending approval. The latter happens
 * when a delayed/duplicate `approve` message for an earlier `canUseTool`
 * call arrives after the session has already moved on to a new pending
 * approval (a new `canUseTool` call with a different `requestId`) — without
 * this check, the stale decision would be silently applied to the wrong,
 * unrelated tool call.
 */
export function computeApprovalResolution(
  pendingApproval: PendingApproval | null,
  request: {
    requestId: string;
    decision: 'allow' | 'deny';
    message?: string;
    answers?: Record<string, string | string[]>;
  },
): PermissionResult | null {
  if (!pendingApproval || pendingApproval.requestId !== request.requestId) {
    return null;
  }
  if (request.decision === 'deny') {
    return { behavior: 'deny', message: request.message ?? 'Denied by user' };
  }
  // AskUserQuestion has no meaningful "allow as requested" — the SDK
  // requires the answer back as `updatedInput: { questions, answers }`.
  // The original `questions` array is echoed straight back from the
  // pending approval's own input rather than trusting anything the
  // renderer sent, since the renderer already had to parse it from there
  // to build the form in the first place.
  if (request.answers) {
    const input = pendingApproval.input;
    const questions =
      typeof input === 'object' && input !== null && 'questions' in input
        ? (input as { questions: unknown }).questions
        : [];
    return { behavior: 'allow', updatedInput: { questions, answers: request.answers } };
  }
  return { behavior: 'allow' };
}

/**
 * The resolution used to unblock a session's pending `canUseTool` call when
 * the session is stopped while a tool-use approval is outstanding. Without
 * this, the SDK's own awaited `canUseTool` call never unblocks from the
 * abort signal alone, leaving a dangling resolver that a later stale
 * `approve` could incorrectly resolve against.
 */
export function computeStopResolution(): PermissionResult {
  return { behavior: 'deny', message: 'Session stopped' };
}
