import type { ApprovalMode } from '@shared/daemonProtocol';

export interface TerminalLaunchInput {
  shell: string;
  claudeCliPath: string | null;
  prompt: string;
  model: string | null;
  approvalMode: ApprovalMode;
  sessionId: string;
  resume: boolean;
  hookFile: string;
  baseEnv: Record<string, string | undefined>;
}

export interface TerminalLaunch {
  file: string;
  args: string[];
  env: Record<string, string>;
}

const CLI_MISSING_MESSAGE =
  'Claude CLI not found. Set its path in Settings → Agent sessions → Claude CLI path.';

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreToolUse',
  'PostToolUse',
  'SessionEnd',
] as const;

const HOOK_COMMAND = `cat >> "$AI_KANBAN_HOOK_FILE"; printf '\\n\\036\\n' >> "$AI_KANBAN_HOOK_FILE"`;

// The CLI pipes its status JSON (with `cost.total_cost_usd`) to the statusLine
// command; keep the latest copy for the daemon to bill from. Replaces any
// statusLine the user configured, for this session only.
const STATUS_COMMAND = `cat > "$AI_KANBAN_HOOK_FILE.cost.tmp" && mv "$AI_KANBAN_HOOK_FILE.cost.tmp" "$AI_KANBAN_HOOK_FILE.cost"`;

const PERMISSION_MODES: Record<ApprovalMode, string> = {
  ask: 'manual',
  auto: 'auto',
};

/**
 * Shells that cannot run the POSIX launch script themselves. Each hands
 * `$AI_KANBAN_SCRIPT` to /bin/sh in its own syntax for reading the env.
 */
const NON_POSIX_RUNNERS: Record<string, string> = {
  fish: 'exec /bin/sh -c "$AI_KANBAN_SCRIPT"',
  nu: 'exec /bin/sh -c $env.AI_KANBAN_SCRIPT',
  xonsh: 'exec /bin/sh -c $AI_KANBAN_SCRIPT',
  elvish: 'exec /bin/sh -c $E:AI_KANBAN_SCRIPT',
  pwsh: '& /bin/sh -c $env:AI_KANBAN_SCRIPT; exit $LASTEXITCODE',
};

/** A pty process title as a comparable name: no directory, no login dash. */
export function processBaseName(proc: string): string {
  return proc.slice(proc.lastIndexOf('/') + 1).replace(/^-/, '');
}

function shellName(shell: string): string {
  return shell.slice(shell.lastIndexOf('/') + 1);
}

/** POSIX single-quoting: nothing inside is expanded by the shell. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function defaultShell(
  platform: string,
  envShell: string | undefined,
): string {
  if (envShell) return envShell;
  return platform === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

/**
 * Inline `--settings` JSON registering one hook per lifecycle event. Each
 * appends the hook's stdin JSON to the card's hook file, then a line
 * holding only `\x1e` that marks the record complete.
 */
export function buildHookSettings(): string {
  const hooks = Object.fromEntries(
    HOOK_EVENTS.map((event) => [
      event,
      [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }],
    ]),
  );
  return JSON.stringify({
    hooks,
    statusLine: { type: 'command', command: STATUS_COMMAND },
  });
}

function claudeCommand(input: TerminalLaunchInput): string {
  const claude = input.claudeCliPath
    ? shellQuote(input.claudeCliPath)
    : 'claude';
  const parts = [
    claude,
    input.resume ? '--resume' : '--session-id',
    shellQuote(input.sessionId),
    '--permission-mode',
    shellQuote(PERMISSION_MODES[input.approvalMode]),
  ];
  if (input.model) parts.push('--model', shellQuote(input.model));
  parts.push('--settings', shellQuote(buildHookSettings()));
  if (!input.resume) parts.push('--', shellQuote(input.prompt));
  return parts.join(' ');
}

/** Typed into an already-open shell to bring the same Claude session back. */
export function claudeResumeLine(input: TerminalLaunchInput): string {
  return `${claudeCommand({ ...input, resume: true })}\r`;
}

/** App-internal env vars that must not leak into user sessions. */
const SESSION_ENV_BLOCKLIST = new Set(['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS']);

export function buildTerminalLaunch(
  input: TerminalLaunchInput,
): TerminalLaunch {
  const check = input.claudeCliPath
    ? `[ -x ${shellQuote(input.claudeCliPath)} ]`
    : 'command -v claude >/dev/null 2>&1';
  const script = [
    `if ${check}; then ${claudeCommand(input)}; else printf '%s\\n' ${shellQuote(CLI_MISSING_MESSAGE)}; fi`,
    `exec ${shellQuote(input.shell)} -l -i`,
  ].join('; ');

  const env: Record<string, string> = {};
  Object.entries(input.baseEnv).forEach(([key, value]) => {
    // The daemon itself runs as Electron-as-Node; inherited, this would
    // turn any Electron app launched from the user's shell into plain Node.
    // NODE_OPTIONS is set by the app's dev scripts (-r ts-node/register),
    // and ts-node isn't installed in session worktrees, so Node would crash.
    if (value !== undefined && !SESSION_ENV_BLOCKLIST.has(key)) {
      env[key] = value;
    }
  });
  env.AI_KANBAN_HOOK_FILE = input.hookFile;
  env.TERM = 'xterm-256color';

  const runner = NON_POSIX_RUNNERS[shellName(input.shell)];
  if (runner) {
    env.AI_KANBAN_SCRIPT = script;
    return { file: input.shell, args: ['-l', '-i', '-c', runner], env };
  }
  return { file: input.shell, args: ['-l', '-i', '-c', script], env };
}
