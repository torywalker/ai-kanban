import type { SessionSnapshot } from '@shared/daemonProtocol';

const BROADCAST_DELAY_MS = 200;
const PERSIST_DELAY_MS = 1_000;

export type SnapshotPersistTiming = 'now' | 'later';

interface CardState {
  latest: SessionSnapshot;
  lastBroadcast: SessionSnapshot | null;
  lastPersisted: SessionSnapshot | null;
  broadcastTimer: ReturnType<typeof setTimeout> | null;
  persistTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Publishes session snapshots without doing full-snapshot work on every SDK
 * event. The first snapshot and any change the user has to act on go out
 * immediately. Checklist and transcript progress is held briefly so only the
 * newest copy is serialized, sent, and written.
 */
export function createSnapshotPublisher(options: {
  broadcast: (snapshot: SessionSnapshot) => void;
  persist: (snapshot: SessionSnapshot, timing: SnapshotPersistTiming) => void;
}): {
  publish: (snapshot: SessionSnapshot) => void;
  flushCard: (cardId: string) => void;
  forget: (cardId: string) => void;
  flushAll: () => void;
} {
  const cards = new Map<string, CardState>();

  const clearTimers = (state: CardState): void => {
    if (state.broadcastTimer) clearTimeout(state.broadcastTimer);
    if (state.persistTimer) clearTimeout(state.persistTimer);
    state.broadcastTimer = null;
    state.persistTimer = null;
  };

  const broadcastNow = (state: CardState): void => {
    if (state.broadcastTimer) {
      clearTimeout(state.broadcastTimer);
      state.broadcastTimer = null;
    }
    if (state.lastBroadcast === state.latest) return;
    options.broadcast(state.latest);
    state.lastBroadcast = state.latest;
  };

  const persistNow = (
    state: CardState,
    timing: SnapshotPersistTiming,
  ): void => {
    if (state.persistTimer) {
      clearTimeout(state.persistTimer);
      state.persistTimer = null;
    }
    if (state.lastPersisted === state.latest) return;
    options.persist(state.latest, timing);
    state.lastPersisted = state.latest;
  };

  const schedule = (state: CardState): void => {
    if (!state.broadcastTimer && state.lastBroadcast !== state.latest) {
      state.broadcastTimer = setTimeout(() => {
        state.broadcastTimer = null;
        broadcastNow(state);
      }, BROADCAST_DELAY_MS);
    }
    if (!state.persistTimer && state.lastPersisted !== state.latest) {
      state.persistTimer = setTimeout(() => {
        state.persistTimer = null;
        persistNow(state, 'later');
      }, PERSIST_DELAY_MS);
    }
  };

  const flushCard = (cardId: string): void => {
    const state = cards.get(cardId);
    if (!state) return;
    clearTimers(state);
    broadcastNow(state);
    persistNow(state, 'now');
  };

  return {
    publish(snapshot) {
      let state = cards.get(snapshot.cardId);
      if (!state) {
        state = {
          latest: snapshot,
          lastBroadcast: null,
          lastPersisted: null,
          broadcastTimer: null,
          persistTimer: null,
        };
        cards.set(snapshot.cardId, state);
      }
      const previous = state.lastBroadcast;
      state.latest = snapshot;
      if (
        !previous ||
        previous.status !== snapshot.status ||
        previous.pendingApproval !== snapshot.pendingApproval ||
        previous.lastError !== snapshot.lastError
      ) {
        broadcastNow(state);
        persistNow(state, 'now');
        return;
      }
      schedule(state);
    },
    flushCard,
    forget(cardId) {
      const state = cards.get(cardId);
      if (state) clearTimers(state);
      cards.delete(cardId);
    },
    flushAll() {
      [...cards.keys()].forEach(flushCard);
    },
  };
}
