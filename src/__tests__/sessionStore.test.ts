import { useSessionStore } from '../renderer/store/sessionStore';
import type { SessionSnapshot } from '../shared/daemonProtocol';
import {
  playTaskFinishedSound,
  playNeedsInputSound,
} from '../renderer/lib/notificationSound';

jest.mock('../renderer/lib/notificationSound', () => ({
  playTaskFinishedSound: jest.fn(),
  playNeedsInputSound: jest.fn(),
}));

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

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: {} });
    (playTaskFinishedSound as jest.Mock).mockClear();
    (playNeedsInputSound as jest.Mock).mockClear();
  });

  it('starts with no sessions', () => {
    expect(useSessionStore.getState().sessions).toEqual({});
  });

  it('applySnapshot stores the snapshot keyed by cardId', () => {
    useSessionStore.getState().applySnapshot(snapshot());
    expect(useSessionStore.getState().sessions.crd_1).toEqual(snapshot());
  });

  it('applySnapshot replaces the whole entry, not a merge', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'working' }));
    useSessionStore
      .getState()
      .applySnapshot(
        snapshot({ status: 'done', checklist: [{ id: 'a', label: 'x', done: true, seq: 0 }] }),
      );
    expect(useSessionStore.getState().sessions.crd_1.status).toBe('done');
    expect(useSessionStore.getState().sessions.crd_1.checklist).toHaveLength(1);
  });

  it('clearSession removes a card entirely', () => {
    useSessionStore.getState().applySnapshot(snapshot());
    useSessionStore.getState().clearSession('crd_1');
    expect(useSessionStore.getState().sessions.crd_1).toBeUndefined();
  });

  it('does not play a sound on a card\'s first snapshot, even if it arrives done', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'done' }));
    expect(playTaskFinishedSound).not.toHaveBeenCalled();
    expect(playNeedsInputSound).not.toHaveBeenCalled();
  });

  it('plays the finished sound when a card transitions into done', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'working' }));
    useSessionStore.getState().applySnapshot(snapshot({ status: 'done' }));
    expect(playTaskFinishedSound).toHaveBeenCalledTimes(1);
    expect(playNeedsInputSound).not.toHaveBeenCalled();
  });

  it('plays the needs-input sound when a card transitions into waiting', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'working' }));
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'waiting',
        pendingApproval: { requestId: 'req_1', toolName: 'Bash', input: {} },
      }),
    );
    expect(playNeedsInputSound).toHaveBeenCalledTimes(1);
    expect(playTaskFinishedSound).not.toHaveBeenCalled();
  });

  it('does not replay a sound when a snapshot repeats the same status', () => {
    useSessionStore.getState().applySnapshot(snapshot({ status: 'working' }));
    useSessionStore.getState().applySnapshot(snapshot({ status: 'done' }));
    useSessionStore.getState().applySnapshot(
      snapshot({
        status: 'done',
        checklist: [{ id: 'a', label: 'x', done: true, seq: 0 }],
      }),
    );
    expect(playTaskFinishedSound).toHaveBeenCalledTimes(1);
  });

  // Regression coverage for the app-restart chime flood: AppShell's reattach
  // effect seeds an `interrupted` placeholder for every card that has a
  // sessionId (done long ago or not), then asks the daemon for the real
  // status. That real reply is not a live "just happened" event -- it's
  // just reporting whatever was already true -- so it must not be diffed
  // against the placeholder for chime purposes the way a genuine live
  // transition would be.
  describe('markReattaching', () => {
    it('suppresses the chime for the reply that resolves a reattach placeholder', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'interrupted' }));
      useSessionStore.getState().markReattaching('crd_1');
      useSessionStore.getState().applySnapshot(snapshot({ status: 'done' }));
      expect(playTaskFinishedSound).not.toHaveBeenCalled();
    });

    it('suppresses the needs-input chime too, not just the finished chime', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'interrupted' }));
      useSessionStore.getState().markReattaching('crd_1');
      useSessionStore.getState().applySnapshot(
        snapshot({
          status: 'waiting',
          pendingApproval: { requestId: 'req_1', toolName: 'Bash', input: {} },
        }),
      );
      expect(playNeedsInputSound).not.toHaveBeenCalled();
    });

    it('still stores the real status even though the chime is suppressed', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'interrupted' }));
      useSessionStore.getState().markReattaching('crd_1');
      useSessionStore.getState().applySnapshot(snapshot({ status: 'done' }));
      expect(useSessionStore.getState().sessions.crd_1.status).toBe('done');
    });

    it('does not suppress a later, genuinely live transition once the reattach reply has landed', () => {
      useSessionStore.getState().applySnapshot(snapshot({ status: 'interrupted' }));
      useSessionStore.getState().markReattaching('crd_1');
      useSessionStore.getState().applySnapshot(snapshot({ status: 'done' })); // reattach reply, silenced
      useSessionStore.getState().applySnapshot(snapshot({ status: 'working' })); // card reran
      useSessionStore.getState().applySnapshot(snapshot({ status: 'done' })); // genuinely finishes again
      expect(playTaskFinishedSound).toHaveBeenCalledTimes(1);
    });

    it('a same-status update while reattaching does not consume the pending flag, so a later real reply is still silenced', () => {
      // Mirrors AppShell's 15s "still reconnecting" timeout, which only
      // rewrites lastError while status stays `interrupted`.
      useSessionStore.getState().applySnapshot(snapshot({ status: 'interrupted' }));
      useSessionStore.getState().markReattaching('crd_1');
      useSessionStore
        .getState()
        .applySnapshot(snapshot({ status: 'interrupted', lastError: 'gave up waiting' }));
      useSessionStore.getState().applySnapshot(snapshot({ status: 'done' }));
      expect(playTaskFinishedSound).not.toHaveBeenCalled();
    });
  });
});
