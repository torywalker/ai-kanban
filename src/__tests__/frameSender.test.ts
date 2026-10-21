import { createFrameSender } from '../main/daemon/frameSender';

interface FakeSocket {
  writes: string[];
  accept: boolean;
  write: (frame: string) => boolean;
  on: (event: 'drain' | 'close', listener: () => void) => void;
  emit: (event: 'drain' | 'close') => void;
}

function fakeSocket(): FakeSocket {
  const listeners = new Map<'drain' | 'close', Array<() => void>>();
  const socket: FakeSocket = {
    writes: [],
    accept: true,
    write(frame) {
      this.writes.push(frame);
      return this.accept;
    },
    on(event, listener) {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
    },
    emit(event) {
      listeners.get(event)?.forEach((listener) => listener());
    },
  };
  return socket;
}

describe('createFrameSender', () => {
  it('writes a frame immediately when the socket accepts it', () => {
    const sender = createFrameSender();
    const socket = fakeSocket();

    sender.write(socket, 'snapshot-1\n', 'snapshot');

    expect(socket.writes).toEqual(['snapshot-1\n']);
  });

  it('keeps only the newest snapshot while the socket is blocked', () => {
    const sender = createFrameSender();
    const socket = fakeSocket();
    socket.accept = false;

    sender.write(socket, 'snapshot-1\n', 'snapshot');
    sender.write(socket, 'snapshot-2\n', 'snapshot');
    sender.write(socket, 'snapshot-3\n', 'snapshot');

    expect(socket.writes).toEqual(['snapshot-1\n']);

    socket.accept = true;
    socket.emit('drain');

    expect(socket.writes).toEqual(['snapshot-1\n', 'snapshot-3\n']);
  });

  it('does not drop a control frame when a newer snapshot arrives', () => {
    const sender = createFrameSender();
    const socket = fakeSocket();
    socket.accept = false;

    sender.write(socket, 'snapshot-1\n', 'snapshot');
    sender.write(socket, 'pong\n', 'control');
    sender.write(socket, 'snapshot-2\n', 'snapshot');

    socket.accept = true;
    socket.emit('drain');

    expect(socket.writes).toEqual(['snapshot-1\n', 'pong\n', 'snapshot-2\n']);
  });
});
