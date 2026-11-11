import type { SessionSnapshot } from '../shared/daemonProtocol';
import {
  appendCapped,
  applyHookEvent,
  applyInterrupt,
  applyPtyExit,
  applySettle,
  holdTimeoutMs,
  HOLD_MAX_MS,
  SUBAGENT_SETTLE_MS,
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

function hook(
  name: string,
  sessionId: string | null = null,
  extra: Partial<HookEvent> = {},
): HookEvent {
  return {
    name,
    sessionId,
    transcriptPath: null,
    notificationType: null,
    source: null,
    agentId: null,
    runningTasks: 0,
    ...extra,
  };
}

describe('splitHookRecords', () => {
  it('parses each complete record and holds back a half-written one', () => {
    const partial = '{"hook_event_name":"Notif';
    expect(
      splitHookRecords(
        `{"hook_event_name":"Stop","session_id":"s"}\n\x1e\n${partial}`,
      ),
    ).toEqual({
      events: [hook('Stop', 's')],
      rest: partial,
    });
  });

  it('reads the transcript path', () => {
    const { events } = splitHookRecords(
      '{"hook_event_name":"Stop","session_id":"s","transcript_path":"/t.jsonl"}\n\x1e\n',
    );
    expect(events).toEqual([hook('Stop', 's', { transcriptPath: '/t.jsonl' })]);
  });

  it('reads the notification type and the session start source', () => {
    const { events } = splitHookRecords(
      '{"hook_event_name":"Notification","notification_type":"idle_prompt"}\n\x1e\n' +
        '{"hook_event_name":"SessionStart","source":"compact"}\n\x1e\n',
    );
    expect(events).toEqual([
      hook('Notification', null, { notificationType: 'idle_prompt' }),
      hook('SessionStart', null, { source: 'compact' }),
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

  it('SessionStart on resume: done, since no turn follows', () => {
    const next = applyHookEvent(
      snapshot({ status: 'interrupted' }),
      hook('SessionStart', 's', { source: 'resume' }),
    );
    expect(next.status).toBe('done');
    expect(next.terminal?.claudeRunning).toBe(true);
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

  it('Notification: an idle prompt leaves the status alone', () => {
    const before = snapshot({ status: 'done' });
    expect(
      applyHookEvent(
        before,
        hook('Notification', null, { notificationType: 'idle_prompt' }),
      ),
    ).toBe(before);
  });

  it('Notification: a permission prompt is still waiting', () => {
    expect(
      applyHookEvent(
        snapshot({ status: 'done' }),
        hook('Notification', null, { notificationType: 'permission_prompt' }),
      ).status,
    ).toBe('waiting');
  });

  it('UserPromptSubmit: an interrupted turn is working again', () => {
    expect(
      applyHookEvent(
        snapshot({ status: 'interrupted' }),
        hook('UserPromptSubmit'),
      ).status,
    ).toBe('working');
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

describe('applyInterrupt', () => {
  it('settles a working turn as done', () => {
    expect(applyInterrupt(snapshot({ status: 'working' })).status).toBe('done');
  });

  it('leaves any other status alone', () => {
    const waiting = snapshot({ status: 'waiting' });
    expect(applyInterrupt(waiting)).toBe(waiting);
    const done = snapshot({ status: 'done' });
    expect(applyInterrupt(done)).toBe(done);
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
    expect(isIdleTerminal(snapshot({ status: 'interrupted' }))).toBe(true);
  });

  it('is not idle while a foreground program runs outside the hooks', () => {
    expect(
      isIdleTerminal(
        snapshot({
          terminal: {
            shellAlive: true,
            claudeRunning: false,
            foregroundBusy: true,
          },
        }),
      ),
    ).toBe(false);
  });

  it('is busy while claude is working', () => {
    expect(isIdleTerminal(snapshot({ status: 'working' }))).toBe(false);
  });
});

describe('background work', () => {
  const start = hook('SubagentStart', null, { agentId: 'a1' });
  const stop = hook('SubagentStop', null, { agentId: 'a1' });
  const stopWith = (extra: Partial<HookEvent>) => hook('Stop', null, extra);

  it('counts every running task Stop reports, whatever its type', () => {
    const tasks = [
      { type: 'subagent', status: 'running' },
      { type: 'shell', status: 'running' },
      { type: 'shell', status: 'completed' },
      { type: 'monitor', status: 'running' },
    ];
    const { events } = splitHookRecords(
      `${JSON.stringify({ hook_event_name: 'Stop', background_tasks: tasks })}\n\x1e\n`,
    );
    expect(events[0]).toMatchObject({ runningTasks: 3 });
  });

  it('holds working when Stop lists a running subagent we never saw start', () => {
    const next = applyHookEvent(snapshot(), stopWith({ runningTasks: 1 }));
    expect(next.status).toBe('working');
    expect(next.terminal?.hold).toBe('running');
  });

  it('holds working when Stop lists only a running monitor', () => {
    const { events } = splitHookRecords(
      `${JSON.stringify({
        hook_event_name: 'Stop',
        background_tasks: [{ type: 'monitor', status: 'running' }],
      })}\n\x1e\n`,
    );
    const next = applyHookEvent(snapshot(), events[0]);
    expect(next.status).toBe('working');
    expect(holdTimeoutMs(next)).toBe(HOLD_MAX_MS);
  });

  it('holds working when Stop lists a running shell', () => {
    const next = applyHookEvent(snapshot(), stopWith({ runningTasks: 1 }));
    expect(next.status).toBe('working');
    expect(holdTimeoutMs(next)).toBe(HOLD_MAX_MS);
  });

  it('holds working for a tracked subagent even if Stop lists nothing', () => {
    const next = applyHookEvent(
      applyHookEvent(snapshot(), start),
      hook('Stop'),
    );
    expect(next.status).toBe('working');
    expect(holdTimeoutMs(next)).toBeNull();
  });

  it('finishes on a Stop that reports nothing running', () => {
    const held = applyHookEvent(snapshot(), stopWith({ runningTasks: 1 }));
    const next = applyHookEvent(held, hook('Stop'));
    expect(next.status).toBe('done');
    expect(next.terminal?.hold).toBeUndefined();
  });

  it('drains for the completion turn after the last subagent stops', () => {
    const held = applyHookEvent(
      applyHookEvent(snapshot(), start),
      hook('Stop'),
    );
    const stopped = applyHookEvent(held, stop);
    expect(stopped.status).toBe('working');
    expect(holdTimeoutMs(stopped)).toBe(SUBAGENT_SETTLE_MS);
    expect(applySettle(stopped).status).toBe('done');
    expect(applySettle(stopped).terminal?.hold).toBeUndefined();
  });

  it('finishes normally when the completion turn follows', () => {
    const held = applyHookEvent(
      applyHookEvent(snapshot(), start),
      hook('Stop'),
    );
    const next = [stop, hook('UserPromptSubmit'), hook('Stop')].reduce(
      applyHookEvent,
      held,
    );
    expect(next.status).toBe('done');
    expect(holdTimeoutMs(next)).toBeNull();
  });

  it('ignores a SubagentStop for an agent it never saw start', () => {
    const held = applyHookEvent(snapshot(), stopWith({ runningTasks: 1 }));
    const next = applyHookEvent(
      held,
      hook('SubagentStop', null, { agentId: 'internal' }),
    );
    expect(next).toBe(held);
  });

  it('stays working while another subagent is still running', () => {
    const two = applyHookEvent(
      applyHookEvent(snapshot(), start),
      hook('SubagentStart', null, { agentId: 'a2' }),
    );
    const held = applyHookEvent(two, hook('Stop'));
    const next = applyHookEvent(held, stop);
    expect(next.status).toBe('working');
    expect(holdTimeoutMs(next)).toBeNull();
  });

  it('does not settle a card with no hold', () => {
    expect(applySettle(snapshot())).toEqual(snapshot());
  });

  it('clears the hold on interrupt, session end and pty exit', () => {
    const held = applyHookEvent(
      applyHookEvent(snapshot(), start),
      hook('Stop'),
    );
    expect(applyInterrupt(held).terminal?.hold).toBeUndefined();
    expect(
      applyHookEvent(held, hook('SessionEnd')).terminal?.hold,
    ).toBeUndefined();
    expect(applyPtyExit(held).terminal?.hold).toBeUndefined();
  });
});

describe('PreToolUse', () => {
  it('wakes a done card when the main agent starts using tools', () => {
    const next = applyHookEvent(
      snapshot({ status: 'done' }),
      hook('PreToolUse'),
    );
    expect(next.status).toBe('working');
  });

  it('ignores a subagent tool call', () => {
    const done = snapshot({ status: 'done' });
    expect(
      applyHookEvent(done, hook('PreToolUse', null, { agentId: 'a1' })),
    ).toBe(done);
  });

  it('wakes a done card on a finished tool call too', () => {
    const next = applyHookEvent(
      snapshot({ status: 'done' }),
      hook('PostToolUse'),
    );
    expect(next.status).toBe('working');
  });

  it('returns a waiting card to working once its tool has run', () => {
    const waiting = snapshot({ status: 'waiting' });
    expect(applyHookEvent(waiting, hook('PostToolUse')).status).toBe('working');
    expect(
      applyHookEvent(waiting, hook('PostToolUse', null, { agentId: 'a1' })),
    ).toBe(waiting);
  });

  it('keeps waiting for a tool that is only about to ask', () => {
    const waiting = snapshot({ status: 'waiting' });
    expect(applyHookEvent(waiting, hook('PreToolUse'))).toBe(waiting);
  });

  it('leaves a working card alone', () => {
    const working = snapshot();
    expect(applyHookEvent(working, hook('PreToolUse'))).toBe(working);
    expect(applyHookEvent(working, hook('PostToolUse'))).toBe(working);
  });
});
