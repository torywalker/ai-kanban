import fs from 'fs';
import os from 'os';
import path from 'path';
import type {
  DaemonEvent,
  DaemonRequest,
  SessionSnapshot,
} from '../shared/daemonProtocol';
import {
  createTerminalHost,
  type PtyLike,
  type TerminalHost,
} from '../main/daemon/terminalHost';

type TerminalStart = Extract<DaemonRequest, { op: 'terminalStart' }>;

interface FakePty extends PtyLike {
  emitData(d: string): void;
  emitExit(): void;
  written: string[];
  resized: Array<[number, number]>;
  killed: number;
}

function fakePty(): FakePty {
  let dataCb: (d: string) => void = () => undefined;
  let exitCb: () => void = () => undefined;
  const pty: FakePty = {
    written: [],
    resized: [],
    killed: 0,
    onData: (cb) => {
      dataCb = cb;
    },
    onExit: (cb) => {
      exitCb = cb;
    },
    write: (d) => pty.written.push(d),
    resize: (c, r) => pty.resized.push([c, r]),
    kill: () => {
      pty.killed += 1;
    },
    emitData: (d) => dataCb(d),
    emitExit: () => exitCb(),
  };
  return pty;
}

const DAY_MS = 24 * 60 * 60 * 1000;

let hookDir: string;
let ptys: FakePty[];
let spawnCalls: Array<{ file: string; args: string[]; opts: unknown }>;
let snapshots: SessionSnapshot[];
let events: DaemonEvent[];
let usage: jest.Mock;
let transcriptStart: jest.Mock;
let host: TerminalHost;
let clock: number;

function request(overrides: Partial<TerminalStart> = {}): TerminalStart {
  return {
    op: 'terminalStart',
    cardId: 'crd_1',
    cwd: os.tmpdir(),
    prompt: 'do it',
    model: null,
    approvalMode: 'ask',
    sessionId: 'sess-1',
    claudeCliPath: null,
    cols: 80,
    rows: 24,
    ...overrides,
  };
}

const lastSnapshot = (): SessionSnapshot => snapshots[snapshots.length - 1];
const hookFile = (cardId = 'crd_1') => path.join(hookDir, `${cardId}.log`);
const record = (body: object) => `${JSON.stringify(body)}\n\x1e\n`;
const appendHook = (text: string, cardId = 'crd_1') =>
  fs.appendFileSync(hookFile(cardId), text);

beforeEach(() => {
  jest.useFakeTimers();
  hookDir = fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-hooks-'));
  ptys = [];
  spawnCalls = [];
  snapshots = [];
  events = [];
  usage = jest.fn();
  transcriptStart = jest.fn();
  clock = 0;
  host = createTerminalHost({
    spawnPty: (file, args, opts) => {
      spawnCalls.push({ file, args, opts });
      const pty = fakePty();
      ptys.push(pty);
      return pty;
    },
    hookDir,
    platform: 'darwin',
    envShell: '/bin/zsh',
    baseEnv: { PATH: '/usr/bin' },
    publishSnapshot: (s) => snapshots.push(s),
    publishEvent: (e) => events.push(e),
    onUsageBatch: usage,
    onTranscriptStart: transcriptStart,
    now: () => clock,
  });
});

afterEach(() => {
  host.dispose();
  jest.useRealTimers();
  fs.rmSync(hookDir, { recursive: true, force: true });
});

describe('start', () => {
  it('spawns once and publishes a live terminal snapshot', () => {
    host.start(request());
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].file).toBe('/bin/zsh');
    expect(spawnCalls[0].opts).toMatchObject({
      cwd: os.tmpdir(),
      cols: 80,
      rows: 24,
    });
    expect(spawnCalls[0].args[3]).toContain("--resume 'sess-1'");
    expect(lastSnapshot()).toMatchObject({
      cardId: 'crd_1',
      engine: 'terminal',
      status: 'working',
      sessionId: 'sess-1',
      terminal: { shellAlive: true, claudeRunning: false },
    });
    expect(host.openCount()).toBe(1);
  });

  it('creates an empty hook file, truncating any old one', () => {
    fs.writeFileSync(hookFile(), 'stale');
    host.start(request());
    expect(fs.readFileSync(hookFile(), 'utf8')).toBe('');
  });

  it('starts a new conversation with a generated uuid when there is no session id', () => {
    host.start(request({ sessionId: null }));
    expect(lastSnapshot().sessionId).toBeNull();
    const script = spawnCalls[0].args[3];
    const generatedId = script.match(/--session-id '([^']+)'/)?.[1];
    expect(generatedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(script).toContain(`--session-id '${generatedId}'`);
    expect(script).toContain("-- 'do it'");
  });

  it('does not spawn a second pty for a card that already has one', () => {
    host.start(request());
    host.start(request());
    expect(spawnCalls).toHaveLength(1);
  });

  it('republishes the live snapshot when started again', () => {
    host.start(request());
    appendHook(record({ hook_event_name: 'Notification' }));
    jest.advanceTimersByTime(250);
    snapshots = [];
    host.start(request());
    expect(snapshots).toEqual([host.snapshot('crd_1')]);
    expect(lastSnapshot().status).toBe('waiting');
  });

  it('refuses a working directory that does not exist', () => {
    host.start(request({ cwd: '/no/such/dir' }));
    expect(spawnCalls).toHaveLength(0);
    expect(lastSnapshot()).toMatchObject({
      status: 'failed',
      lastError: 'Working directory does not exist: /no/such/dir',
    });
  });

  it('reports a spawn failure on the snapshot instead of throwing', () => {
    const failing = createTerminalHost({
      spawnPty: () => {
        throw new Error('posix_spawnp failed.');
      },
      hookDir,
      platform: 'darwin',
      envShell: undefined,
      baseEnv: {},
      publishSnapshot: (s) => snapshots.push(s),
      publishEvent: (e) => events.push(e),
      onUsageBatch: usage,
      onTranscriptStart: jest.fn(),
      now: () => Date.now(),
    });
    expect(() => failing.start(request())).not.toThrow();
    expect(lastSnapshot()).toMatchObject({
      status: 'failed',
      lastError: 'posix_spawnp failed.',
      sessionId: 'sess-1',
      terminal: { shellAlive: false, claudeRunning: false },
    });
    expect(failing.openCount()).toBe(0);
  });

  it('does not persist a generated id when a new-conversation spawn fails', () => {
    const failing = createTerminalHost({
      spawnPty: () => {
        throw new Error('spawn failed');
      },
      hookDir,
      platform: 'darwin',
      envShell: undefined,
      baseEnv: {},
      publishSnapshot: (s) => snapshots.push(s),
      publishEvent: (e) => events.push(e),
      onUsageBatch: usage,
      onTranscriptStart: jest.fn(),
      now: () => clock,
    });
    failing.start(request({ sessionId: null }));
    expect(lastSnapshot()).toMatchObject({
      status: 'failed',
      sessionId: null,
      terminal: { shellAlive: false, claudeRunning: false },
    });
  });
});

describe('output', () => {
  it('streams pty data and replays exactly the buffered output on attach', () => {
    host.start(request());
    ptys[0].emitData('hello');
    expect(events).toEqual([
      { event: 'terminalReplay', cardId: 'crd_1', data: '' },
      { event: 'terminalData', cardId: 'crd_1', data: 'hello' },
    ]);
    ptys[0].emitData(' world\r\n');
    events = [];
    host.attach('crd_1');
    expect(events).toEqual([
      { event: 'terminalReplay', cardId: 'crd_1', data: 'hello world\r\n' },
    ]);
  });

  it('publishes an empty replay before any pty data on start', () => {
    host.start(request());
    expect(events[0]).toEqual({
      event: 'terminalReplay',
      cardId: 'crd_1',
      data: '',
    });
    ptys[0].emitData('hello');
    const replayAt = events.findIndex((e) => e.event === 'terminalReplay');
    const dataAt = events.findIndex((e) => e.event === 'terminalData');
    expect(replayAt).toBeGreaterThanOrEqual(0);
    expect(dataAt).toBeGreaterThan(replayAt);
  });

  it('publishes an empty replay when the card has no live pty', () => {
    host.attach('crd_none');
    expect(events).toEqual([
      { event: 'terminalReplay', cardId: 'crd_none', data: '' },
    ]);
    expect(snapshots).toEqual([]);
  });

  it('republishes the live snapshot on attach', () => {
    host.start(request());
    snapshots = [];
    host.attach('crd_1');
    expect(snapshots).toEqual([host.snapshot('crd_1')]);
    expect(lastSnapshot()).toMatchObject({
      engine: 'terminal',
      terminal: { shellAlive: true },
    });
  });
});

describe('hook status', () => {
  it('publishes waiting after a Notification record is polled', () => {
    host.start(request());
    snapshots = [];
    appendHook(record({ hook_event_name: 'Notification', session_id: 's' }));
    jest.advanceTimersByTime(250);
    expect(lastSnapshot().status).toBe('waiting');
  });

  it('holds a half-written record until its separator arrives', () => {
    host.start(request());
    snapshots = [];
    const full = record({ hook_event_name: 'Notification' });
    appendHook(full.slice(0, 10));
    jest.advanceTimersByTime(250);
    appendHook(full.slice(10, -2));
    jest.advanceTimersByTime(250);
    expect(snapshots).toEqual([]);
    appendHook(full.slice(-2));
    jest.advanceTimersByTime(250);
    expect(snapshots).toHaveLength(1);
    expect(lastSnapshot().status).toBe('waiting');
  });

  it('adopts the session id SessionStart reports and marks claude running', () => {
    host.start(request({ sessionId: null }));
    expect(lastSnapshot().sessionId).toBeNull();
    appendHook(record({ hook_event_name: 'SessionStart', session_id: 'real' }));
    jest.advanceTimersByTime(250);
    expect(lastSnapshot()).toMatchObject({
      sessionId: 'real',
      terminal: { shellAlive: true, claudeRunning: true },
    });
  });

  it('primes on every SessionStart that names a transcript, before Stop in the same poll', () => {
    host.start(request());
    const order: string[] = [];
    transcriptStart.mockImplementation(() => order.push('start'));
    usage.mockImplementation(() => order.push('usage'));
    appendHook(
      record({
        hook_event_name: 'SessionStart',
        session_id: 's',
        transcript_path: '/tmp/a.jsonl',
      }) +
        record({
          hook_event_name: 'Stop',
          session_id: 's',
          transcript_path: '/tmp/a.jsonl',
        }),
    );
    jest.advanceTimersByTime(250);
    expect(transcriptStart).toHaveBeenCalledTimes(1);
    expect(transcriptStart).toHaveBeenCalledWith('crd_1', '/tmp/a.jsonl');
    expect(order).toEqual(['start', 'usage']);

    appendHook(
      record({
        hook_event_name: 'SessionStart',
        session_id: 's',
        transcript_path: '/tmp/b.jsonl',
      }),
    );
    jest.advanceTimersByTime(250);
    expect(transcriptStart).toHaveBeenCalledTimes(2);
    expect(transcriptStart).toHaveBeenLastCalledWith('crd_1', '/tmp/b.jsonl');
  });

  it('does not prime after a compaction, whose turns are not yet billed', () => {
    host.start(request());
    appendHook(
      record({
        hook_event_name: 'SessionStart',
        session_id: 's',
        transcript_path: '/tmp/a.jsonl',
        source: 'compact',
      }),
    );
    jest.advanceTimersByTime(250);
    expect(transcriptStart).not.toHaveBeenCalled();
    expect(lastSnapshot().status).toBe('working');
  });

  it('records usage on Stop (first batch, then later ones) and on SessionEnd', () => {
    host.start(request());
    const stop = record({
      hook_event_name: 'Stop',
      session_id: 's',
      transcript_path: '/t.jsonl',
    });
    appendHook(stop);
    jest.advanceTimersByTime(250);
    expect(usage).toHaveBeenLastCalledWith('crd_1', '/t.jsonl', true);
    appendHook(stop);
    jest.advanceTimersByTime(250);
    expect(usage).toHaveBeenLastCalledWith('crd_1', '/t.jsonl', false);
    appendHook(
      record({
        hook_event_name: 'SessionEnd',
        session_id: 's',
        transcript_path: '/t.jsonl',
      }),
    );
    jest.advanceTimersByTime(250);
    expect(usage).toHaveBeenCalledTimes(3);
    expect(usage).toHaveBeenLastCalledWith('crd_1', '/t.jsonl', false);
  });
});

describe('controls', () => {
  it('forwards input and resize to the pty', () => {
    host.start(request());
    host.input('crd_1', 'ls\r');
    host.resize('crd_1', 120, 40);
    expect(ptys[0].written).toEqual(['ls\r']);
    expect(ptys[0].resized).toEqual([[120, 40]]);
  });

  it('interrupts with Escape', () => {
    host.start(request());
    host.interrupt('crd_1');
    expect(ptys[0].written).toEqual(['\x1b']);
  });

  it('marks a working turn interrupted, and a new prompt makes it working', () => {
    host.start(request());
    appendHook(record({ hook_event_name: 'UserPromptSubmit' }));
    jest.advanceTimersByTime(250);
    host.interrupt('crd_1');
    expect(lastSnapshot().status).toBe('interrupted');
    appendHook(record({ hook_event_name: 'UserPromptSubmit' }));
    jest.advanceTimersByTime(250);
    expect(lastSnapshot().status).toBe('working');
  });

  it('marks a working turn interrupted when Escape is typed', () => {
    host.start(request());
    appendHook(record({ hook_event_name: 'UserPromptSubmit' }));
    jest.advanceTimersByTime(250);
    host.input('crd_1', '\x1b');
    expect(ptys[0].written).toEqual(['\x1b']);
    expect(lastSnapshot().status).toBe('interrupted');
    expect(host.liveSnapshot('crd_1')?.status).toBe('interrupted');
  });

  it('leaves the status alone for escape sequences and other input', () => {
    host.start(request());
    appendHook(record({ hook_event_name: 'UserPromptSubmit' }));
    jest.advanceTimersByTime(250);
    snapshots = [];
    host.input('crd_1', '\x1b[A');
    host.input('crd_1', 'x\x1b');
    expect(ptys[0].written).toEqual(['\x1b[A', 'x\x1b']);
    expect(snapshots).toEqual([]);
    expect(host.liveSnapshot('crd_1')?.status).toBe('working');
  });

  it('does not republish a typed Escape while claude is waiting', () => {
    host.start(request());
    appendHook(record({ hook_event_name: 'Notification' }));
    jest.advanceTimersByTime(250);
    snapshots = [];
    host.input('crd_1', '\x1b');
    expect(snapshots).toEqual([]);
    expect(host.liveSnapshot('crd_1')?.status).toBe('waiting');
  });

  it('does not republish an interrupt while claude is waiting', () => {
    host.start(request());
    appendHook(record({ hook_event_name: 'Notification' }));
    jest.advanceTimersByTime(250);
    snapshots = [];
    host.interrupt('crd_1');
    expect(snapshots).toEqual([]);
  });

  it('close kills the pty, and its exit closes the terminal', () => {
    host.start(request());
    host.close('crd_1');
    expect(ptys[0].killed).toBe(1);
    ptys[0].emitExit();
    expect(host.openCount()).toBe(0);
    expect(lastSnapshot()).toMatchObject({
      status: 'done',
      terminal: { shellAlive: false, claudeRunning: false },
    });
  });

  it('reads usage one last time when the pty exits without SessionEnd', () => {
    host.start(request());
    appendHook(
      record({
        hook_event_name: 'Stop',
        session_id: 's',
        transcript_path: '/t.jsonl',
      }),
    );
    jest.advanceTimersByTime(250);
    expect(usage).toHaveBeenCalledTimes(1);
    ptys[0].emitExit();
    expect(usage).toHaveBeenCalledTimes(2);
    expect(usage).toHaveBeenLastCalledWith('crd_1', '/t.jsonl', false);
  });

  it('does not read usage again when the final poll already billed SessionEnd', () => {
    host.start(request());
    appendHook(
      record({
        hook_event_name: 'SessionEnd',
        session_id: 's',
        transcript_path: '/t.jsonl',
      }),
    );
    ptys[0].emitExit();
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith('crd_1', '/t.jsonl', true);
  });

  it('reads no usage on exit when no transcript is known', () => {
    host.start(request());
    ptys[0].emitExit();
    expect(usage).not.toHaveBeenCalled();
  });

  it('reads the hook records written just before the pty exited', () => {
    host.start(request());
    appendHook(record({ hook_event_name: 'SessionStart', session_id: 'real' }));
    ptys[0].emitExit();
    expect(lastSnapshot().sessionId).toBe('real');
  });

  it('can start a fresh terminal after the previous one exited', () => {
    host.start(request());
    ptys[0].emitExit();
    host.start(request());
    expect(spawnCalls).toHaveLength(2);
    expect(host.openCount()).toBe(1);
  });

  it('ignores controls for a card with no terminal', () => {
    expect(() => {
      host.input('crd_none', 'x');
      host.resize('crd_none', 1, 1);
      host.interrupt('crd_none');
      host.close('crd_none');
    }).not.toThrow();
  });
});

// The idle check runs on each hook poll against the injected clock, so
// these move `clock` instead of stepping through a day of 250 ms polls.
describe('idle timeout', () => {
  const advanceClock = (ms: number) => {
    clock += ms;
    jest.advanceTimersByTime(250);
  };

  it('kills a terminal after 24 hours with no output and no input', () => {
    host.start(request());
    advanceClock(DAY_MS - 1);
    expect(ptys[0].killed).toBe(0);
    advanceClock(1);
    expect(ptys[0].killed).toBe(1);
  });

  it('restarts the clock on input and on output', () => {
    host.start(request());
    advanceClock(DAY_MS - 1000);
    host.input('crd_1', 'x');
    advanceClock(DAY_MS - 1000);
    ptys[0].emitData('y');
    advanceClock(DAY_MS - 1000);
    expect(ptys[0].killed).toBe(0);
    advanceClock(1000);
    expect(ptys[0].killed).toBe(1);
  });

  it('does not kill again on every poll while the pty is exiting', () => {
    host.start(request());
    advanceClock(DAY_MS);
    advanceClock(0);
    advanceClock(0);
    expect(ptys[0].killed).toBe(1);
  });
});

describe('closeIdle', () => {
  it('kills only idle terminals', () => {
    host.start(request({ cardId: 'busy' }));
    host.start(request({ cardId: 'waiting' }));
    host.start(request({ cardId: 'shell' }));
    appendHook(record({ hook_event_name: 'SessionStart' }), 'busy');
    appendHook(record({ hook_event_name: 'SessionStart' }), 'waiting');
    appendHook(record({ hook_event_name: 'Notification' }), 'waiting');
    jest.advanceTimersByTime(250);
    host.closeIdle();
    expect(ptys.map((p) => p.killed)).toEqual([0, 1, 1]);
  });
});

describe('dispose', () => {
  it('kills every pty and stops polling', () => {
    host.start(request({ cardId: 'a' }));
    host.start(request({ cardId: 'b' }));
    host.dispose();
    expect(ptys.map((p) => p.killed)).toEqual([1, 1]);
    expect(host.openCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('snapshot', () => {
  it('retains the last terminal snapshot after exit for getState', () => {
    host.start(request());
    expect(host.snapshot('crd_1')).toEqual(lastSnapshot());
    ptys[0].emitExit();
    expect(host.snapshot('crd_1')).toEqual(lastSnapshot());
  });

  it('liveSnapshot is only the live pty', () => {
    host.start(request());
    expect(host.liveSnapshot('crd_1')).toEqual(lastSnapshot());
    ptys[0].emitExit();
    expect(host.liveSnapshot('crd_1')).toBeUndefined();
    expect(host.snapshot('crd_1')).toEqual(lastSnapshot());
  });

  it('forget drops an exited terminal snapshot', () => {
    host.start(request());
    ptys[0].emitExit();
    host.forget('crd_1');
    expect(host.snapshot('crd_1')).toBeUndefined();
  });

  it('clears a previous terminal snapshot when starting again', () => {
    host.start(request());
    ptys[0].emitExit();
    const exited = host.snapshot('crd_1');
    host.start(request());
    expect(host.snapshot('crd_1')).not.toEqual(exited);
    expect(host.snapshot('crd_1')).toEqual(lastSnapshot());
  });
});
