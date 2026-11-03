import os from 'os';
import type { DaemonEvent } from '../shared/daemonProtocol';
import { createShellHost } from '../main/daemon/shellHost';
import type { ShellPtyLike } from '../main/daemon/shellHost';

interface FakePty extends ShellPtyLike {
  process: string;
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
    process: 'zsh',
    written: [],
    resized: [],
    killed: 0,
    onData: (cb) => {
      dataCb = cb;
    },
    onExit: (cb) => {
      exitCb = cb;
    },
    write: (d) => {
      pty.written.push(d);
    },
    resize: (c, r) => {
      pty.resized.push([c, r]);
    },
    kill: () => {
      pty.killed += 1;
    },
    emitData: (d) => dataCb(d),
    emitExit: () => exitCb(),
  };
  return pty;
}

function setup() {
  const ptys: FakePty[] = [];
  const spawns: Array<{ file: string; args: string[]; opts: any }> = [];
  const events: DaemonEvent[] = [];
  const homedir = os.tmpdir();
  const host = createShellHost({
    spawnPty: (file, args, opts) => {
      const pty = fakePty();
      ptys.push(pty);
      spawns.push({ file, args, opts });
      return pty;
    },
    platform: 'darwin',
    envShell: '/bin/zsh',
    baseEnv: { PATH: '/bin' },
    homedir,
    publishEvent: (e) => events.push(e),
  });
  return { host, ptys, spawns, events, homedir };
}

const req = (id: string, cwd: string) => ({ id, cwd, cols: 80, rows: 24 });

describe('shellHost', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('start spawns the login shell in the cwd', () => {
    const { host, spawns } = setup();
    host.start(req('s1', os.tmpdir()));
    expect(spawns[0].file).toBe('/bin/zsh');
    expect(spawns[0].args).toEqual(['-l']);
    expect(spawns[0].opts.cwd).toBe(os.tmpdir());
    expect(spawns[0].opts.env.TERM).toBe('xterm-256color');
    expect(spawns[0].opts.env.COLORTERM).toBe('truecolor');
  });

  it('falls back to the home directory when the cwd is empty or missing', () => {
    const { host, spawns, homedir } = setup();
    host.start(req('a', ''));
    host.start(req('b', '/definitely/not/a/real/dir'));
    expect(spawns[0].opts.cwd).toBe(homedir);
    expect(spawns[1].opts.cwd).toBe(homedir);
  });

  it('start is idempotent', () => {
    const { host, spawns } = setup();
    host.start(req('s1', ''));
    host.start(req('s1', ''));
    expect(spawns).toHaveLength(1);
  });

  it('publishes shellState busy when the foreground process is not the shell', () => {
    const { host, ptys, events } = setup();
    host.start(req('s1', ''));
    ptys[0].process = 'terraform';
    jest.advanceTimersByTime(500);
    jest.advanceTimersByTime(500);
    const busy = events.filter((e) => e.event === 'shellState');
    expect(busy).toEqual([
      { event: 'shellState', id: 's1', alive: true, busy: true },
    ]);
    ptys[0].process = '-zsh';
    jest.advanceTimersByTime(500);
    expect(events[events.length - 1]).toEqual({
      event: 'shellState',
      id: 's1',
      alive: true,
      busy: false,
    });
  });

  it('exit publishes alive false and forgets the shell', () => {
    const { host, ptys, events } = setup();
    host.start(req('s1', ''));
    ptys[0].emitExit();
    expect(events).toContainEqual({
      event: 'shellState',
      id: 's1',
      alive: false,
      busy: false,
    });
    expect(host.has('s1')).toBe(false);
    expect(host.openCount()).toBe(0);
  });

  it('attach replays buffered output', () => {
    const { host, ptys, events } = setup();
    host.start(req('s1', ''));
    ptys[0].emitData('ab');
    ptys[0].emitData('cd');
    expect(events).toContainEqual({
      event: 'terminalData',
      cardId: 's1',
      data: 'ab',
    });
    events.length = 0;
    host.attach('s1');
    expect(events).toEqual([
      { event: 'terminalReplay', cardId: 's1', data: 'abcd' },
    ]);
  });

  it('input and resize reach the pty, and are ignored for unknown ids', () => {
    const { host, ptys } = setup();
    host.start(req('s1', ''));
    host.input('s1', 'ls\r');
    host.resize('s1', 100, 30);
    host.input('nope', 'x');
    host.resize('nope', 1, 1);
    expect(ptys[0].written).toEqual(['ls\r']);
    expect(ptys[0].resized).toEqual([[100, 30]]);
  });

  it('openCount counts live shells', () => {
    const { host, ptys } = setup();
    host.start(req('a', ''));
    host.start(req('b', ''));
    expect(host.openCount()).toBe(2);
    ptys[0].emitExit();
    expect(host.openCount()).toBe(1);
  });

  it('does not throw when the pty rejects a resize or write', () => {
    const { host, ptys } = setup();
    host.start(req('s1', ''));
    ptys[0].resize = () => {
      throw new Error('ioctl(2) failed, EBADF');
    };
    ptys[0].write = () => {
      throw new Error('EBADF');
    };
    expect(() => host.resize('s1', 10, 10)).not.toThrow();
    expect(() => host.input('s1', 'x')).not.toThrow();
  });
});
