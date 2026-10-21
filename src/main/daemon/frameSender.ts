export interface FrameSocket {
  write(frame: string): boolean;
  on(event: 'drain' | 'close', listener: () => void): void;
}

interface WriteState {
  blocked: boolean;
  pendingControl: string[];
  pendingSnapshot: string | null;
}

/**
 * Writes daemon frames without letting a slow client accumulate every
 * intermediate snapshot. While a socket is blocked, newer snapshots replace
 * the one pending snapshot; small control frames are kept.
 */
export function createFrameSender(): {
  write: (
    socket: FrameSocket,
    frame: string,
    kind: 'snapshot' | 'control',
  ) => void;
  forget: (socket: FrameSocket) => void;
} {
  const states = new WeakMap<FrameSocket, WriteState>();

  const writeNow = (
    socket: FrameSocket,
    state: WriteState,
    frame: string,
  ): boolean => {
    try {
      const accepted = socket.write(frame);
      state.blocked = !accepted;
      return accepted;
    } catch {
      states.delete(socket);
      return false;
    }
  };

  const flush = (socket: FrameSocket): void => {
    const state = states.get(socket);
    if (!state) return;
    state.blocked = false;
    while (state.pendingControl.length > 0) {
      const frame = state.pendingControl.shift();
      if (frame === undefined || !writeNow(socket, state, frame)) return;
    }
    if (state.pendingSnapshot === null) return;
    const frame = state.pendingSnapshot;
    state.pendingSnapshot = null;
    writeNow(socket, state, frame);
  };

  const stateFor = (socket: FrameSocket): WriteState => {
    const existing = states.get(socket);
    if (existing) return existing;
    const state: WriteState = {
      blocked: false,
      pendingControl: [],
      pendingSnapshot: null,
    };
    states.set(socket, state);
    socket.on('drain', () => flush(socket));
    socket.on('close', () => states.delete(socket));
    return state;
  };

  return {
    write(socket, frame, kind) {
      const state = stateFor(socket);
      if (state.blocked) {
        if (kind === 'snapshot') state.pendingSnapshot = frame;
        else state.pendingControl.push(frame);
        return;
      }
      writeNow(socket, state, frame);
    },
    forget(socket) {
      states.delete(socket);
    },
  };
}
