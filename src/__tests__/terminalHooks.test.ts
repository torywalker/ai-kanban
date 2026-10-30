import type { SessionSnapshot } from '../shared/daemonProtocol';
import {
  appendCapped,
  applyHookEvent,
  applyPtyExit,
  isIdleTerminal,
  splitHookRecords,
  type HookEvent,
} from '../main/daemon/terminalHooks';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    cardId: 'crd_1',
    sessionId: 'u-1',
    status: 'working',
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
    engine: 'terminal',
    terminal: { shellAlive: true, claudeRunning: true },
    ...overrides,
  };
}

function hook(name: string, sessionId: string | null = null): HookEvent {
  return { name, sessionId, transcriptPath: null };
}

describe('splitHookRecords', () => {
  it('parses each complete record and holds back a half-written one', () => {
    const partial = '{"hook_event_name":"Notif';
    expect(
      splitHookRecords(
        `{"hook_event_name":"Stop","session_id":"s"}\n\x1e\n${partial}`,
      ),
    ).toEqual({
      events: [{ name: 'Stop', sessionId: 's', transcriptPath: null }],
      rest: partial,
    });
  });

  it('reads the transcript path', () => {
    const { events } = splitHookRecords(
      '{"hook_event_name":"Stop","session_id":"s","transcript_path":"/t.jsonl"}\n\x1e\n',
    );
    expect(events).toEqual([
      { name: 'Stop', sessionId: 's', transcriptPath: '/t.jsonl' },
    ]);
  });

  it('skips a malformed record and still parses the next one', () => {
    const { events, rest } = splitHookRecords(
      '{not json\n\x1e\n{"hook_event_name":"Notification"}\n\x1e\n',
    );
    expect(events).toEqual([hook('Notification')]);
    expect(rest).toBe('');
  });

  it('holds a record whose separator has not arrived', () => {
    expect(splitHookRecords('{"hook_event_name":"Stop"}\n')).toEqual({
      events: [],
      rest: '{"hook_event_name":"Stop"}\n',
    });
  });
});

describe('applyHookEvent (spec §4.3)', () => {
  it('SessionStart: claude is running, working, and the session id is adopted', () => {
    const next = applyHookEvent(
      snapshot({
        status: 'done',
        sessionId: 'old',
        terminal: { shellAlive: true, claudeRunning: false },
      }),
      hook('SessionStart', 'new'),
    );
    expect(next.status).toBe('working');
    expect(next.sessionId).toBe('new');
    expect(next.terminal).toEqual({ shellAlive: true, claudeRunning: true });
  });

  it('UserPromptSubmit: working', () => {
    const next = applyHookEvent(
      snapshot({ status: 'done' }),
      hook('UserPromptSubmit'),
    );
    expect(next.status).toBe('working');
    expect(next.terminal).toEqual({ shellAlive: true, claudeRunning: true });
  });

  it('Notification: waiting', () => {
    expect(applyHookEvent(snapshot(), hook('Notification')).status).toBe(
      'waiting',
    );
  });

  it('Stop: done', () => {
    const next = applyHookEvent(snapshot(), hook('Stop'));
    expect(next.status).toBe('done');
    expect(next.terminal).toEqual({ shellAlive: true, claudeRunning: true });
  });

  it('SessionEnd: claude stops running and working becomes done', () => {
    const next = applyHookEvent(snapshot(), hook('SessionEnd'));
    expect(next.status).toBe('done');
    expect(next.terminal).toEqual({ shellAlive: true, claudeRunning: false });
  });

  it('SessionEnd: waiting becomes done too', () => {
    expect(
      applyHookEvent(snapshot({ status: 'waiting' }), hook('SessionEnd'))
        .status,
    ).toBe('done');
  });

  it('SessionEnd: any other status is kept', () => {
    expect(
      applyHookEvent(snapshot({ status: 'failed' }), hook('SessionEnd')).status,
    ).toBe('failed');
  });

  it('ignores events it does not know', () => {
    const before = snapshot();
    expect(applyHookEvent(before, hook('PreToolUse'))).toBe(before);
  });
});

describe('applyPtyExit', () => {
  it('marks the shell and claude gone and settles waiting as done', () => {
    const next = applyPtyExit(snapshot({ status: 'waiting' }));
    expect(next.status).toBe('done');
    expect(next.terminal).toEqual({ shellAlive: false, claudeRunning: false });
  });

  it('settles working as done and keeps any other status', () => {
    expect(applyPtyExit(snapshot({ status: 'working' })).status).toBe('done');
    expect(applyPtyExit(snapshot({ status: 'failed' })).status).toBe('failed');
  });
});

describe('appendCapped', () => {
  it('keeps only the newest max characters', () => {
    expect(appendCapped('a'.repeat(10), 'bcd', 8)).toBe('aaaaabcd');
  });

  it('defaults to a 1,000,000 character cap', () => {
    const out = appendCapped('a'.repeat(1_000_000), 'b');
    expect(out).toHaveLength(1_000_000);
    expect(out.endsWith('ab')).toBe(true);
  });
});

describe('isIdleTerminal', () => {
  it('is idle when the shell is alive and claude is not running', () => {
    expect(
      isIdleTerminal(
        snapshot({ terminal: { shellAlive: true, claudeRunning: false } }),
      ),
    ).toBe(true);
  });

  it('is idle while claude waits or has finished', () => {
    expect(isIdleTerminal(snapshot({ status: 'waiting' }))).toBe(true);
    expect(isIdleTerminal(snapshot({ status: 'done' }))).toBe(true);
  });

  it('is busy while claude is working', () => {
    expect(isIdleTerminal(snapshot({ status: 'working' }))).toBe(false);
  });
});
