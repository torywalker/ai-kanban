// See index.ts for why these type-only imports need a `resolution-mode`
// attribute: `@anthropic-ai/claude-agent-sdk` is ESM-only, and this file
// compiles as CommonJS under this repo's `module: node16` tsconfig.
import type {
  CanUseTool,
  PermissionMode,
} from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };
import type { ApprovalMode } from '@shared/daemonProtocol';

/**
 * The permission half of the daemon's `query()` options, split out of
 * `index.ts` so it can be unit-tested without a live SDK subprocess.
 *
 * ## Why this file exists at all
 *
 * The daemon originally passed BOTH a `canUseTool` callback AND
 * `allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch']`.
 * Those two options do not compose the way that reads: per the SDK's own
 * `Options.allowedTools` doc comment, `allowedTools` is a
 * "List of tool names that are auto-allowed without prompting for
 * permission... To restrict which tools are available, use the `tools`
 * option instead." A **bare** entry (a plain tool name, with no
 * `Tool(scope)` parenthesised rule content) pre-authorises the whole tool
 * BEFORE the callback is consulted, so `canUseTool` was never invoked for
 * any of those six tools. The real SDK says so out loud at runtime:
 *
 *     [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will not be
 *     invoked for: Read, Edit, Write, Bash, WebSearch, WebFetch. Bare
 *     allowedTools entries auto-approve the whole tool before the callback
 *     is consulted. To gate every tool call, use a PreToolUse hook; or
 *     remove the bare names from allowedTools so they fall through to
 *     canUseTool.
 *
 * The consequence was that this feature's entire approval surface — the
 * `waiting` status, `pendingApproval`, the Approve/Deny box in
 * `SessionTranscript`, `approvalDecisions.ts`, the `approve` protocol op —
 * was unreachable in production, and Write/Edit/Bash ran unsupervised in
 * whatever repo the card pointed at.
 *
 * ## The fix
 *
 * Take the second remedy the SDK itself suggests: pass NO `allowedTools` at
 * all, so every tool call falls through to `canUseTool`, with
 * `permissionMode: 'default'` (the mode in which the host callback is the
 * deciding authority). No `tools` restriction is added: `allowedTools` never
 * governed availability, so leaving the tool set at the CLI default keeps
 * behaviour identical apart from the gating.
 *
 * Nothing is auto-approved. A read-only/mutating split was considered and
 * rejected — `Read` can exfiltrate `~/.ssh/id_rsa` and `WebFetch` is an
 * outbound channel, so "safe" is not a property of the tool name alone, and
 * the spec (§6) asks for "explicit Approve/Deny controls with enough detail
 * to decide (what the agent wants to do)", i.e. a real decision per call.
 * If per-tool auto-approval is ever wanted, it belongs in
 * `AUTO_APPROVED_TOOL_RULES` below as *scoped* rules (`'Bash(git status:*)'`)
 * rather than bare names, and `toolsShadowingCanUseTool` will keep bare
 * names from sneaking back in.
 *
 * One caveat the SDK flags and this cannot close from here: allow rules in
 * the user's own settings files (`~/.claude/settings.json` and friends,
 * loaded by default per `Options.settingSources`) can also pre-approve a
 * tool. Those are the user's own explicit grants, so they are respected
 * rather than suppressed.
 *
 * ## "Smart auto" is the SDK's real `'auto'` mode, on purpose
 *
 * An earlier version of this file deliberately refused to map this app's
 * 'auto' `ApprovalMode` to the SDK's own `permissionMode: 'auto'`, on the
 * strength of a live probe showing that mode never invokes `canUseTool` at
 * all (a `rm -rf` ran with no approval box shown). That probe was correct,
 * and Anthropic's own docs confirm it's not a bug: "Auto-approved tools
 * never reach `canUseTool`" — in `auto` mode, a hosted model classifier (the
 * same one the Claude CLI's own Auto Mode uses) decides almost every call
 * directly, and only a small fixed set of always-interactive cases
 * (`AskUserQuestion`, certain MCP/connector tools) still reach the host
 * callback.
 *
 * This was re-litigated after explicit user direction: the user wants
 * "Smart auto" to behave exactly like the real Claude CLI's Auto Mode, not
 * a safer approximation of it — confirmed live again (destructive `rm`,
 * an out-of-cwd read, and an outbound `curl`, all auto-approved with zero
 * `canUseTool` calls) and against the current official docs before making
 * this change. So `sessionPermissionMode('auto')` now really is the SDK's
 * `'auto'`, and the cost is accepted deliberately: this app's own
 * Approve/Deny box (`pendingApproval`, the `waiting` status,
 * `approvalDecisions.ts`) will rarely appear while "Smart auto" is
 * selected, because the classifier is resolving almost everything before
 * it would ever reach that gate. `'ask'` is unchanged — every call still
 * reaches `canUseTool` via `permissionMode: 'default'`.
 */

/**
 * Maps this app's own `ApprovalMode` setting to the SDK's `permissionMode`.
 * `'ask'` -> `'default'` (the host callback decides every call). `'auto'`
 * -> the SDK's real `'auto'` (Anthropic's hosted classifier decides almost
 * every call itself — see the module doc comment above for why this is
 * intentional, not a shadowing bug).
 */
export function sessionPermissionMode(approvalMode: ApprovalMode): PermissionMode {
  return approvalMode === 'auto' ? 'auto' : 'default';
}

/**
 * Pre-authorised permission rules for agent sessions. Deliberately empty:
 * every tool call goes to the user. Any future entry MUST be a scoped rule
 * (`'Bash(npm test:*)'`), never a bare tool name — a bare name silently
 * disables the approval gate for that tool entirely.
 */
export const AUTO_APPROVED_TOOL_RULES: readonly string[] = [];

/** The permission-related subset of the SDK's `query()` options. */
export interface SessionPermissionOptions {
  permissionMode: PermissionMode;
  canUseTool: CanUseTool;
  /**
   * Only ever set when {@link AUTO_APPROVED_TOOL_RULES} is non-empty, and
   * then only with scoped rules. Absent (not `undefined`-valued) otherwise,
   * so the SDK sees no `allowedTools` key at all.
   */
  allowedTools?: string[];
}

/**
 * Which of `permissionMode` + `allowedTools` would stop the SDK from ever
 * calling `canUseTool`. Mirrors the SDK's own shadow-detection predicate
 * (bypassPermissions shadows everything; an `allowedTools` entry shadows its
 * tool when it is non-empty and carries no parenthesised scope), so the
 * regression that motivated this file fails a unit test rather than only
 * showing up as a runtime warning nobody reads.
 *
 * Returns `['*']` for a mode that shadows every tool, otherwise the list of
 * shadowing entries — empty means `canUseTool` really is consulted.
 */
export function toolsShadowingCanUseTool(
  permissionMode: PermissionMode,
  allowedTools: readonly string[] | undefined,
): string[] {
  if (permissionMode === 'bypassPermissions') return ['*'];
  return (allowedTools ?? []).filter(
    (entry) => entry.length > 0 && !entry.includes('('),
  );
}

/**
 * Builds the permission options the daemon spreads into `query()`. Callers
 * must spread the result rather than cherry-pick fields, so that
 * `allowedTools` stays absent instead of becoming an explicit `undefined`.
 */
export function buildSessionPermissionOptions(
  canUseTool: CanUseTool,
  approvalMode: ApprovalMode,
): SessionPermissionOptions {
  const options: SessionPermissionOptions = {
    permissionMode: sessionPermissionMode(approvalMode),
    canUseTool,
  };
  if (AUTO_APPROVED_TOOL_RULES.length > 0) {
    options.allowedTools = [...AUTO_APPROVED_TOOL_RULES];
  }
  return options;
}
