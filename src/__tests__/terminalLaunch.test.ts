import { execFileSync } from 'child_process';
import {
  buildHookSettings,
  buildTerminalLaunch,
  defaultShell,
  shellQuote,
  type TerminalLaunchInput,
} from '../main/daemon/terminalLaunch';

const PROMPT = 'it\'s "$HOME" `x`\nline2';

function launchInput(
  overrides: Partial<TerminalLaunchInput> = {},
): TerminalLaunchInput {
  return {
    shell: '/bin/zsh',
    claudeCliPath: null,
    prompt: PROMPT,
    model: 'claude-opus-5-5',
    approvalMode: 'ask',
    sessionId: 'u-1',
    resume: false,
    hookFile: '/h/c.log',
    baseEnv: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', UNSET: undefined },
    ...overrides,
  };
}

function scriptOf(input: TerminalLaunchInput): string {
  return buildTerminalLaunch(input).args[3];
}

describe('shellQuote', () => {
  it('closes, escapes and reopens around a single quote', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  it('wraps everything else verbatim in single quotes', () => {
    expect(shellQuote('$HOME `x` "y"\nz')).toBe('\'$HOME `x` "y"\nz\'');
  });
});

describe('defaultShell', () => {
  it('falls back to zsh on macOS and bash elsewhere', () => {
    expect(defaultShell('darwin', undefined)).toBe('/bin/zsh');
    expect(defaultShell('linux', undefined)).toBe('/bin/bash');
  });

  it("prefers the user's $SHELL", () => {
    expect(defaultShell('darwin', '/opt/fish')).toBe('/opt/fish');
  });
});

describe('buildTerminalLaunch', () => {
  describe('a new conversation', () => {
    const launch = buildTerminalLaunch(launchInput());
    const script = launch.args[3];

    it('runs the script through an interactive login shell', () => {
      expect(launch.file).toBe('/bin/zsh');
      expect(launch.args.slice(0, 3)).toEqual(['-l', '-i', '-c']);
      expect(launch.args).toHaveLength(4);
    });

    it('checks for claude on PATH', () => {
      expect(script).toContain('command -v claude');
    });

    it('starts claude with a fixed session id, mapped mode, model and hooks', () => {
      expect(script).toContain(
        "claude --session-id 'u-1' --permission-mode 'manual' --model 'claude-opus-5-5' --settings '",
      );
    });

    it('passes the prompt after -- so it is never read as a flag', () => {
      expect(script).toContain(`-- ${shellQuote(PROMPT)}`);
    });

    it('drops the user at their own shell when claude exits', () => {
      expect(script.endsWith("exec '/bin/zsh' -l -i")).toBe(true);
    });

    it('points the hooks at the card file and sets a 256-colour TERM', () => {
      expect(launch.env.AI_KANBAN_HOOK_FILE).toBe('/h/c.log');
      expect(launch.env.TERM).toBe('xterm-256color');
      expect(launch.env.PATH).toBe('/usr/bin');
    });

    it("keeps the daemon's own Electron-as-Node flag out of the user's shell", () => {
      expect(launch.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
      expect(launch.env).not.toHaveProperty('UNSET');
    });
  });

  it('resumes an existing conversation with no prompt and no model', () => {
    const script = scriptOf(
      launchInput({ resume: true, approvalMode: 'auto', model: null }),
    );
    expect(script).toContain("--resume 'u-1' --permission-mode 'auto'");
    expect(script).not.toContain('--model');
    expect(script).not.toContain('-- ');
  });

  it('checks and runs an explicit CLI path', () => {
    const script = scriptOf(launchInput({ claudeCliPath: '/opt/c' }));
    expect(script).toContain("[ -x '/opt/c' ]");
    expect(script).toContain("'/opt/c' --session-id");
    expect(script).not.toContain('command -v claude');
  });

  it('prints the settings hint when the CLI is missing', () => {
    expect(scriptOf(launchInput())).toContain(
      `else printf '%s\\n' ${shellQuote(
        'Claude CLI not found. Set its path in Settings → Agent sessions → Claude CLI path.',
      )}; fi`,
    );
  });

  // The script really runs under sh here, with `claude` stubbed as a
  // function that prints its argv one per line, so this proves the prompt
  // arrives as one verbatim argument rather than just looking right.
  it('delivers a prompt full of shell metacharacters to claude verbatim', () => {
    const script = scriptOf(launchInput()).replace(/; exec .*$/, '');
    const output = execFileSync(
      '/bin/sh',
      [
        '-c',
        `claude() { for a in "$@"; do printf '%s\\0' "$a"; done; }; ${script}`,
      ],
      { encoding: 'utf8' },
    );
    const argv = output.split('\0').slice(0, -1);
    expect(argv.slice(-2)).toEqual(['--', PROMPT]);
    expect(argv[argv.indexOf('--settings') + 1]).toBe(buildHookSettings());
  });
});

describe('buildHookSettings', () => {
  it('registers the same append-a-record command on every lifecycle hook', () => {
    const { hooks } = JSON.parse(buildHookSettings());
    expect(Object.keys(hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'Notification',
      'Stop',
      'SessionEnd',
    ]);
    Object.values(hooks).forEach((entries) => {
      expect((entries as any)[0].hooks[0]).toEqual({
        type: 'command',
        command:
          'cat >> "$AI_KANBAN_HOOK_FILE"; printf \'\\n\\036\\n\' >> "$AI_KANBAN_HOOK_FILE"',
      });
    });
  });
});
