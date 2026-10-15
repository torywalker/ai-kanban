import fs from 'fs';
import path from 'path';
import {
  AUTO_APPROVED_TOOL_RULES,
  buildSessionPermissionOptions,
  sessionPermissionMode,
  toolsShadowingCanUseTool,
} from '../main/daemon/permissionConfig';

// A stand-in for the real callback; these tests only care about how the
// options around it are shaped, never about invoking it.
const noopCanUseTool = async () => ({ behavior: 'allow' as const });

describe('toolsShadowingCanUseTool', () => {
  it('reports nothing shadowed when there are no allowedTools at all', () => {
    expect(toolsShadowingCanUseTool('default', undefined)).toEqual([]);
    expect(toolsShadowingCanUseTool('default', [])).toEqual([]);
  });

  it('reports every bare tool name as shadowing the callback', () => {
    // This is exactly the list the daemon used to pass, and exactly the list
    // the real SDK named in its CLAUDE_SDK_CAN_USE_TOOL_SHADOWED warning.
    expect(
      toolsShadowingCanUseTool('default', [
        'Read',
        'Edit',
        'Write',
        'Bash',
        'WebSearch',
        'WebFetch',
      ]),
    ).toEqual(['Read', 'Edit', 'Write', 'Bash', 'WebSearch', 'WebFetch']);
  });

  it('does not treat a scoped rule as shadowing, since it only pre-approves that one scope', () => {
    expect(
      toolsShadowingCanUseTool('default', [
        'Bash(git status:*)',
        'Read(docs/**)',
      ]),
    ).toEqual([]);
  });

  it('separates scoped rules from bare names in a mixed list', () => {
    expect(
      toolsShadowingCanUseTool('default', ['Bash(git status:*)', 'Write']),
    ).toEqual(['Write']);
  });

  it('reports bypassPermissions as shadowing every tool regardless of allowedTools', () => {
    expect(toolsShadowingCanUseTool('bypassPermissions', [])).toEqual(['*']);
  });

  it('does not report the modes in which the host callback still decides', () => {
    (['default', 'acceptEdits', 'plan', 'dontAsk'] as const).forEach((mode) => {
      expect(toolsShadowingCanUseTool(mode, [])).toEqual([]);
    });
  });
});

describe('sessionPermissionMode', () => {
  it('maps "ask" to the SDK mode in which canUseTool is the deciding callback', () => {
    expect(sessionPermissionMode('ask')).toBe('default');
  });

  /**
   * "Smart auto" is deliberately the SDK's REAL `'auto'` mode — the same
   * hosted classifier the Claude CLI's own Auto Mode uses — adopted on
   * explicit user direction after a live probe confirmed it auto-approves
   * almost everything itself (a real `rm`, a read outside the working
   * directory, an outbound `curl`, all with zero `canUseTool` calls). This
   * is the opposite of an earlier design that avoided `'auto'` for exactly
   * that reason; see permissionConfig.ts's module doc comment for why the
   * tradeoff (this app's own Approve/Deny box rarely firing) is accepted.
   */
  it('maps "auto" to the SDK\'s real classifier-driven auto mode', () => {
    expect(sessionPermissionMode('auto')).toBe('auto');
  });
});

describe('buildSessionPermissionOptions', () => {
  it('omits the allowedTools key entirely rather than passing an empty or undefined one', () => {
    // The SDK's options object is built by spreading this result, so the
    // difference matters: a present-but-undefined key is still a key.
    const options = buildSessionPermissionOptions(noopCanUseTool, 'ask');
    expect('allowedTools' in options).toBe(false);
    expect(Object.keys(options).sort()).toEqual([
      'canUseTool',
      'permissionMode',
    ]);
  });

  it('passes the caller-supplied canUseTool through untouched', () => {
    const options = buildSessionPermissionOptions(noopCanUseTool, 'ask');
    expect(options.canUseTool).toBe(noopCanUseTool);
  });

  it('uses "default" for "ask", and the real "auto" for "auto"', () => {
    expect(
      buildSessionPermissionOptions(noopCanUseTool, 'ask').permissionMode,
    ).toBe('default');
    expect(
      buildSessionPermissionOptions(noopCanUseTool, 'auto').permissionMode,
    ).toBe('auto');
  });

  it('produces an "ask" configuration under which the SDK really does consult canUseTool', () => {
    // The regression guard for the bug this module originally fixed: for
    // "ask" mode specifically, whatever AUTO_APPROVED_TOOL_RULES grows to,
    // the resulting options must never shadow the callback for any tool.
    // "auto" is deliberately excluded from this guard — it's SUPPOSED to
    // shadow the callback for ordinary calls now.
    const options = buildSessionPermissionOptions(noopCanUseTool, 'ask');
    expect(
      toolsShadowingCanUseTool(options.permissionMode, options.allowedTools),
    ).toEqual([]);
  });

  it('keeps the pre-approved rule list free of bare tool names', () => {
    expect(
      AUTO_APPROVED_TOOL_RULES.filter((rule) => !rule.includes('(')),
    ).toEqual([]);
  });
});

describe('the daemon itself', () => {
  it('uses Claude Code’s full system prompt instead of the SDK’s minimal default', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../main/daemon/index.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /systemPrompt:\s*\{\s*type:\s*'preset',\s*preset:\s*'claude_code',\s*snapshot:\s*true,\s*\}/,
    );
  });

  it('does not configure allowedTools anywhere outside permissionConfig', () => {
    // buildSessionPermissionOptions is the sanctioned single source of the
    // permission options, but nothing stops a future edit from adding
    // `allowedTools:` straight back into the query() call — which is
    // precisely how the approval gate became dead code the first time, and
    // which no assertion on the builder alone would catch.
    const source = fs.readFileSync(
      path.join(__dirname, '../main/daemon/index.ts'),
      'utf8',
    );
    const withoutLineComments = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(withoutLineComments).not.toMatch(/allowedTools\s*:/);
  });
});
