import net from 'net';
import path from 'path';
import { app } from 'electron';
import { spawn, type ChildProcess } from 'child_process';
import type { DaemonRequest, DaemonEvent } from '@shared/daemonProtocol';
import { createFrameDecoder, encodeFrame } from '../daemon/framing';
import {
  computeBuildId,
  pidFilePathFor,
  readDaemonPid,
  shouldReplaceDaemon,
} from '../daemon/daemonIdentity';

export function getSessionDaemonSocketPath(): string {
  return path.join(app.getPath('userData'), 'session-daemon.sock');
}

function getDaemonBundlePath(): string {
  return app.isPackaged
    ? path.join(__dirname, 'daemon.js')
    : path.join(__dirname, '../../.erb/dll/daemon.bundle.dev.js');
}

let client: net.Socket | null = null;
let connecting: Promise<void> | null = null;
const eventListeners = new Set<(event: DaemonEvent) => void>();

/**
 * Set for the duration of a build-id handshake. The `pong` has to arrive
 * through the SAME frame decoder the socket keeps for the rest of its life:
 * a second, temporary decoder would own its own reassembly buffer, and a
 * frame split across two TCP reads during the handshake would leave its tail
 * bytes in a buffer that is then thrown away — desynchronising every frame
 * after it.
 */
interface DaemonIdentity {
  buildId: string | null;
  /** Undefined when the daemon is too old to report it — reads as idle. */
  activeTurns: number | undefined;
}

let pendingPong: ((identity: DaemonIdentity) => void) | null = null;

/** How long to wait for a `pong` before treating the daemon as unidentifiable. */
const PING_TIMEOUT_MS = 2_000;

/** How long to wait for a replaced daemon to actually release the socket. */
const SHUTDOWN_TIMEOUT_MS = 5_000;

function attachDecoder(socket: net.Socket): void {
  const decode = createFrameDecoder((raw) => {
    const event = raw as DaemonEvent;
    if (event.event === 'pong') {
      const resolve = pendingPong;
      pendingPong = null;
      resolve?.({
        buildId: event.buildId ?? null,
        activeTurns: event.activeTurns,
      });
      return;
    }
    eventListeners.forEach((listener) => listener(event));
  });
  socket.on('data', decode);
}

/**
 * Who the daemon on the other end is: which build it runs, and how much work
 * it currently has in flight. The turn count is what stops a rebuilt bundle
 * from destroying a streaming session — see `shouldReplaceDaemon`.
 */
function pingForIdentity(socket: net.Socket): Promise<DaemonIdentity> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (identity: DaemonIdentity) => {
      if (settled) return;
      settled = true;
      pendingPong = null;
      resolve(identity);
    };
    // A daemon that never answers reports nothing and no turn count, so it
    // is treated as a stale idle one: unusable either way, and hanging every
    // session operation behind it forever is worse.
    const timer = setTimeout(
      () => finish({ buildId: null, activeTurns: undefined }),
      PING_TIMEOUT_MS,
    );
    pendingPong = (identity) => {
      clearTimeout(timer);
      finish(identity);
    };
    socket.write(encodeFrame({ op: 'ping' }));
  });
}

/** Resolves once nothing is accepting connections on the socket any more. */
function waitForSocketReleased(socketPath: string): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
    const check = () => {
      connect(socketPath).then(
        (socket) => {
          socket.destroy();
          if (Date.now() >= deadline) {
            resolve();
            return;
          }
          setTimeout(check, 100);
        },
        () => resolve(),
      );
    };
    check();
  });
}

/**
 * Evicts a daemon running the wrong build.
 *
 * SIGTERM via the recorded pid rather than a "please shut down" request op,
 * because the daemon most in need of eviction is by definition an old build:
 * it would not recognise a new op and would ignore it in silence. The
 * daemon's own SIGTERM handler closes the server and exits cleanly.
 *
 * A daemon with no pid file cannot be signalled at all — it predates the
 * file. Spawning over it still works (the new daemon unlinks and rebinds the
 * socket), at the cost of leaving the old process orphaned, so this is
 * reported loudly rather than passed over.
 */
async function terminateStaleDaemon(socketPath: string): Promise<void> {
  const pid = readDaemonPid(pidFilePathFor(socketPath));
  if (pid === null) {
    // eslint-disable-next-line no-console
    console.warn(
      'session daemon: running a stale build and recorded no pid — spawning over it. ' +
        'The old process will be orphaned; kill it manually to reclaim its memory.',
    );
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone, or not ours to signal. Either way there is nothing to
    // wait for beyond the socket check below.
  }
  await waitForSocketReleased(socketPath);
}

function connect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/**
 * Polls `connect()` until the freshly-spawned daemon's socket comes up, or
 * gives up.
 *
 * A single fixed delay here previously caused real, reproducible failures:
 * the daemon's actual cold-start (spawning `process.execPath` under
 * `ELECTRON_RUN_AS_NODE`, then a dynamic `import()` of the ESM-only Agent
 * SDK) measured multiple seconds on this machine — nowhere near the 500ms
 * this used to wait before retrying exactly once. When that one retry lost
 * the race, the resulting ENOENT propagated verbatim out to the renderer
 * (`Error invoking remote method 'session:run': ... connect ENOENT ...`)
 * even though the daemon went on to bind successfully moments later.
 * Polling with a short interval up to a generous ceiling tracks the real
 * condition (the socket existing) instead of guessing a fixed wait, and
 * bails out immediately — rather than waiting out the full ceiling — if the
 * child process itself exits or errors first, since no amount of further
 * waiting will make a dead process start listening.
 */
function connectWithRetry(
  socketPath: string,
  child: ChildProcess,
  { timeoutMs = 20_000, intervalMs = 150 } = {},
): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let childFailure: Error | null = null;
    const deadline = Date.now() + timeoutMs;

    child.once('error', (error) => {
      childFailure = error;
    });
    child.once('exit', (code, signal) => {
      childFailure ??= new Error(
        `session daemon exited before it started listening (code ${code}, signal ${signal})`,
      );
    });

    const attempt = () => {
      connect(socketPath).then(
        (socket) => {
          if (!settled) {
            settled = true;
            resolve(socket);
          }
        },
        (error) => {
          if (settled) return;
          if (childFailure) {
            settled = true;
            reject(childFailure);
            return;
          }
          if (Date.now() >= deadline) {
            settled = true;
            reject(error);
            return;
          }
          setTimeout(attempt, intervalMs);
        },
      );
    };

    attempt();
  });
}

/**
 * Spawns the daemon if it is not already listening, then connects. Safe to
 * call every time a session operation is needed — a daemon that is already
 * running (because it was left running by a previous app launch, per the
 * spec's cross-restart persistence requirement) is detected by a successful
 * connect and reused rather than re-spawned.
 *
 * Concurrent callers that arrive while a connect/spawn attempt is already in
 * flight await that SAME attempt instead of each racing an independent
 * spawn — two independent spawns would have the second daemon's startup
 * unlink the socket file the first daemon is bound to, orphaning the first
 * as an unreachable zombie process.
 */
export async function ensureDaemonRunning(): Promise<void> {
  if (client && !client.destroyed) return;
  if (connecting) return connecting;

  connecting = (async () => {
    const socketPath = getSessionDaemonSocketPath();
    const bundlePath = getDaemonBundlePath();

    const spawnDaemon = async (): Promise<net.Socket> => {
      const child = spawn(process.execPath, [bundlePath, socketPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      const socket = await connectWithRetry(socketPath, child);
      attachDecoder(socket);
      // No handshake needed: this daemon was just launched from the very
      // bundle the expectation is derived from.
      return socket;
    };

    let socket: net.Socket | null = null;
    try {
      socket = await connect(socketPath);
    } catch {
      // No daemon listening yet (or a stale socket file) — spawn one.
      socket = null;
    }

    if (socket) {
      attachDecoder(socket);
      /**
       * A daemon found already listening is NOT automatically usable. It
       * survives app restarts by design (detached + unref'd, so sessions
       * outlive the window), which means it can easily be running code from
       * before the current build — and reusing it makes every daemon-side
       * change appear to do nothing, with no error to explain why. Asking
       * which build answered is the only way to tell.
       */
      const expected = computeBuildId(bundlePath);
      // No round-trip when there is nothing to compare against: an
      // unreadable bundle can never justify evicting a live daemon (see
      // `shouldReplaceDaemon`), so asking would only delay every session
      // operation by a handshake that cannot change the outcome.
      const identity = expected
        ? await pingForIdentity(socket)
        : { buildId: null, activeTurns: undefined };
      if (
        shouldReplaceDaemon(expected, identity.buildId, identity.activeTurns)
      ) {
        // eslint-disable-next-line no-console
        console.log(
          `session daemon: replacing daemon built from ${identity.buildId ?? 'an unidentified build'}`,
        );
        socket.destroy();
        await terminateStaleDaemon(socketPath);
        socket = await spawnDaemon();
      }
    } else {
      socket = await spawnDaemon();
    }

    client = socket;
    client.on('close', () => {
      client = null;
    });
  })();

  try {
    await connecting;
  } finally {
    connecting = null;
  }
}

/**
 * User-initiated equivalent of the automatic build-mismatch eviction inside
 * `ensureDaemonRunning` above: signals whatever daemon is currently running
 * (regardless of which build it reports — a wedged daemon on the CURRENT
 * build is exactly what this button exists to recover from) and spawns a
 * fresh one in its place. The cached client socket is dropped immediately
 * rather than left to notice the close on its own, so a caller that invokes
 * `ensureDaemonRunning` right after this resolves never races a stale
 * `client` reference that has not yet fired its `close` handler.
 */
export async function restartDaemon(): Promise<void> {
  const socketPath = getSessionDaemonSocketPath();
  client?.destroy();
  client = null;
  await terminateStaleDaemon(socketPath);
  await ensureDaemonRunning();
}

export async function sendDaemonRequest(request: DaemonRequest): Promise<void> {
  await ensureDaemonRunning();
  client?.write(encodeFrame(request));
}

export function subscribeDaemonEvents(
  onEvent: (event: DaemonEvent) => void,
): () => void {
  eventListeners.add(onEvent);
  return () => eventListeners.delete(onEvent);
}
