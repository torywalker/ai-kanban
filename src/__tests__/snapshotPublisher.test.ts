import type { SessionSnapshot } from '../shared/daemonProtocol';
import { createSnapshotPublisher } from '../main/daemon/snapshotPublisher';

function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    cardId: 'crd_1',
    sessionId: null,
    status: 'working',
    checklist: [],
    messages: [],
    pendingApproval: null,
    lastError: null,
    ...overrides,
  };
}

describe('createSnapshotPublisher', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('broadcasts the first snapshot immediately and collapses later progress into the newest one', () => {
    const broadcast = jest.fn();
    const persist = jest.fn();
    const publisher = createSnapshotPublisher({ broadcast, persist });
    const first = snapshot();
    const second = snapshot({
      checklist: [{ id: 'tool_1', label: 'Read: a.ts', done: false, seq: 0 }],
    });
    const third = snapshot({
      checklist: [
        { id: 'tool_1', label: 'Read: a.ts', done: true, seq: 0 },
        { id: 'tool_2', label: 'Bash: npm test', done: false, seq: 1 },
      ],
    });

    publisher.publish(first);
    publisher.publish(second);
    publisher.publish(third);

    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(first);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(first, 'now');

    jest.advanceTimersByTime(200);

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenLastCalledWith(third);
    expect(persist).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(800);

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenLastCalledWith(third, 'later');
  });

  it('sends a status change immediately instead of waiting for the progress window', () => {
    const broadcast = jest.fn();
    const persist = jest.fn();
    const publisher = createSnapshotPublisher({ broadcast, persist });
    const working = snapshot({
      checklist: [{ id: 'tool_1', label: 'Read: a.ts', done: true, seq: 0 }],
    });
    const waiting = snapshot({
      status: 'waiting',
      pendingApproval: { requestId: 'req_1', toolName: 'Bash', input: {} },
    });

    publisher.publish(working);
    publisher.publish(waiting);

    expect(broadcast).toHaveBeenLastCalledWith(waiting);
    expect(persist).toHaveBeenLastCalledWith(waiting, 'now');
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('flushes unpublished progress and then drops the card', () => {
    const broadcast = jest.fn();
    const persist = jest.fn();
    const publisher = createSnapshotPublisher({ broadcast, persist });
    const progress = snapshot({
      messages: [{ id: 'msg_1', kind: 'text', text: 'Working', seq: 0 }],
    });

    publisher.publish(snapshot());
    publisher.publish(progress);
    publisher.flushCard('crd_1');

    expect(broadcast).toHaveBeenLastCalledWith(progress);
    expect(persist).toHaveBeenLastCalledWith(progress, 'now');

    broadcast.mockClear();
    persist.mockClear();
    publisher.forget('crd_1');
    jest.advanceTimersByTime(1_000);

    expect(broadcast).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
